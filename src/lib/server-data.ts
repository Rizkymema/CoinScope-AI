/**
 * Server-side market data helpers (no browser, no relative URLs).
 * Used by the MCP endpoint and the pump.fun proxy route.
 */
import { CoinData } from '../types/coin';
import { PumpFunService, PumpFunCoin } from '../services/pumpfun.service';
import { CoinService } from '../services/coin.service';
import { SolPriceService } from '../services/solprice.service';

const PUMPFUN_ENDPOINTS = [
  'https://frontend-api-v3.pump.fun/coins',
  'https://frontend-api-v2.pump.fun/coins',
  'https://frontend-api.pump.fun/coins',
];

let pumpCache: { ts: number; coins: PumpFunCoin[] } | null = null;
const PUMP_CACHE_TTL_MS = 4_000;

/** Raw pump.fun coin objects, newest first (cached 4s). */
export async function fetchPumpFunLatestRaw(limit = 30): Promise<{ coins: PumpFunCoin[]; stale: boolean }> {
  const lim = Math.min(50, Math.max(1, limit));
  if (pumpCache && Date.now() - pumpCache.ts < PUMP_CACHE_TTL_MS) return { coins: pumpCache.coins.slice(0, lim), stale: false };

  for (const base of PUMPFUN_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6_000);
      const res = await fetch(`${base}?offset=0&limit=${lim}&sort=created_timestamp&order=DESC&includeNsfw=false`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; CoinScopeAI/1.0)' },
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      const coins: PumpFunCoin[] = Array.isArray(data) ? data : Array.isArray(data?.coins) ? data.coins : [];
      if (coins.length === 0) continue;
      pumpCache = { ts: Date.now(), coins };
      return { coins: coins.slice(0, lim), stale: false };
    } catch {
      // next endpoint
    }
  }
  return { coins: pumpCache?.coins.slice(0, lim) || [], stale: true };
}

/** Combined newest-coins feed computed on the server (pump.fun + GeckoTerminal + DexScreener). */
export async function getNewCoinsServer(options?: { limit?: number; chain?: string; pumpfunOnly?: boolean; maxAgeMinutes?: number }): Promise<CoinData[]> {
  const solPrice = await SolPriceService.getSolPriceUsd();
  const [pumpRes, geckoRes, dexRes] = await Promise.allSettled([
    fetchPumpFunLatestRaw(30).then((r) => r.coins.map((c) => PumpFunService.mapPumpFunToCoinData(c, solPrice)).filter(Boolean) as CoinData[]),
    CoinService.getGeckoNewPools(),
    CoinService.getLatestDexProfiles(),
  ]);

  const merged = new Map<string, CoinData>();
  [pumpRes, geckoRes, dexRes].forEach((r) => {
    if (r.status !== 'fulfilled') return;
    r.value.forEach((c) => {
      if (!c?.id) return;
      const prev = merged.get(c.id);
      merged.set(c.id, prev ? { ...prev, ...c, imageUrl: prev.imageUrl || c.imageUrl } : c);
    });
  });

  const now = Date.now();
  const maxAgeMs = options?.maxAgeMinutes ? options.maxAgeMinutes * 60_000 : 0;
  let list = Array.from(merged.values());
  if (options?.chain) list = list.filter((c) => (c.chainId || '').toLowerCase() === options.chain!.toLowerCase());
  if (options?.pumpfunOnly) list = list.filter((c) => c.isPumpFun);
  if (maxAgeMs) list = list.filter((c) => !c.createdAt || now - c.createdAt <= maxAgeMs);
  return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, Math.max(1, options?.limit || 20));
}

export async function searchCoinsServer(query: string): Promise<CoinData[]> {
  return CoinService.searchCoins(query);
}

export async function getTokenServer(chainId: string, address: string): Promise<CoinData | null> {
  const quotes = await CoinService.getTokenQuotes([{ chainId, address }]);
  const key = `${chainId.toLowerCase()}:${address.startsWith('0x') ? address.toLowerCase() : address}`;
  return quotes.get(key) || Array.from(quotes.values())[0] || null;
}

export async function getTrendingServer(limit = 20): Promise<CoinData[]> {
  return CoinService.getTopCoins({ limit });
}

export async function getSolPriceServer(): Promise<number> {
  return SolPriceService.getSolPriceUsd();
}

/** Compact JSON-friendly summary used in MCP tool results. */
export function summarizeCoin(c: CoinData) {
  return {
    id: c.id,
    symbol: c.symbol,
    name: c.name,
    chain: c.chainId,
    mint: c.mint,
    priceUsd: c.priceUsd,
    marketCapUsd: Math.round(c.fundamentals.marketCap || 0),
    liquidityUsd: Math.round(c.fundamentals.tvl || 0),
    volume24hUsd: Math.round(c.fundamentals.volume24h || 0),
    change5m: c.priceChange5m ?? null,
    change1h: c.priceChange1h ?? null,
    change24h: c.priceChange24h ?? null,
    txns24h: c.txns24h || null,
    ageMinutes: c.createdAt ? Math.round((Date.now() - c.createdAt) / 60_000) : null,
    isPumpFun: !!c.isPumpFun,
    bondingCurvePercent: c.bondingCurve ?? null,
    graduated: c.graduated ?? null,
    dex: c.dexId || c.poolType || null,
    source: c.source || null,
    website: c.websites?.[0]?.url || null,
    socials: (c.socials || []).map((s) => s.url),
    dexscreener: c.url || null,
    pumpfun: c.pumpFunUrl || null,
  };
}
