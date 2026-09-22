import { CoinData } from '../types/coin';
import { PumpFunService } from './pumpfun.service';

const DEXSCREENER_API = 'https://api.dexscreener.com';
const GECKOTERMINAL_API = 'https://api.geckoterminal.com/api/v2';
const GECKO_HEADERS = { Accept: 'application/json;version=20230302' };
const GECKO_NETWORK_TO_CHAIN: Record<string, string> = {
  solana: 'solana',
  eth: 'ethereum',
  base: 'base',
  bsc: 'bsc',
  arbitrum: 'arbitrum',
  polygon_pos: 'polygon',
  avax: 'avalanche',
  optimism: 'optimism',
};
const NEW_COINS_CACHE_TTL_MS = 8_000;
let geckoCache: { ts: number; data: CoinData[] } | null = null;
let geckoInFlight: Promise<CoinData[]> | null = null;

type TokenMeta = {
  chainId: string;
  tokenAddress: string;
  icon?: string;
  header?: string;
  description?: string;
  links?: any[];
};

const FEATURED_TOKENS_BY_CHAIN: Record<string, string[]> = {
  solana: [
    'So11111111111111111111111111111111111111112',
    'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    '7GCihgDB8fe6KNjn2g4g4Tf7w6VnFMy8P5x9W4yWpump',
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82',
    'MEVsmNkf3X3kHkT66W8RpH1KHz2Xb4EDQz981VdUMP2',
  ],
  ethereum: [
    '0x6982508145454Ce325dDbE47a25d4ec3d2311933',
    '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  ],
};

const TOP_COINS_CACHE_TTL_MS = 15_000;
let topCoinsCache: { ts: number; data: CoinData[] } | null = null;
let topCoinsInFlight: Promise<CoinData[]> | null = null;

function normalizeChainId(chainId: any): string {
  return String(chainId || '').toLowerCase();
}

function normalizeTokenAddress(address: any): string {
  const raw = String(address || '');
  if (!raw) return '';
  return raw.startsWith('0x') ? raw.toLowerCase() : raw;
}

function tokenKey(chainId: any, tokenAddress: any): string {
  const c = normalizeChainId(chainId);
  const a = normalizeTokenAddress(tokenAddress);
  return c && a ? `${c}:${a}` : `${c}:${a}`;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function applyTokenMetaToPair(pair: any, meta?: TokenMeta): any {
  if (!pair || !meta) return pair;
  pair.info = pair.info || {};
  pair.info.imageUrl = pair.info?.imageUrl || meta.icon;
  pair.info.header = pair.info?.header || meta.header;
  if (!pair.description && meta.description) pair.description = meta.description;
  return pair;
}

function pickBestPairs(pairs: any[], metaByKey: Map<string, TokenMeta>): any[] {
  const best = new Map<string, any>();
  pairs.forEach((pair: any) => {
    if (!pair?.baseToken?.address || !pair?.chainId) return;
    const key = tokenKey(pair.chainId, pair.baseToken.address);
    const prev = best.get(key);
    const liq = Number(pair?.liquidity?.usd) || 0;
    const prevLiq = Number(prev?.liquidity?.usd) || 0;
    const vol = Number(pair?.volume?.h24) || 0;
    const prevVol = Number(prev?.volume?.h24) || 0;

    if (!prev || liq > prevLiq || (liq === prevLiq && vol > prevVol)) {
      best.set(key, applyTokenMetaToPair(pair, metaByKey.get(key)));
    }
  });
  return Array.from(best.values());
}

async function fetchBestPairsForTokens(tokenMetas: TokenMeta[]): Promise<any[]> {
  const metaByKey = new Map<string, TokenMeta>();
  const tokensByChain = new Map<string, Set<string>>();

  tokenMetas.forEach((t) => {
    const chainId = normalizeChainId(t.chainId);
    const tokenAddress = normalizeTokenAddress(t.tokenAddress);
    if (!chainId || !tokenAddress) return;

    const key = tokenKey(chainId, tokenAddress);
    const existing = metaByKey.get(key);
    if (existing) {
      metaByKey.set(key, {
        chainId,
        tokenAddress,
        icon: existing.icon || t.icon,
        header: existing.header || t.header,
        description: existing.description || t.description,
        links: existing.links || t.links,
      });
    } else {
      metaByKey.set(key, { ...t, chainId, tokenAddress });
    }

    if (!tokensByChain.has(chainId)) tokensByChain.set(chainId, new Set());
    tokensByChain.get(chainId)!.add(tokenAddress);
  });

  const chainJobs = Array.from(tokensByChain.entries()).map(async ([chainId, addrSet]) => {
    const addrs = Array.from(addrSet);
    const chunks = chunkArray(addrs, 30);
    const chainPairs: any[] = [];

    for (const chunk of chunks) {
      const url = `${DEXSCREENER_API}/tokens/v1/${encodeURIComponent(chainId)}/${chunk.join(',')}`;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        if (Array.isArray(data)) chainPairs.push(...data);
      } catch {
        // ignore
      }
    }
    return chainPairs;
  });

  const settled = await Promise.allSettled(chainJobs);
  const allPairs: any[] = [];
  settled.forEach((r) => {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) allPairs.push(...r.value);
  });

  return pickBestPairs(allPairs, metaByKey);
}

