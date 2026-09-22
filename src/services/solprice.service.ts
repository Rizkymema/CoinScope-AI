/**
 * SOL / USD price oracle.
 * Uses the DexScreener wrapped-SOL pair (no API key, CORS enabled) with a short cache
 * so PumpPortal's SOL-denominated market caps can be converted to USD.
 */

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const DEXSCREENER_URL = `https://api.dexscreener.com/tokens/v1/solana/${WSOL_MINT}`;
const JUPITER_PRICE_URL = `https://lite-api.jup.ag/price/v3?ids=${WSOL_MINT}`;
const CACHE_TTL_MS = 30_000;

let cached: { price: number; ts: number } | null = null;
let inFlight: Promise<number> | null = null;
const listeners = new Set<(price: number) => void>();

async function fetchFromDexScreener(): Promise<number> {
  const res = await fetch(DEXSCREENER_URL);
  if (!res.ok) throw new Error(`DexScreener ${res.status}`);
  const data = await res.json();
  const pairs: any[] = Array.isArray(data) ? data : data?.pairs || [];
  // Prefer the deepest USDC/USDT quoted pool.
  const best = pairs
    .filter((p) => p?.priceUsd && /USD/i.test(p?.quoteToken?.symbol || ''))
    .sort((a, b) => (Number(b?.liquidity?.usd) || 0) - (Number(a?.liquidity?.usd) || 0))[0] || pairs[0];
  const price = Number(best?.priceUsd);
  if (!price || !Number.isFinite(price)) throw new Error('No SOL price in DexScreener response');
  return price;
}

async function fetchFromJupiter(): Promise<number> {
  const res = await fetch(JUPITER_PRICE_URL);
  if (!res.ok) throw new Error(`Jupiter ${res.status}`);
  const data = await res.json();
  const price = Number(data?.[WSOL_MINT]?.usdPrice ?? data?.data?.[WSOL_MINT]?.price);
  if (!price || !Number.isFinite(price)) throw new Error('No SOL price in Jupiter response');
  return price;
}

export const SolPriceService = {
  /** Last known price without triggering a network call (0 if never fetched). */
  getCached(): number {
    return cached?.price || 0;
  },

  async getSolPriceUsd(force = false): Promise<number> {
    const now = Date.now();
    if (!force && cached && now - cached.ts < CACHE_TTL_MS) return cached.price;
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        let price: number;
        try {
          price = await fetchFromDexScreener();
        } catch {
          price = await fetchFromJupiter();
        }
        cached = { price, ts: Date.now() };
        listeners.forEach((cb) => cb(price));
        return price;
      } catch {
        // Keep serving the stale value if we have one; otherwise report 0 so callers can bail.
        return cached?.price || 0;
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  },

  onPrice(cb: (price: number) => void): () => void {
    listeners.add(cb);
    if (cached) cb(cached.price);
    return () => {
      listeners.delete(cb);
    };
  },
};
