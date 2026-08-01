import { CoinData } from '../types/coin';

const DEXSCREENER_API = 'https://api.dexscreener.com';

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

  async getLatestProfiles(): Promise<CoinData[]> {
    try {
      const response = await fetch(`${DEXSCREENER_API}/token-profiles/latest/v1`);
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

      // Keep this bounded: the UI only shows a small window of newest coins
      // and this method is polled frequently by the live feed.
      const tokenEntries = Array.from(uniqueTokens.values()).slice(0, 60);
      const pairs = await fetchBestPairsForTokens(tokenEntries);
      return pairs
        .map(mapPairToCoinData)
        .filter(Boolean)
        .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    } catch (error) {
      return [];
    }
  }
};
