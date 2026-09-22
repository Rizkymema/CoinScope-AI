import { CoinData } from '../types/coin';
import { SolPriceService } from './solprice.service';

/** Pump.fun tokens always mint 1B supply with 6 decimals. */
export const PUMPFUN_TOTAL_SUPPLY = 1_000_000_000;
export const PUMPFUN_DECIMALS = 6;
/** A bonding curve completes at ~85 SOL collected (~$69k at older SOL prices). */
export const PUMPFUN_GRADUATION_SOL = 85;

export interface PumpFunCoin {
  mint: string;
  name: string;
  symbol: string;
  description?: string;
  image_uri?: string;
  metadata_uri?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  bonding_curve?: string;
  associated_bonding_curve?: string;
  creator?: string;
  created_timestamp?: number;
  raydium_pool?: string | null;
  complete?: boolean;
  virtual_sol_reserves?: number;
  virtual_token_reserves?: number;
  real_sol_reserves?: number;
  real_token_reserves?: number;
  total_supply?: number;
  market_cap?: number;
  usd_market_cap?: number;
  /** Newer field name for the same figure. */
  market_cap_usd?: number;
  pool_address?: string;
  program?: string;
  protocol?: string;
  quote_mint?: string;
  quote_decimals?: number;
  reply_count?: number;
  nsfw?: boolean;
  king_of_the_hill_timestamp?: number | null;
}

/** Shape of a `subscribeNewToken` message from the PumpPortal WebSocket. */
export interface PumpPortalNewToken {
  signature?: string;
  mint: string;
  traderPublicKey?: string;
  txType?: string;
  initialBuy?: number;
  solAmount?: number;
  bondingCurveKey?: string;
  vTokensInBondingCurve?: number;
  vSolInBondingCurve?: number;
  marketCapSol?: number;
  name?: string;
  symbol?: string;
  uri?: string;
  pool?: string;
}

const metadataCache = new Map<string, { image?: string; description?: string }>();
const metadataInFlight = new Map<string, Promise<{ image?: string; description?: string } | null>>();

/**
 * Curve progress from the SOL actually collected.
 *
 * The virtual-reserve figure is unreliable now that pump.fun serves several protocols and
 * quote mints (some rows report reserves far below the classic 30 SOL start), which made a
 * virtual-reserve formula report 100% for empty tokens. Real reserves against the ~85 SOL
 * graduation target is the definition of progress and degrades safely to 0.
 */
function curvePercentFromRealSol(realSol: number | undefined): number | undefined {
  if (realSol === undefined || !Number.isFinite(realSol) || realSol < 0) return undefined;
  return Math.max(0, Math.min(100, Math.round((realSol / PUMPFUN_GRADUATION_SOL) * 100)));
}

/** Stream events report virtual reserves in SOL starting at 30, so they still use the offset form. */
function curvePercentFromVirtualSol(vSol: number | undefined): number | undefined {
  if (!vSol || !Number.isFinite(vSol) || vSol < 30) return 0;
  return Math.max(0, Math.min(100, Math.round(((vSol - 30) / PUMPFUN_GRADUATION_SOL) * 100)));
}

