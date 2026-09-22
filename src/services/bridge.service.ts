/**
 * Browser side of the MCP bridge.
 * Every ~2s: push a state snapshot to /api/bridge/sync, receive pending commands from external
 * AI clients (via /api/mcp), execute them against the bot store, and return the results on the next sync.
 */
import { useBotStore } from '../store/useBotStore';
import { executeBotTool } from '../lib/bot-tool-executor';
import type { BridgeCommand, BridgeResult } from '../lib/bridge-store';

const ACCESS_KEY_STORAGE = 'coinscope_access_key';
const SYNC_MS = 2_000;

export interface BridgeStatus {
  connected: boolean;
  authRequired: boolean;
  backend: 'redis' | 'memory' | null;
  lastSyncAt: number | null;
  lastError: string | null;
  commandsExecuted: number;
}

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
let pendingResults: BridgeResult[] = [];
const status: BridgeStatus = { connected: false, authRequired: false, backend: null, lastSyncAt: null, lastError: null, commandsExecuted: 0 };
const listeners = new Set<(s: BridgeStatus) => void>();

function notify() {
  listeners.forEach((cb) => cb({ ...status }));
}

export const BridgeService = {
  getAccessKey(): string {
    try {
      return localStorage.getItem(ACCESS_KEY_STORAGE) || '';
    } catch {
      return '';
    }
  },

  setAccessKey(key: string) {
    try {
      if (key) localStorage.setItem(ACCESS_KEY_STORAGE, key.trim());
      else localStorage.removeItem(ACCESS_KEY_STORAGE);
    } catch {
      // storage unavailable
    }
    status.lastError = null;
    notify();
    this.syncNow();
  },

  getStatus(): BridgeStatus {
    return { ...status };
  },

  onStatus(cb: (s: BridgeStatus) => void): () => void {
    listeners.add(cb);
    cb({ ...status });
    return () => {
      listeners.delete(cb);
    };
  },

  start() {
    if (typeof window === 'undefined' || timer) return;
    timer = setInterval(() => this.syncNow(), SYNC_MS);
    this.syncNow();
  },

  stop() {
    if (timer) clearInterval(timer);
    timer = null;
  },

  /** Verifies the current key against the server without pushing state. */
  async testKey(key: string): Promise<{ ok: boolean; message: string; authRequired?: boolean }> {
    try {
      const res = await fetch('/api/bridge/sync', { headers: { Authorization: `Bearer ${key.trim()}` } });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return { ok: false, message: 'Access key rejected by the server.' };
      if (!res.ok) return { ok: false, message: data?.error || `Server error ${res.status}` };
      return { ok: true, message: data?.authRequired ? 'Access key accepted.' : 'Server has no COINSCOPE_ACCESS_KEY set - bridge is open (development mode).', authRequired: !!data?.authRequired };
    } catch (err: any) {
      return { ok: false, message: err?.message || 'Network error' };
    }
  },

  async syncNow() {
    if (typeof window === 'undefined' || inFlight) return;
    inFlight = true;
    try {
      const store = useBotStore.getState();
      const body = {
        snapshot: store.getSnapshot(),
        logs: store.logs.slice(0, 40),
        positions: store.positions.map((p) => ({
          id: p.id,
          symbol: p.coin.symbol,
          chain: p.coin.chainId,
          mode: p.isLive ? 'live' : 'paper',
          entryPriceUsd: p.buyPriceUsd,
          currentPriceUsd: p.currentPriceUsd,
          investedUsd: p.amountUsd,
          pnlUsd: p.pnlUsd,
          pnlPercent: p.pnlPercent,
          tpPriceUsd: p.tpPriceUsd,
          slPriceUsd: p.slPriceUsd,
        })),
        recentCoins: store.recentCoins.slice(0, 40).map((c) => ({
          id: c.id,
          symbol: c.symbol,
          name: c.name,
          chain: c.chainId,
          priceUsd: c.priceUsd,
          marketCapUsd: Math.round(c.fundamentals.marketCap || 0),
          liquidityUsd: Math.round(c.fundamentals.tvl || 0),
          ageMinutes: c.createdAt ? Math.round((Date.now() - c.createdAt) / 60_000) : null,
          isPumpFun: !!c.isPumpFun,
          bondingCurvePercent: c.bondingCurve ?? null,
        })),
        results: pendingResults,
      };
      const sentResults = pendingResults;
      pendingResults = [];

      const key = this.getAccessKey();
      const res = await fetch('/api/bridge/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        pendingResults = [...sentResults, ...pendingResults];
        status.connected = false;
        status.lastError = res.status === 401 ? 'Access key missing or wrong (set it via Login → Secret Key).' : data?.error || `Sync failed (${res.status})`;
        notify();
        return;
      }

      status.connected = true;
      status.lastError = null;
      status.authRequired = !!data?.authRequired;
      status.backend = data?.backend || null;
      status.lastSyncAt = Date.now();

      const commands: BridgeCommand[] = Array.isArray(data?.commands) ? data.commands : [];
      if (commands.length > 0) {
        notify();
        for (const cmd of commands) {
          const started = Date.now();
          useBotStore.getState().log('ai', `[MCP] ${cmd.tool}(${JSON.stringify(cmd.input || {})})`);
          try {
            const { result, isError } = await executeBotTool(cmd.tool, cmd.input || {});
            pendingResults.push({ id: cmd.id, ok: !isError, result, finishedAt: Date.now() });
          } catch (err: any) {
            pendingResults.push({ id: cmd.id, ok: false, result: JSON.stringify({ error: err?.message || 'Tool failed' }), finishedAt: Date.now() });
          }
          status.commandsExecuted += 1;
          void started;
        }
        // Deliver results immediately instead of waiting for the next tick.
        inFlight = false;
        await this.syncNow();
        return;
      }
      notify();
    } catch (err: any) {
      status.connected = false;
      status.lastError = err?.message || 'Network error';
      notify();
    } finally {
      inFlight = false;
    }
  },
};
