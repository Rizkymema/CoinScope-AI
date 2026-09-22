/**
 * Bridge store: shared state between the browser dashboard (where the bot runs)
 * and the server-side MCP endpoint (where external AIs connect).
 *
 *  browser  --POST /api/bridge/sync (snapshot, results)-->  server  <--MCP tool call-- AI client
 *  browser  <--------------- pending commands --------------  server
 *
 * Backend: Upstash Redis REST when KV_REST_API_URL / UPSTASH_REDIS_REST_URL is set
 * (recommended on Vercel, where each request may hit a different instance), otherwise
 * process memory (fine for `next start` / `next dev` on one machine).
 */

export interface BridgeCommand {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  createdAt: number;
}

export interface BridgeResult {
  id: string;
  ok: boolean;
  result: string;
  finishedAt: number;
}

export interface BridgeSnapshot {
  snapshot: Record<string, unknown>;
  logs: unknown[];
  positions: unknown[];
  recentCoins: unknown[];
  updatedAt: number;
}

const STATE_KEY = 'coinscope:bridge:state';
const QUEUE_KEY = 'coinscope:bridge:queue';
const RESULT_PREFIX = 'coinscope:bridge:result:';
const RESULT_TTL_SEC = 300;
export const HEARTBEAT_STALE_MS = 20_000;

/* ------------------------------------------------------------------ */
/* Memory backend                                                      */
/* ------------------------------------------------------------------ */
const g = globalThis as any;
if (!g.__coinscopeBridge) {
  g.__coinscopeBridge = { state: null as BridgeSnapshot | null, queue: [] as BridgeCommand[], results: new Map<string, BridgeResult>() };
}
const mem: { state: BridgeSnapshot | null; queue: BridgeCommand[]; results: Map<string, BridgeResult> } = g.__coinscopeBridge;

/* ------------------------------------------------------------------ */
/* Upstash / Vercel KV REST backend                                    */
/* ------------------------------------------------------------------ */
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

export const bridgeBackend: 'redis' | 'memory' = REDIS_URL && REDIS_TOKEN ? 'redis' : 'memory';

async function redis<T = any>(...cmd: (string | number)[]): Promise<T> {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
    cache: 'no-store',
  });
  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return data?.result as T;
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */
export const BridgeStore = {
  async setState(state: BridgeSnapshot): Promise<void> {
    if (bridgeBackend === 'redis') {
      await redis('SET', STATE_KEY, JSON.stringify(state), 'EX', 120);
    } else {
      mem.state = state;
    }
  },

  async getState(): Promise<BridgeSnapshot | null> {
    if (bridgeBackend === 'redis') {
      const raw = await redis<string | null>('GET', STATE_KEY);
      return raw ? (JSON.parse(raw) as BridgeSnapshot) : null;
    }
    return mem.state;
  },

  /** True when the dashboard has synced within the last HEARTBEAT_STALE_MS. */
  async isDashboardOnline(): Promise<boolean> {
    const s = await this.getState();
    return !!s && Date.now() - s.updatedAt < HEARTBEAT_STALE_MS;
  },

  async enqueue(tool: string, input: Record<string, unknown>): Promise<BridgeCommand> {
    const cmd: BridgeCommand = { id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, tool, input, createdAt: Date.now() };
    if (bridgeBackend === 'redis') {
      await redis('RPUSH', QUEUE_KEY, JSON.stringify(cmd));
      await redis('EXPIRE', QUEUE_KEY, 120);
    } else {
      mem.queue.push(cmd);
    }
    return cmd;
  },

  /** Atomically takes every pending command (called by the browser on each sync). */
  async takeAll(): Promise<BridgeCommand[]> {
    if (bridgeBackend === 'redis') {
      const items = await redis<string[]>('LRANGE', QUEUE_KEY, 0, -1);
      if (!items || items.length === 0) return [];
      await redis('LTRIM', QUEUE_KEY, items.length, -1);
      return items.map((i) => JSON.parse(i) as BridgeCommand).filter((c) => Date.now() - c.createdAt < 60_000);
    }
    const out = mem.queue.splice(0, mem.queue.length);
    return out.filter((c) => Date.now() - c.createdAt < 60_000);
  },

  async putResult(result: BridgeResult): Promise<void> {
    if (bridgeBackend === 'redis') {
      await redis('SET', RESULT_PREFIX + result.id, JSON.stringify(result), 'EX', RESULT_TTL_SEC);
    } else {
      mem.results.set(result.id, result);
      if (mem.results.size > 500) {
        const oldest = Array.from(mem.results.keys()).slice(0, 100);
        oldest.forEach((k) => mem.results.delete(k));
      }
    }
  },

  async getResult(id: string): Promise<BridgeResult | null> {
    if (bridgeBackend === 'redis') {
      const raw = await redis<string | null>('GET', RESULT_PREFIX + id);
      return raw ? (JSON.parse(raw) as BridgeResult) : null;
    }
    return mem.results.get(id) || null;
  },

  /** Enqueues a command and waits for the dashboard to execute it. */
  async execute(tool: string, input: Record<string, unknown>, timeoutMs = 20_000): Promise<BridgeResult> {
    if (!(await this.isDashboardOnline())) {
      return {
        id: 'offline',
        ok: false,
        result: JSON.stringify({
          error:
            'CoinScope dashboard is not connected. Open the web app in a browser (Auto Bot tab), make sure the access key matches, and keep the tab open - the bot engine runs in the browser.',
        }),
        finishedAt: Date.now(),
      };
    }
    const cmd = await this.enqueue(tool, input);
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const r = await this.getResult(cmd.id);
      if (r) return r;
      await new Promise((res) => setTimeout(res, 400));
    }
    return { id: cmd.id, ok: false, result: JSON.stringify({ error: `Timed out after ${timeoutMs / 1000}s waiting for the dashboard to execute ${tool}.` }), finishedAt: Date.now() };
  },
};
