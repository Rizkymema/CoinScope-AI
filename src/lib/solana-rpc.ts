/**
 * Server-side Solana JSON-RPC with endpoint fallback. Server-only - never import from a client file.
 *
 * Why this exists: api.mainnet-beta.solana.com now answers browser requests (any request carrying
 * an Origin header) with 403, so balances, token balances and transaction confirmations all broke
 * in the dashboard. The same endpoint still serves server-to-server calls, and other public
 * endpoints cover most methods, so the browser talks to /api/rpc and this walks the list.
 *
 * Order: a private endpoint from SOLANA_RPC_URL (recommended for real trading), the public
 * mainnet endpoint, then publicnode for methods it serves without a personal token.
 */

const PUBLIC_MAINNET = 'https://api.mainnet-beta.solana.com';
const PUBLICNODE = 'https://solana-rpc.publicnode.com';

/** Methods the dashboard actually needs. Anything else is refused so this is not an open relay. */
export const RPC_ALLOWED_METHODS = new Set([
  'getBalance',
  'getTokenAccountsByOwner',
  'getAccountInfo',
  'getSignatureStatuses',
  'getLatestBlockhash',
  'simulateTransaction',
  'sendTransaction',
  'getFeeForMessage',
  'getMinimumBalanceForRentExemption',
]);

/** publicnode rejects these without a personal token. */
const INDEXED_METHODS = new Set(['getTokenAccountsByOwner', 'getProgramAccounts', 'getSignaturesForAddress']);

export interface RpcOutcome {
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  endpoint?: string;
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'rpc';
  }
}

export function rpcEndpointsFor(method: string): string[] {
  const list: string[] = [];
  const privateUrl = (process.env.SOLANA_RPC_URL || '').trim();
  if (/^https?:\/\//.test(privateUrl)) list.push(privateUrl);
  const publicOverride = (process.env.NEXT_PUBLIC_SOLANA_RPC_URL || '').trim();
  if (/^https?:\/\//.test(publicOverride)) list.push(publicOverride);
  list.push(PUBLIC_MAINNET);
  if (!INDEXED_METHODS.has(method)) list.push(PUBLICNODE);
  return Array.from(new Set(list));
}

/** Errors that mean "this endpoint won't serve you", as opposed to a real answer about the request. */
const ENDPOINT_REFUSAL = /rate.?limit|too many|forbidden|personal token|upgrade|plan|unauthori[sz]ed|api key/i;

export async function rpcCall(method: string, params: unknown[] = [], timeoutMs = 12_000): Promise<RpcOutcome> {
  let lastError: RpcOutcome['error'] = { code: -32603, message: 'No RPC endpoint available' };

  for (const url of rpcEndpointsFor(method)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timer);

      if (res.status === 429 || res.status === 401 || res.status === 403 || res.status >= 500) {
        lastError = { code: res.status, message: `${host(url)} responded HTTP ${res.status}` };
        continue;
      }

      const data = await res.json().catch(() => null);
      if (!data) {
        lastError = { code: -32603, message: `${host(url)} returned an unreadable body` };
        continue;
      }
      if (data.error) {
        if (ENDPOINT_REFUSAL.test(String(data.error.message || ''))) {
          lastError = data.error;
          continue;
        }
        // A genuine answer (simulation failure, bad params, blockhash not found...) - do not retry elsewhere.
        return { error: data.error, endpoint: host(url) };
      }
      return { result: data.result, endpoint: host(url) };
    } catch (err: any) {
      lastError = { code: -32603, message: `${host(url)}: ${err?.name === 'AbortError' ? 'timed out' : err?.message || 'request failed'}` };
    }
  }

  return { error: lastError };
}
