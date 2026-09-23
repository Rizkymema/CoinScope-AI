import { CoinData } from '../types/coin';
import { TokenTradeEvent } from '../types/bot';
import { SolPriceService } from './solprice.service';

/**
 * OHLCV candles for the price chart.
 *
 * Primary source is GeckoTerminal (free, CORS-enabled, no key). Tokens that are minutes
 * old have no pool indexed there yet, so those fall back to candles aggregated live from
 * the PumpPortal trade stream.
 */

const GECKO = 'https://api.geckoterminal.com/api/v2';
const HEADERS = { Accept: 'application/json;version=20230302' };

/**
 * Chain id used across the app -> GeckoTerminal network id.
 * Only ids that actually differ need an entry; anything else is passed through, which
 * covers the newer chains (robinhood, arc, hyperliquid, berachain, abstract, ...) that
 * both DexScreener and GeckoTerminal name identically.
 */
const NETWORK_ALIAS: Record<string, string> = {
  ethereum: 'eth',
  polygon: 'polygon_pos',
  avalanche: 'avax',
  sui: 'sui-network',
  binancecoin: 'bsc',
  bnb: 'bsc',
};

export interface Candle {
  /** Unix seconds, the format lightweight-charts expects. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type TimeframeId = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export const TIMEFRAMES: { id: TimeframeId; label: string; path: string; aggregate: number; seconds: number }[] = [
  { id: '1m', label: '1m', path: 'minute', aggregate: 1, seconds: 60 },
  { id: '5m', label: '5m', path: 'minute', aggregate: 5, seconds: 300 },
  { id: '15m', label: '15m', path: 'minute', aggregate: 15, seconds: 900 },
  { id: '1h', label: '1H', path: 'hour', aggregate: 1, seconds: 3600 },
  { id: '4h', label: '4H', path: 'hour', aggregate: 4, seconds: 14400 },
  { id: '1d', label: '1D', path: 'day', aggregate: 1, seconds: 86400 },
];

export const timeframeOf = (id: TimeframeId) => TIMEFRAMES.find((t) => t.id === id) ?? TIMEFRAMES[1];

/* ------------------------------------------------------------------ caching */

const poolCache = new Map<string, { pool: string | null; ts: number }>();
const candleCache = new Map<string, { candles: Candle[]; ts: number }>();
const POOL_TTL_MS = 5 * 60_000;
const CANDLE_TTL_MS = 15_000;

/* ------------------------------------------------------------------ live tick candles */

/**
 * Rolling candles built from PumpPortal trades, for tokens too new to be indexed.
 * Keyed by mint; capped so a long session cannot grow without bound.
 */
const liveBuckets = new Map<string, Candle[]>();
const MAX_LIVE_CANDLES = 240;

export function recordTradeForChart(trade: TokenTradeEvent, solPriceUsd = SolPriceService.getCached()): void {
  if (!trade?.mint || !trade.priceSol || !solPriceUsd) return;
  const price = trade.priceSol * solPriceUsd;
  if (!Number.isFinite(price) || price <= 0) return;

  // Live fallback candles are always 1-minute buckets; the chart aggregates further if needed.
  const bucket = Math.floor(trade.timestamp / 1000 / 60) * 60;
  const list = liveBuckets.get(trade.mint) ?? [];
  const last = list[list.length - 1];
  const volumeUsd = (trade.solAmount || 0) * solPriceUsd;

  if (last && last.time === bucket) {
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    last.close = price;
    last.volume += volumeUsd;
  } else {
    list.push({ time: bucket, open: last?.close ?? price, high: price, low: price, close: price, volume: volumeUsd });
    if (list.length > MAX_LIVE_CANDLES) list.splice(0, list.length - MAX_LIVE_CANDLES);
  }
  liveBuckets.set(trade.mint, list);
}

export function getLiveCandles(mint?: string): Candle[] {
  if (!mint) return [];
  return (liveBuckets.get(mint) ?? []).map((c) => ({ ...c }));
}

/** Re-buckets 1-minute live candles into a larger timeframe. */
function aggregate(candles: Candle[], seconds: number): Candle[] {
  if (seconds <= 60) return candles;
  const out: Candle[] = [];
  candles.forEach((c) => {
    const bucket = Math.floor(c.time / seconds) * seconds;
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else {
      out.push({ ...c, time: bucket });
    }
  });
  return out;
}

/* ------------------------------------------------------------------ remote candles */

export const ChartService = {
  networkFor(chainId?: string): string | null {
    const id = String(chainId || '').trim().toLowerCase();
    if (!id) return null;
    return NETWORK_ALIAS[id] ?? id;
  },

  /** Deepest pool for a token, so the chart follows the pair people actually trade. */
  async resolvePool(chainId: string, tokenAddress: string): Promise<string | null> {
    const network = this.networkFor(chainId);
    if (!network || !tokenAddress) return null;

    const key = `${network}:${tokenAddress}`;
    const hit = poolCache.get(key);
    if (hit && Date.now() - hit.ts < POOL_TTL_MS) return hit.pool;

    try {
      const res = await fetch(`${GECKO}/networks/${network}/tokens/${tokenAddress}/pools?page=1`, { headers: HEADERS });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const pools: any[] = Array.isArray(data?.data) ? data.data : [];
      const wanted = tokenAddress.toLowerCase();
      const isBase = (p: any) =>
        String(p?.relationships?.base_token?.data?.id || '').toLowerCase().endsWith(`_${wanted}`);
      // A pool where the token is the base side is its canonical chart; fall back to depth.
      const best = pools
        .slice()
        .sort((a, b) => {
          const byBase = Number(isBase(b)) - Number(isBase(a));
          if (byBase !== 0) return byBase;
          return Number(b?.attributes?.reserve_in_usd || 0) - Number(a?.attributes?.reserve_in_usd || 0);
        })[0];
      const address = best?.attributes?.address ? String(best.attributes.address) : null;
      poolCache.set(key, { pool: address, ts: Date.now() });
      return address;
    } catch {
      poolCache.set(key, { pool: null, ts: Date.now() });
      return null;
    }
  },

  async getCandles(
    chainId: string,
    poolAddress: string,
    timeframe: TimeframeId,
    tokenAddress?: string,
    limit = 500
  ): Promise<Candle[]> {
    const network = this.networkFor(chainId);
    if (!network || !poolAddress) return [];
    const tf = timeframeOf(timeframe);
    const key = `${network}:${poolAddress}:${timeframe}:${tokenAddress || 'base'}`;
    const hit = candleCache.get(key);
    if (hit && Date.now() - hit.ts < CANDLE_TTL_MS) return hit.candles;

    try {
      // Without `token` the API charts whichever side is the pool's base, which for a
      // SOL-quoted pair is the *other* token entirely.
      const url =
        `${GECKO}/networks/${network}/pools/${poolAddress}/ohlcv/${tf.path}` +
        `?aggregate=${tf.aggregate}&limit=${Math.min(1000, limit)}&currency=usd` +
        (tokenAddress ? `&token=${encodeURIComponent(tokenAddress)}` : '');
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const rows: number[][] = data?.data?.attributes?.ohlcv_list ?? [];

      const candles = rows
        .map(([time, open, high, low, close, volume]) => ({
          time: Number(time),
          open: Number(open),
          high: Number(high),
          low: Number(low),
          close: Number(close),
          volume: Number(volume) || 0,
        }))
        .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.close) && c.close > 0)
        // GeckoTerminal returns newest first; charts need ascending time.
        .sort((a, b) => a.time - b.time);

      candleCache.set(key, { candles, ts: Date.now() });
      return candles;
    } catch {
      return hit?.candles ?? [];
    }
  },

  /**
   * Candles for a coin, whichever source can supply them.
   * Returns the source so the UI can say where the data came from.
   */
  async getCandlesForCoin(
    coin: CoinData,
    timeframe: TimeframeId
  ): Promise<{ candles: Candle[]; source: 'pool' | 'stream' | 'none'; poolAddress?: string }> {
    const chain = String(coin.chainId || '').toLowerCase();
    const token = coin.mint || (coin.id.includes(':') ? coin.id.split(':')[1] : '');

    if (this.networkFor(chain) && token) {
      const pool = await this.resolvePool(chain, token);
      if (pool) {
        const candles = await this.getCandles(chain, pool, timeframe, token);
        if (candles.length > 1) return { candles, source: 'pool', poolAddress: pool };
      }
    }

    const live = aggregate(getLiveCandles(token), timeframeOf(timeframe).seconds);
    if (live.length > 0) return { candles: live, source: 'stream' };
    return { candles: [], source: 'none' };
  },
};