function mapPairToCoinData(pair: any): CoinData {
  if (!pair) return null as any;
  const imageUrl = pair.info?.imageUrl || null;
  const headerUrl = pair.info?.header || null;

  const chainId = normalizeChainId(pair.chainId);
  const baseAddress = normalizeTokenAddress(pair.baseToken?.address || pair.tokenAddress);
  const id = chainId && baseAddress ? `${chainId}:${baseAddress}` : (baseAddress || Math.random().toString());

  return {
    id,
    name: pair.baseToken?.name || pair.description || 'Unknown',
    symbol: pair.baseToken?.symbol || '?',
    priceUsd: Number(pair.priceUsd) || 0,
    priceChange24h: Number(pair.priceChange?.h24) || 0,
    priceChange5m: Number(pair.priceChange?.m5) || 0,
    priceChange1h: Number(pair.priceChange?.h1) || 0,
    priceChange6h: Number(pair.priceChange?.h6) || 0,
    fundamentals: {
      marketCap: Number(pair.marketCap || pair.fdv || pair.liquidity?.usd || 0),
      circulatingSupply: 0,
      volume24h: Number(pair.volume?.h24 || 0),
      tvl: Number(pair.liquidity?.usd || 0),
    },
    imageUrl: imageUrl,
    headerUrl: headerUrl,
    chainId: chainId,
    dexId: String(pair.dexId || ''),
    pairAddress: String(pair.pairAddress || ''),
    url: String(pair.url || ''),
    createdAt: Number(pair.pairCreatedAt || 0),
    txns24h: pair.txns?.h24 ? { buys: Number(pair.txns.h24.buys) || 0, sells: Number(pair.txns.h24.sells) || 0 } : undefined,
    websites: Array.isArray(pair.info?.websites) ? pair.info.websites : [],
    socials: Array.isArray(pair.info?.socials) ? pair.info.socials : [],
    mint: baseAddress || undefined,
    source: 'dexscreener',
    isPumpFun: chainId === 'solana' && (String(pair.dexId || '').startsWith('pump') || baseAddress.endsWith('pump')),
    graduated: chainId === 'solana' && baseAddress.endsWith('pump') ? true : undefined,
    poolType: String(pair.dexId || '') || undefined,
    pumpFunUrl: chainId === 'solana' && baseAddress.endsWith('pump') ? `https://pump.fun/coin/${baseAddress}` : undefined,
  };
}