export const PumpFunService = {
  /**
   * Latest coins launched on Pump.fun, fetched through our own API route
   * (the pump.fun frontend API is not CORS-enabled for browsers).
   */
  async getLatestPumpFunCoins(limit = 30): Promise<CoinData[]> {
    try {
      const res = await fetch(`/api/pumpfun/latest?limit=${limit}`, { cache: 'no-store' });
      if (!res.ok) return [];
      const data = await res.json();
      const coins: PumpFunCoin[] = Array.isArray(data?.coins) ? data.coins : [];
      const solPrice = await SolPriceService.getSolPriceUsd();
      return coins.map((c) => PumpFunService.mapPumpFunToCoinData(c, solPrice)).filter(Boolean) as CoinData[];
    } catch {
      return [];
    }
  },

  /** Maps a pump.fun REST coin object into CoinData using only real fields. */
  mapPumpFunToCoinData(item: PumpFunCoin, solPriceUsd = SolPriceService.getCached()): CoinData | null {
    if (!item?.mint) return null;
    const mint = item.mint;
    const supply = item.total_supply ? item.total_supply / 10 ** PUMPFUN_DECIMALS : PUMPFUN_TOTAL_SUPPLY;

    let priceSol = 0;
    if (item.virtual_sol_reserves && item.virtual_token_reserves) {
      priceSol = item.virtual_sol_reserves / 1e9 / (item.virtual_token_reserves / 10 ** PUMPFUN_DECIMALS);
    } else if (item.market_cap) {
      priceSol = item.market_cap / supply;
    }

    const mcapUsd =
      item.usd_market_cap || item.market_cap_usd || (priceSol && solPriceUsd ? priceSol * supply * solPriceUsd : 0);
    const priceUsd = mcapUsd > 0 ? mcapUsd / supply : priceSol * solPriceUsd;
    const realSol = typeof item.real_sol_reserves === 'number' ? item.real_sol_reserves / 1e9 : undefined;
    const bondingCurve = item.complete ? 100 : curvePercentFromRealSol(realSol) ?? 0;
    const liquiditySol = realSol ?? 0;

    return {
      id: `solana:${mint}`,
      mint,
      name: item.name || 'Unknown',
      symbol: (item.symbol || '???').toUpperCase(),
      priceUsd,
      priceSol,
      priceChange24h: 0,
      fundamentals: {
        marketCap: mcapUsd,
        circulatingSupply: supply,
        volume24h: 0,
        tvl: liquiditySol * solPriceUsd,
      },
      imageUrl: item.image_uri,
      chainId: 'solana',
      dexId: item.complete ? 'raydium' : 'pumpfun',
      pairAddress: item.raydium_pool || item.bonding_curve || mint,
      url: `https://dexscreener.com/solana/${mint}`,
      createdAt: item.created_timestamp || undefined,
      isPumpFun: true,
      bondingCurve,
      graduated: !!item.complete,
      pumpFunUrl: `https://pump.fun/coin/${mint}`,
      metadataUri: item.metadata_uri,
      description: item.description,
      source: 'pumpfun',
      poolType: item.complete ? 'raydium' : 'pump',
      websites: item.website ? [{ label: 'Website', url: item.website }] : [],
      socials: [
        item.twitter ? { type: 'twitter', url: item.twitter } : null,
        item.telegram ? { type: 'telegram', url: item.telegram } : null,
      ].filter(Boolean) as { type: string; url: string }[],
    };
  },

  /** Maps a PumpPortal `create` event into CoinData (price derived from the virtual reserves). */
  mapPumpPortalNewToken(evt: PumpPortalNewToken, solPriceUsd = SolPriceService.getCached()): CoinData | null {
    if (!evt?.mint) return null;
    // Some launchpads (e.g. bonk) emit creations without any metadata - nothing to evaluate or display.
    if (!evt.name && !evt.symbol) return null;
    const vSol = Number(evt.vSolInBondingCurve) || 0;
    const vTokens = Number(evt.vTokensInBondingCurve) || 0;
    const priceSol = vSol > 0 && vTokens > 0 ? vSol / vTokens : (Number(evt.marketCapSol) || 0) / PUMPFUN_TOTAL_SUPPLY;
    const marketCapSol = Number(evt.marketCapSol) || priceSol * PUMPFUN_TOTAL_SUPPLY;
    const pool = evt.pool || 'pump';

    return {
      id: `solana:${evt.mint}`,
      mint: evt.mint,
      name: evt.name || 'New Token',
      symbol: (evt.symbol || '???').toUpperCase(),
      priceUsd: priceSol * solPriceUsd,
      priceSol,
      priceChange24h: 0,
      fundamentals: {
        marketCap: marketCapSol * solPriceUsd,
        circulatingSupply: PUMPFUN_TOTAL_SUPPLY,
        volume24h: (Number(evt.solAmount) || 0) * solPriceUsd,
        tvl: Math.max(0, vSol - 30) * solPriceUsd,
      },
      chainId: 'solana',
      dexId: pool,
      pairAddress: evt.bondingCurveKey || evt.mint,
      url: `https://dexscreener.com/solana/${evt.mint}`,
      createdAt: Date.now(),
      isPumpFun: pool === 'pump' || pool === 'pump-amm' || evt.mint.toLowerCase().endsWith('pump'),
      bondingCurve: curvePercentFromVirtualSol(vSol) ?? 0,
      graduated: false,
      pumpFunUrl: `https://pump.fun/coin/${evt.mint}`,
      metadataUri: evt.uri,
      source: 'pumpportal',
      poolType: pool,
      txns24h: { buys: evt.initialBuy ? 1 : 0, sells: 0 },
    };
  },

  /**
   * Resolves the token image/description from the Metaplex metadata URI via our API route
   * (IPFS gateways are slow and frequently block cross-origin requests).
   */
  async resolveMetadata(uri?: string): Promise<{ image?: string; description?: string } | null> {
    if (!uri) return null;
    if (metadataCache.has(uri)) return metadataCache.get(uri)!;
    if (metadataInFlight.has(uri)) return metadataInFlight.get(uri)!;

    const job = (async () => {
      try {
        const res = await fetch(`/api/metadata?uri=${encodeURIComponent(uri)}`);
        if (!res.ok) return null;
        const data = await res.json();
        const out = { image: data?.image as string | undefined, description: data?.description as string | undefined };
        metadataCache.set(uri, out);
        return out;
      } catch {
        return null;
      } finally {
        metadataInFlight.delete(uri);
      }
    })();

    metadataInFlight.set(uri, job);
    return job;
  },
};
