import { CoinData } from '../types/coin';

const DEXSCREENER_API = 'https://api.dexscreener.com';

function mapPairToCoinData(pair: any): CoinData {
  if (!pair) return null as any;
  const imageUrl = pair.info?.imageUrl || null;
  const headerUrl = pair.info?.header || null;

  return {
    id: pair.baseToken?.address || pair.tokenAddress || Math.random().toString(),
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
    chainId: String(pair.chainId || ''),
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
        const tokenId = pair.baseToken.address;
        if (!uniqueTokens.has(tokenId) || (uniqueTokens.get(tokenId).liquidity?.usd || 0) < (pair.liquidity?.usd || 0)) {
          uniqueTokens.set(tokenId, pair);
        }
      });

      return Array.from(uniqueTokens.values()).slice(0, 20).map(mapPairToCoinData);
    } catch (error) {
      return [];
    }
  },

  async getCoinBySymbol(symbolOrAddress: string): Promise<CoinData | null> {
    try {
      const response = await fetch(`${DEXSCREENER_API}/latest/dex/search?q=${encodeURIComponent(symbolOrAddress)}`);
      const data = await response.json();
      if (!data || !Array.isArray(data.pairs) || data.pairs.length === 0) return null;

      const bestPair = data.pairs.reduce((prev: any, current: any) => {
        return ((prev?.liquidity?.usd || 0) > (current?.liquidity?.usd || 0)) ? prev : current;
      });

      return mapPairToCoinData(bestPair);
    } catch (error) {
      return null;
    }
  },

  async getTopCoins(): Promise<CoinData[]> {
    try {
      const addresses = [
        'So11111111111111111111111111111111111111112',
        '0x6982508145454Ce325dDbE47a25d4ec3d2311933',
        'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
        '7GCihgDB8fe6KNjn2g4g4Tf7w6VnFMy8P5x9W4yWpump',
        'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
        '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82',
        'MEVsmNkf3X3kHkT66W8RpH1KHz2Xb4EDQz981VdUMP2'
      ].join(',');

      const response = await fetch(`${DEXSCREENER_API}/latest/dex/tokens/${addresses}`);
      const data = await response.json();
      if (!data || !Array.isArray(data.pairs)) return [];

      const uniqueTokens = new Map<string, any>();
      data.pairs.forEach((pair: any) => {
        if (!pair || !pair.baseToken) return;
        const tokenId = pair.baseToken.address;
        if (!uniqueTokens.has(tokenId) || (uniqueTokens.get(tokenId).liquidity?.usd || 0) < (pair.liquidity?.usd || 0)) {
          uniqueTokens.set(tokenId, pair);
        }
      });

      return Array.from(uniqueTokens.values())
        .sort((a, b) => (Number(b.volume?.h24) || 0) - (Number(a.volume?.h24) || 0))
        .map(mapPairToCoinData);
    } catch (error) {
      return [];
    }
  },

  async getBoostedTokens(): Promise<CoinData[]> {
    try {
      const response = await fetch(`${DEXSCREENER_API}/token-boosts/latest/v1`);
      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) return [];

      const uniqueTokens = new Map<string, any>();
      data.forEach((item: any) => {
        if (!item || !item.tokenAddress) return;
        const key = `${item.chainId}:${item.tokenAddress}`;
        if (!uniqueTokens.has(key)) {
          uniqueTokens.set(key, item);
        }
      });

      const tokenEntries = Array.from(uniqueTokens.values());
      const results: CoinData[] = [];
      const batchSize = 10;
      
      for (let i = 0; i < tokenEntries.length; i += batchSize) {
        const batch = tokenEntries.slice(i, i + batchSize);
        const addresses = batch.map((t: any) => t.tokenAddress).join(',');
        
        try {
          const pairResponse = await fetch(`${DEXSCREENER_API}/latest/dex/tokens/${addresses}`);
          const pairData = await pairResponse.json();
          
          if (pairData && Array.isArray(pairData.pairs)) {
            const seen = new Set<string>();
            pairData.pairs.forEach((pair: any) => {
              if (!pair || !pair.baseToken) return;
              const tokenId = String(pair.baseToken.address);
              if (tokenId && !seen.has(tokenId)) {
                seen.add(tokenId);
                const boostInfo = batch.find((b: any) => 
                  String(b.tokenAddress).toLowerCase() === tokenId.toLowerCase()
                );
                if (boostInfo) {
                  pair.info = pair.info || {};
                  pair.info.imageUrl = pair.info?.imageUrl || boostInfo.icon;
                  pair.info.header = pair.info?.header || boostInfo.header;
                }
                results.push(mapPairToCoinData(pair));
              }
            });
          }
        } catch { }
      }
      return results;
    } catch (error) {
      return [];
    }
  },

  async getLatestProfiles(): Promise<CoinData[]> {
    try {
      const response = await fetch(`${DEXSCREENER_API}/token-profiles/latest/v1`);
      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) return [];

      const uniqueTokens = new Map<string, any>();
      data.forEach((item: any) => {
        if (!item || !item.tokenAddress) return;
        const key = `${item.chainId}:${item.tokenAddress}`;
        if (!uniqueTokens.has(key)) {
          uniqueTokens.set(key, item);
        }
      });

      // Keep this bounded: the UI only shows a small window of newest coins
      // and this method is polled frequently by the live feed.
      const tokenEntries = Array.from(uniqueTokens.values()).slice(0, 60);
      const results: CoinData[] = [];
      const batchSize = 20;

      for (let i = 0; i < tokenEntries.length; i += batchSize) {
        const batch = tokenEntries.slice(i, i + batchSize);
        const addresses = batch.map((t: any) => t.tokenAddress).join(',');

        try {
          const pairResponse = await fetch(`${DEXSCREENER_API}/latest/dex/tokens/${addresses}`);
          const pairData = await pairResponse.json();

          if (pairData && Array.isArray(pairData.pairs)) {
            const seen = new Set<string>();
            pairData.pairs.forEach((pair: any) => {
              if (!pair || !pair.baseToken) return;
              const tokenId = String(pair.baseToken.address);
              if (tokenId && !seen.has(tokenId)) {
                seen.add(tokenId);
                const profileInfo = batch.find((b: any) =>
                  String(b.tokenAddress).toLowerCase() === tokenId.toLowerCase()
                );
                if (profileInfo) {
                  pair.info = pair.info || {};
                  pair.info.imageUrl = pair.info?.imageUrl || profileInfo.icon;
                  pair.info.header = pair.info?.header || profileInfo.header;
                }
                results.push(mapPairToCoinData(pair));
              }
            });
          }
        } catch { }
      }
      return results;
    } catch (error) {
      return [];
    }
  }
};