/** Maps a GeckoTerminal pool resource (new_pools endpoint) into CoinData. */
function mapGeckoPoolToCoinData(pool: any): CoinData | null {
  const attrs = pool?.attributes;
  if (!attrs) return null;
  const baseTokenId: string = pool?.relationships?.base_token?.data?.id || '';
  const networkId: string = pool?.relationships?.network?.data?.id || baseTokenId.split('_')[0] || '';
  const chainId = GECKO_NETWORK_TO_CHAIN[networkId] || normalizeChainId(networkId);
  const baseAddress = normalizeTokenAddress(baseTokenId.slice(baseTokenId.indexOf('_') + 1));
  if (!chainId || !baseAddress) return null;

  const [baseName] = String(attrs.name || '').split(' / ');
  const priceUsd = Number(attrs.base_token_price_usd) || 0;
  const change = attrs.price_change_percentage || {};
  const tx24 = attrs.transactions?.h24;
  const dexId = String(pool?.relationships?.dex?.data?.id || '');
  const isPump = chainId === 'solana' && (dexId.startsWith('pump') || baseAddress.endsWith('pump'));

  return {
    id: `${chainId}:${baseAddress}`,
    mint: baseAddress,
    name: baseName || 'Unknown',
    symbol: (baseName || '?').toUpperCase().slice(0, 12),
    priceUsd,
    priceChange24h: Number(change.h24) || 0,
    priceChange5m: Number(change.m5) || 0,
    priceChange1h: Number(change.h1) || 0,
    priceChange6h: Number(change.h6) || 0,
    fundamentals: {
      marketCap: Number(attrs.market_cap_usd || attrs.fdv_usd || 0),
      circulatingSupply: 0,
      volume24h: Number(attrs.volume_usd?.h24 || 0),
      tvl: Number(attrs.reserve_in_usd || 0),
    },
    chainId,
    dexId,
    pairAddress: String(attrs.address || ''),
    url: `https://dexscreener.com/${chainId}/${baseAddress}`,
    createdAt: attrs.pool_created_at ? new Date(attrs.pool_created_at).getTime() : undefined,
    txns24h: tx24 ? { buys: Number(tx24.buys) || 0, sells: Number(tx24.sells) || 0 } : undefined,
    source: 'gecko',
    isPumpFun: isPump,
    graduated: isPump ? true : undefined,
    poolType: dexId || undefined,
    pumpFunUrl: isPump ? `https://pump.fun/coin/${baseAddress}` : undefined,
  };
}

export const CoinService = {
  async searchCoins(query: string): Promise<CoinData[]> {
    if (!query) return [];
    try {
      const response = await fetch(`${DEXSCREENER_API}/latest/dex/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (!data || !Array.isArray(data.pairs)) return [];

      const uniqueTokens = new Map<string, any>();
      data.pairs.forEach((pair: any) => {
        if (!pair || !pair.baseToken) return;
        const key = tokenKey(pair.chainId, pair.baseToken.address);
        if (!uniqueTokens.has(key) || (uniqueTokens.get(key).liquidity?.usd || 0) < (pair.liquidity?.usd || 0)) {
          uniqueTokens.set(key, pair);
        }
      });

      return Array.from(uniqueTokens.values()).slice(0, 20).map(mapPairToCoinData);
    } catch (error) {
      return [];
    }
  },

  async getTopCoins(options?: { limit?: number }): Promise<CoinData[]> {
    const limit = Math.max(1, Number(options?.limit ?? 80));
    const now = Date.now();

    if (topCoinsCache && now - topCoinsCache.ts < TOP_COINS_CACHE_TTL_MS) {
      return topCoinsCache.data.slice(0, limit);
    }

    if (topCoinsInFlight) {
      const data = await topCoinsInFlight;
      return data.slice(0, limit);
    }

    topCoinsInFlight = (async () => {
      const tokenMetas: TokenMeta[] = [];

      // Always include a small set of featured tokens (good fallback for "old" coins)
      Object.entries(FEATURED_TOKENS_BY_CHAIN).forEach(([chainId, addrs]) => {
        addrs.forEach((a) => tokenMetas.push({ chainId, tokenAddress: a }));
      });

      const [boostsTop, profilesLatest, profilesRecent] = await Promise.allSettled([
        fetch(`${DEXSCREENER_API}/token-boosts/top/v1`).then((r) => (r.ok ? r.json() : [])),
        fetch(`${DEXSCREENER_API}/token-profiles/latest/v1`).then((r) => (r.ok ? r.json() : [])),
        fetch(`${DEXSCREENER_API}/token-profiles/recent-updates/v1`).then((r) => (r.ok ? r.json() : [])),
      ]);

      const addFromList = (items: any, max: number) => {
        if (!Array.isArray(items)) return;
        items.slice(0, max).forEach((item: any) => {
          if (!item?.chainId || !item?.tokenAddress) return;
          tokenMetas.push({
            chainId: item.chainId,
            tokenAddress: item.tokenAddress,
            icon: item.icon,
            header: item.header,
            description: item.description,
            links: item.links,
          });
        });
      };

      addFromList(boostsTop.status === 'fulfilled' ? boostsTop.value : [], 40);
      addFromList(profilesLatest.status === 'fulfilled' ? profilesLatest.value : [], 40);
      addFromList(profilesRecent.status === 'fulfilled' ? profilesRecent.value : [], 60);

      // Fetch best pairs for the combined token set
      const pairs = await fetchBestPairsForTokens(tokenMetas.slice(0, 160));
      const coins = pairs
        .map(mapPairToCoinData)
        .filter(Boolean)
        .sort((a, b) => (b.fundamentals.volume24h || 0) - (a.fundamentals.volume24h || 0));

      // Final fallback: only featured tokens
      if (coins.length === 0) {
        const featuredPairs = await fetchBestPairsForTokens(
          Object.entries(FEATURED_TOKENS_BY_CHAIN).flatMap(([chainId, addrs]) =>
            addrs.map((tokenAddress) => ({ chainId, tokenAddress }))
          )
        );
        return featuredPairs
          .map(mapPairToCoinData)
          .filter(Boolean)
          .sort((a, b) => (b.fundamentals.volume24h || 0) - (a.fundamentals.volume24h || 0));
      }

      return coins;
    })();

    try {
      const data = await topCoinsInFlight;
      topCoinsCache = { ts: Date.now(), data };
      return data.slice(0, limit);
    } catch {
      return [];
    } finally {
      topCoinsInFlight = null;
    }
  },

  async getBoostedTokens(): Promise<CoinData[]> {
    try {
      const response = await fetch(`${DEXSCREENER_API}/token-boosts/latest/v1`);
      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) return [];

      const uniqueTokens = new Map<string, TokenMeta>();
      data.forEach((item: any) => {
        if (!item?.chainId || !item?.tokenAddress) return;
        const key = tokenKey(item.chainId, item.tokenAddress);
        if (!uniqueTokens.has(key)) {
          uniqueTokens.set(key, {
            chainId: item.chainId,
            tokenAddress: item.tokenAddress,
            icon: item.icon,
            header: item.header,
            description: item.description,
            links: item.links,
          });
        }
      });

      const tokenEntries = Array.from(uniqueTokens.values()).slice(0, 80);
      const pairs = await fetchBestPairsForTokens(tokenEntries);
      return pairs
        .map(mapPairToCoinData)
        .filter(Boolean)
        .sort((a, b) => (b.fundamentals.volume24h || 0) - (a.fundamentals.volume24h || 0));
    } catch (error) {
      return [];
    }
  },

  /**
   * Newest pools across chains from GeckoTerminal (public API, CORS enabled).
   * This is the widest "just launched" source for non-Pump.fun DEX listings.
   */
  async getGeckoNewPools(): Promise<CoinData[]> {
    const now = Date.now();
    if (geckoCache && now - geckoCache.ts < NEW_COINS_CACHE_TTL_MS) return geckoCache.data;
    if (geckoInFlight) return geckoInFlight;

    geckoInFlight = (async () => {
      try {
        const [allRes, solRes] = await Promise.allSettled([
          fetch(`${GECKOTERMINAL_API}/networks/new_pools?page=1`, { headers: GECKO_HEADERS }).then((r) => (r.ok ? r.json() : null)),
          fetch(`${GECKOTERMINAL_API}/networks/solana/new_pools?page=1`, { headers: GECKO_HEADERS }).then((r) => (r.ok ? r.json() : null)),
        ]);
        const pools: any[] = [];
        [allRes, solRes].forEach((r) => {
          if (r.status === 'fulfilled' && Array.isArray(r.value?.data)) pools.push(...r.value.data);
        });
        const seen = new Set<string>();
        const coins: CoinData[] = [];
        pools.forEach((p) => {
          const c = mapGeckoPoolToCoinData(p);
          if (!c || seen.has(c.id)) return;
          seen.add(c.id);
          coins.push(c);
        });
        geckoCache = { ts: Date.now(), data: coins };
        return coins;
      } catch {
        return geckoCache?.data || [];
      } finally {
        geckoInFlight = null;
      }
    })();

    return geckoInFlight;
  },

  /** DexScreener "latest token profiles" resolved to their best trading pair. */
  async getLatestDexProfiles(): Promise<CoinData[]> {
    try {
      const dexProfilesData = await fetch(`${DEXSCREENER_API}/token-profiles/latest/v1`).then((r) => (r.ok ? r.json() : []));
      const uniqueTokens = new Map<string, TokenMeta>();
      if (Array.isArray(dexProfilesData)) {
        dexProfilesData.forEach((item: any) => {
          if (!item?.chainId || !item?.tokenAddress) return;
          const key = tokenKey(item.chainId, item.tokenAddress);
          if (!uniqueTokens.has(key)) {
            uniqueTokens.set(key, {
              chainId: item.chainId,
              tokenAddress: item.tokenAddress,
              icon: item.icon,
              header: item.header,
              description: item.description,
              links: item.links,
            });
          }
        });
      }
      const tokenEntries = Array.from(uniqueTokens.values()).slice(0, 45);
      const pairs = await fetchBestPairsForTokens(tokenEntries);
      return pairs.map(mapPairToCoinData).filter(Boolean);
    } catch {
      return [];
    }
  },

  /**
   * Combined "very new coins" feed: Pump.fun launches + GeckoTerminal new pools + DexScreener profiles,
   * de-duplicated and sorted newest first.
   */
  async getNewCoins(options?: { maxAgeMinutes?: number }): Promise<CoinData[]> {
    const [pumpRes, geckoRes, dexRes] = await Promise.allSettled([
      PumpFunService.getLatestPumpFunCoins(30),
      CoinService.getGeckoNewPools(),
      CoinService.getLatestDexProfiles(),
    ]);

    const merged = new Map<string, CoinData>();
    const push = (list: CoinData[]) => {
      list.forEach((c) => {
        if (!c?.id) return;
        const prev = merged.get(c.id);
        if (!prev) {
          merged.set(c.id, c);
          return;
        }
        const earliest = [prev.createdAt, c.createdAt].filter((t): t is number => !!t);
        merged.set(c.id, {
          ...prev,
          ...c,
          imageUrl: prev.imageUrl || c.imageUrl,
          createdAt: earliest.length ? Math.min(...earliest) : undefined,
          fundamentals: {
            marketCap: c.fundamentals.marketCap || prev.fundamentals.marketCap,
            circulatingSupply: c.fundamentals.circulatingSupply || prev.fundamentals.circulatingSupply,
            volume24h: c.fundamentals.volume24h || prev.fundamentals.volume24h,
            tvl: c.fundamentals.tvl || prev.fundamentals.tvl,
          },
        });
      });
    };

    push(pumpRes.status === 'fulfilled' ? pumpRes.value : []);
    push(geckoRes.status === 'fulfilled' ? geckoRes.value : []);
    push(dexRes.status === 'fulfilled' ? dexRes.value : []);

    const maxAgeMs = options?.maxAgeMinutes ? options.maxAgeMinutes * 60_000 : 0;
    const now = Date.now();

    return Array.from(merged.values())
      .filter((c) => !maxAgeMs || !c.createdAt || now - c.createdAt <= maxAgeMs)
      .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  },

  /** Backwards-compatible alias. */
  async getLatestProfiles(): Promise<CoinData[]> {
    return CoinService.getNewCoins();
  },

  /**
   * Latest DexScreener quotes for specific tokens (used to mark open positions to market).
   * Returns a map keyed by `chain:address`.
   */
  async getTokenQuotes(tokens: { chainId: string; address: string }[]): Promise<Map<string, CoinData>> {
    const out = new Map<string, CoinData>();
    if (tokens.length === 0) return out;
    const pairs = await fetchBestPairsForTokens(tokens.map((t) => ({ chainId: t.chainId, tokenAddress: t.address })));
    pairs.forEach((pair) => {
      const coin = mapPairToCoinData(pair);
      if (coin) out.set(coin.id, coin);
    });
    return out;
  },
};
