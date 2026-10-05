/**
 * Setup scanner: the memecoin entry rules from `skill memcoin.md`, run as code.
 *
 *   candidates  GeckoTerminal new / trending / top-volume pools + DexScreener boosts and profiles (Solana)
 *   filter      depth, age, activity, cloned tickers, liquidity-larger-than-market-cap pools
 *   gates       RugCheck: mint / freeze authority, Token-2022 traps, holder concentration, insiders, dev bag
 *   setups      breakout-retest, flag, trend pullback - read from 5m candles, 15m aggregated locally
 *   swap check  Jupiter buy quote + sell-back quote for ready signals (sellable, round-trip cost)
 *
 * It runs in the browser: every API here is keyless and CORS-enabled, and each viewer then spends
 * their own GeckoTerminal rate limit instead of sharing one server IP.
 */
import { CoinData } from '../types/coin';
import type { Candle } from './chart.service';
import { mapPairToCoinData } from './coin.service';

const GECKO = 'https://api.geckoterminal.com/api/v2/networks/solana';
const GECKO_HEADERS = { Accept: 'application/json;version=20230302' };
const DEX = 'https://api.dexscreener.com';
const RUGCHECK = 'https://api.rugcheck.xyz/v1/tokens';
const JUPITER = 'https://lite-api.jup.ag/swap/v1';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const IGNORED_MINTS = new Set([
  SOL_MINT,
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);

/**
 * GeckoTerminal answers bursts with 429, and the rest of the app (and anything else on the same IP)
 * shares the budget. Each scan fetches at most a few charts - ready / watch tokens first, then the
 * stalest - and evaluates every safe candidate from a cache, so coverage rotates instead of only
 * the most active tokens ever being looked at. A 429 pauses chart fetches for a minute.
 */
const MAX_FETCHES_PER_SCAN = 5;
const CHART_SPACING_MS = 1500;
const CANDLE_TTL_MS = 5 * 60_000;
const PRIORITY_CANDLE_TTL_MS = 45_000;
/** A Ready signal needs a chart at most this old; older ones wait one scan for a refresh. */
const FRESH_FOR_ENTRY_MS = 90_000;
const GECKO_COOLDOWN_MS = 60_000;
let geckoCooldownUntil = 0;
/** The skill only enters at 70+ (70-79 = small size, 80+ = full size). */
export const MIN_ENTRY_SCORE = 70;
/** Simple mode trades momentum itself, so it accepts any safe token that scores 60+. */
export const MIN_ENTRY_SCORE_SIMPLE = 60;

/**
 * 'strict' waits for a retest, flag or pullback; 'simple' also buys a 5m momentum breakout as it
 * happens. Safety gates, the sell-back test and position sizing are the same in both.
 */
export type ScanMode = 'strict' | 'simple';
export const minEntryScore = (mode: ScanMode = 'strict') => (mode === 'simple' ? MIN_ENTRY_SCORE_SIMPLE : MIN_ENTRY_SCORE);

export type SetupKind = 'breakout' | 'flag' | 'pullback' | 'momentum';
export type SignalStatus = 'ready' | 'watch' | 'rejected';

export interface ScanGates {
  top10Pct: number;
  maxHolderPct: number;
  insiderPct: number;
  devPct: number;
  holders: number;
  passed: boolean;
  failure?: string;
}

export interface ScanScore {
  safety: number;
  holders: number;
  liquidity: number;
  momentum: number;
  social: number;
  total: number;
}

export type SwapCheck = { sellable: true; roundTripPct: number } | { sellable: false; error: string };

export interface ScanSignal {
  /** Mint address. */
  id: string;
  coin: CoinData;
  status: SignalStatus;
  /** Why it was rejected, what to wait for, or why it is ready. */
  reason: string;
  setup?: SetupKind;
  priceUsd: number;
  liquidityUsd: number;
  marketCapUsd: number;
  ageHours: number;
  volume1hUsd: number;
  buys1h: number;
  sells1h: number;
  gates?: ScanGates;
  score?: ScanScore;
  entryLow?: number;
  entryHigh?: number;
  stopPrice?: number;
  targetPrice?: number;
  slPercent?: number;
  tpPercent?: number;
  invalidation?: string;
  swap?: SwapCheck;
  /** Round-trip swap cost plus both priority fees, as % of the buy size. */
  costPercent?: number;
  /** (TP - cost) / (SL + cost). */
  netRewardRisk?: number;
}

export interface ScanResult {
  scannedAt: number;
  candidateCount: number;
  signals: ScanSignal[];
}

export interface ScanOptions {
  buyAmountUsd: number;
  solPriceUsd: number;
  priorityFeeSol: number;
  /** Take-profit for every setup, in %. */
  takeProfitPercent: number;
  /** Widest stop the account can afford, in %. */
  maxStopPercent: number;
  /** Mints that were ready / watched last scan: charted first and with fresh candles. */
  priorityMints?: string[];
  mode?: ScanMode;
}

/* ------------------------------------------------------------------ plumbing */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, init?: RequestInit, retries = 1): Promise<any | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if (res.status === 429 && attempt < retries) {
        await sleep(3000);
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      if (attempt >= retries) return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

const memo = new Map<string, { at: number; value: unknown }>();

/** Caches non-null results for `ttlMs`; failures are retried on the next scan. */
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T | null>): Promise<T | null> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  if (value !== null) memo.set(key, { at: Date.now(), value });
  return value;
}

async function mapLimit<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await run(items[next++]);
    })
  );
}

const chunk = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const usdK = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);
const px = (v: number) => `$${v.toPrecision(4)}`;

/* ------------------------------------------------------------------ candidates */

async function candidateMints(): Promise<string[]> {
  const mints = await cached('mints', 5 * 60_000, async () => {
    const found = new Set<string>();
    const geckoLists = ['new_pools?page=1', 'trending_pools?page=1&duration=1h', 'trending_pools?page=1&duration=6h', 'pools?page=1&sort=h24_volume_usd_desc'];
    // Sequential on purpose, and skipped during a rate-limit pause (DexScreener lists still run).
    for (const path of geckoLists) {
      if (Date.now() < geckoCooldownUntil) break;
      const data = await geckoJson(`${GECKO}/${path}`);
      (data?.data || []).forEach((pool: any) => {
        const id = String(pool?.relationships?.base_token?.data?.id || '');
        if (id.startsWith('solana_')) found.add(id.slice('solana_'.length));
      });
    }
    const dexLists = await Promise.all(
      ['token-boosts/top/v1', 'token-boosts/latest/v1', 'token-profiles/latest/v1'].map((p) => getJson(`${DEX}/${p}`))
    );
    dexLists.forEach((list) =>
      (Array.isArray(list) ? list : []).forEach((t: any) => {
        if (t?.chainId === 'solana' && t.tokenAddress) found.add(String(t.tokenAddress));
      })
    );
    IGNORED_MINTS.forEach((m) => found.delete(m));
    return found.size ? [...found] : null;
  });
  return mints || [];
}

/** Deepest DexScreener pair per mint, keeping only pairs where the mint is the base token. */
async function bestPairs(mints: string[]): Promise<Map<string, any>> {
  const wanted = new Set(mints);
  const out = new Map<string, any>();
  const batches = await Promise.all(chunk(mints, 30).map((b) => getJson(`${DEX}/tokens/v1/solana/${b.join(',')}`)));
  batches.forEach((pairs) =>
    (Array.isArray(pairs) ? pairs : []).forEach((pair: any) => {
      const mint = pair?.baseToken?.address;
      if (!mint || !wanted.has(mint)) return;
      const prev = out.get(mint);
      if (!prev || (pair.liquidity?.usd || 0) > (prev.liquidity?.usd || 0)) out.set(mint, pair);
    })
  );
  return out;
}

function prefilter(pair: any, isClone: boolean): string | null {
  const liq = Number(pair.liquidity?.usd) || 0;
  const mcap = Number(pair.marketCap || pair.fdv) || 0;
  const ageH = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3.6e6 : 0;
  const trades = (pair.txns?.h1?.buys || 0) + (pair.txns?.h1?.sells || 0);
  const socials = (pair.info?.socials?.length || 0) + (pair.info?.websites?.length || 0);

  if (liq < 25_000) return `Liquidity ${usdK(liq)} is under $25K`;
  if (mcap < 80_000 || mcap > 30_000_000) return `Market cap ${usdK(mcap)} is outside $80K-$30M`;
  if (liq > mcap) return 'Liquidity larger than market cap - pool anomaly';
  if (liq / mcap < 0.05) return 'Liquidity under 5% of market cap';
  if (ageH < 1) return 'Younger than 1 hour';
  if ((pair.volume?.h1 || 0) < 15_000) return '1h volume under $15K';
  if (trades < 100) return 'Under 100 trades in the last hour';
  if (isClone) return 'Ticker copies an older token';
  if (!socials && ageH < 6) return 'No website or socials on a token under 6 hours old';
  return null;
}

/* ------------------------------------------------------------------ safety gates */

async function safetyGates(mint: string): Promise<ScanGates | null> {
  return cached(`rugcheck:${mint}`, 10 * 60_000, async () => {
    const r = await getJson(`${RUGCHECK}/${mint}/report`);
    if (!r) return null;
    const known = r.knownAccounts || {};
    const supply = Number(r.token?.supply) || 0;
    // Pools, curves and exchange wallets are listed as known accounts and are not real holders.
    const holders = (r.topHolders || []).filter((h: any) => !known[h.owner] && !known[h.address]);
    const top10Pct = holders.slice(0, 10).reduce((a: number, h: any) => a + (Number(h.pct) || 0), 0);
    const maxHolderPct = Number(holders[0]?.pct) || 0;
    const insiderAmount = (r.insiderNetworks || []).reduce((a: number, n: any) => a + (Number(n.tokenAmount) || 0), 0);
    const insiderPct = supply ? (100 * insiderAmount) / supply : 0;
    const devPct = supply ? (100 * (Number(r.creatorBalance) || 0)) / supply : 0;
    const ext = r.token_extensions || {};

    let failure: string | undefined;
    if (r.mintAuthority) failure = 'Mint authority is still set';
    else if (r.freezeAuthority) failure = 'Freeze authority is still set';
    else if (r.rugged) failure = 'RugCheck marks it as rugged';
    else if (ext.permanentDelegate) failure = 'Token-2022 permanent delegate';
    else if (ext.transferFeeConfig) failure = 'Token-2022 transfer fee';
    else if (maxHolderPct > 5) failure = `One wallet holds ${maxHolderPct.toFixed(1)}%`;
    else if (top10Pct > 30) failure = `Top 10 wallets hold ${top10Pct.toFixed(0)}%`;
    else if (insiderPct > 15) failure = `Insider networks hold ${insiderPct.toFixed(0)}%`;
    else if (devPct > 5) failure = `Dev still holds ${devPct.toFixed(1)}%`;

    return { top10Pct, maxHolderPct, insiderPct, devPct, holders: Number(r.totalHolders) || 0, passed: !failure, failure };
  });
}

/* ------------------------------------------------------------------ chart setups */

const candleMemo = new Map<string, { at: number; candles: Candle[] }>();

/** GeckoTerminal GET that starts the rate-limit pause on a 429 instead of retrying into it. */
async function geckoJson(url: string): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, { headers: GECKO_HEADERS, signal: ctrl.signal });
    if (res.status === 429) {
      geckoCooldownUntil = Date.now() + GECKO_COOLDOWN_MS;
      return null;
    }
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 24h of 5m candles for the token side of `pool`, oldest first; null if GeckoTerminal did not answer. */
async function fetchCandles(pool: string, mint: string): Promise<Candle[] | null> {
  // Without `token` the API charts the pool's base side, which for a SOL-quoted pair is SOL.
  const data = await geckoJson(`${GECKO}/pools/${pool}/ohlcv/minute?aggregate=5&limit=288&currency=usd&token=${mint}`);
  const rows: number[][] | undefined = data?.data?.attributes?.ohlcv_list;
  if (!rows) return null;
  return rows
    .map(([time, open, high, low, close, volume]) => ({ time: +time, open: +open, high: +high, low: +low, close: +close, volume: +volume || 0 }))
    .filter((c) => Number.isFinite(c.time) && c.close > 0)
    .sort((a, b) => a.time - b.time);
}

function to15m(c5: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const c of c5) {
    const bucket = Math.floor(c.time / 900) * 900;
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else {
      out.push({ ...c, time: bucket });
    }
  }
  return out;
}

const closedOnly = (candles: Candle[], seconds: number) => candles.filter((c) => c.time + seconds <= Date.now() / 1000);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const highOf = (cs: Candle[]) => Math.max(...cs.map((c) => c.high));
const lowOf = (cs: Candle[]) => Math.min(...cs.map((c) => c.low));

function emaLast(values: number[], period: number): number {
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

/** Hourly blocks of the last 3 hours: higher lows = up, lower highs = down. */
function structureOf(c15: Candle[]): 'up' | 'down' | 'range' {
  if (c15.length < 12) return 'range';
  const blocks = [c15.slice(-12, -8), c15.slice(-8, -4), c15.slice(-4)].map((b) => ({ h: highOf(b), l: lowOf(b) }));
  if (blocks[2].l > blocks[1].l && blocks[1].l > blocks[0].l) return 'up';
  if (blocks[2].h < blocks[1].h && blocks[1].h < blocks[0].h) return 'down';
  return 'range';
}

export interface SetupLevels {
  setup: SetupKind;
  status: 'ready' | 'watch';
  reason: string;
  entryLow: number;
  entryHigh: number;
  stop: number;
  invalidation: string;
}

export interface ChartRead {
  levels?: SetupLevels;
  rejected?: string;
  structure: 'up' | 'down' | 'range';
  aboveVwap: boolean;
  high4h: number;
}

/** Classifies a 5m candle series into a ready setup, a watch, or a rejection. */
export function readChart(c5raw: Candle[], maxStopPct: number, mode: ScanMode = 'strict'): ChartRead {
  if (!c5raw.length) return { structure: 'range', aboveVwap: false, high4h: 0, rejected: 'No candles' };
  const c5 = closedOnly(c5raw, 300);
  const c15 = closedOnly(to15m(c5raw), 900);
  const price = c5raw[c5raw.length - 1].close;
  let pv = 0;
  let vol = 0;
  c5raw.forEach((c) => {
    pv += ((c.high + c.low + c.close) / 3) * c.volume;
    vol += c.volume;
  });
  const vwap = vol > 0 ? pv / vol : price;
  const structure = structureOf(c15);
  const aboveVwap = price > vwap;
  const high4h = c15.length ? highOf(c15.slice(-16)) : price;
  const base = { structure, aboveVwap, high4h };

  if (c15.length < 8 || c5.length < 24) return { ...base, rejected: 'Under 2 hours of candles' };

  // 0. Simple mode - momentum: one of the last two 5m candles closed green above the prior 30-minute
  //    high on >= 2x the previous hour's average volume, and was not a vertical (>15%) candle. It buys
  //    the move instead of waiting for a retest. Backtested on 24h of 12 safe tokens with TP 15 /
  //    SL 8: ~46% winners, roughly break-even after 3% round-trip fees - it trades often, not magically.
  if (mode === 'simple') {
    for (let i = c5.length - 1; i >= Math.max(12, c5.length - 2); i--) {
      const bar = c5[i];
      const prevHigh = highOf(c5.slice(i - 6, i));
      const avgVol = avg(c5.slice(i - 12, i).map((c) => c.volume));
      if (bar.close <= prevHigh || bar.close <= bar.open || bar.close / bar.open - 1 > 0.15 || bar.volume < 2 * avgVol) continue;
      if (price > bar.close * 1.03) return { ...base, rejected: 'Momentum ran over 3% past the breakout - not chasing' };
      if (price < prevHigh) return { ...base, rejected: `Momentum breakout of ${px(prevHigh)} already failed` };
      const entryLow = bar.close * 0.99;
      const entryHigh = bar.close * 1.03;
      return {
        ...base,
        levels: {
          setup: 'momentum',
          status: 'ready',
          reason: `Momentum: 5m close above the 30-min high ${px(prevHigh)} on ${(bar.volume / (avgVol || 1)).toFixed(1)}x volume`,
          entryLow,
          entryHigh,
          stop: ((entryLow + entryHigh) / 2) * 0.92,
          invalidation: `5m close under ${px(prevHigh)}`,
        },
      };
    }
  }
  const last4 = c15.slice(-4);
  if (highOf(last4) / lowOf(last4) - 1 > 0.6) return { ...base, rejected: 'Swinging over 60% an hour - parabolic' };
  if (price > vwap * 2) return { ...base, rejected: 'Over 2x its 24h VWAP - parabolic' };
  if (structure === 'down' && !aboveVwap) return { ...base, rejected: 'Downtrend: lower highs under VWAP' };

  const last5 = c5[c5.length - 1];
  const stopPct = (entry: number, stop: number) => (entry - stop) / entry;

  // 1. Breakout-retest: a 15m close above the prior 4h high on >= 2x volume, within the last hour.
  for (let i = c15.length - 1; i >= Math.max(16, c15.length - 4); i--) {
    const level = highOf(c15.slice(i - 16, i));
    const bar = c15[i];
    const prevVol = avg(c15.slice(i - 4, i).map((c) => c.volume));
    if (bar.close <= level || bar.volume < 2 * prevVol) continue;

    const entryLow = level * 0.985;
    const entryHigh = level * 1.01;
    const stop = level * 0.92;
    const invalidation = `15m close back under ${px(level * 0.97)}`;
    if (price < level * 0.97) return { ...base, rejected: `Breakout of ${px(level)} failed - back under the level` };
    if (price <= entryHigh && last5.close >= level * 0.995) {
      return { ...base, levels: { setup: 'breakout', status: 'ready', reason: `Retesting the ${px(level)} breakout and holding`, entryLow, entryHigh, stop, invalidation } };
    }
    return { ...base, levels: { setup: 'breakout', status: 'watch', reason: `Breakout above ${px(level)} confirmed - wait for a retest of ${px(entryLow)}-${px(entryHigh)}`, entryLow, entryHigh, stop, invalidation } };
  }

  // 2. Flag: a +30% impulse on >= 3x volume, then 3 tight candles holding its upper half on falling volume.
  for (let i = c15.length - 4; i >= Math.max(4, c15.length - 10); i--) {
    const imp = c15[i];
    const impVolRatio = imp.volume / (avg(c15.slice(i - 4, i).map((c) => c.volume)) || 1);
    if (imp.close / imp.open - 1 < 0.3 || impVolRatio < 3) continue;

    const flag = c15.slice(-3);
    const flagHigh = highOf(flag);
    const flagLow = lowOf(flag);
    const mid = (imp.open + imp.close) / 2;
    const tight = flagHigh / flagLow - 1 <= 0.15;
    const holds = flag.every((c) => c.close > mid);
    const drying = flag[2].volume < imp.volume * 0.5;
    if (!tight || !holds || !drying) break;

    const stop = flagLow * 0.985;
    if (stopPct(flagHigh, stop) > maxStopPct) return { ...base, rejected: `Flag too wide for a ${Math.round(maxStopPct * 100)}% stop` };
    const invalidation = `15m close under ${px(flagLow)}`;
    if (last5.close > flagHigh && price <= flagHigh * 1.03) {
      return { ...base, levels: { setup: 'flag', status: 'ready', reason: `Breaking out of the ${px(flagLow)}-${px(flagHigh)} flag`, entryLow: flagHigh, entryHigh: flagHigh * 1.03, stop, invalidation } };
    }
    if (price < flagLow) return { ...base, rejected: 'Fell out of the flag' };
    return { ...base, levels: { setup: 'flag', status: 'watch', reason: `Flag ${px(flagLow)}-${px(flagHigh)} - buy a 5m close above ${px(flagHigh)}`, entryLow: flagHigh, entryHigh: flagHigh * 1.03, stop, invalidation } };
  }

  // 3. Trend pullback: higher lows, above VWAP, buying a dip into the 15m EMA20.
  const ema20 = emaLast(c15.map((c) => c.close), 20);
  if (structure === 'up' && aboveVwap) {
    const entryLow = ema20 * 0.99;
    const entryHigh = ema20 * 1.02;
    const mid = (entryLow + entryHigh) / 2;
    let stop = Math.min(lowOf(c15.slice(-6)), entryLow) * 0.985;
    if (stopPct(mid, stop) < 0.05) stop = mid * 0.95; // tighter than 5% gets stopped by noise
    if (stopPct(mid, stop) > maxStopPct) return { ...base, rejected: `Pullback stop would be wider than ${Math.round(maxStopPct * 100)}%` };
    const invalidation = `15m close under ${px(stop)}`;
    if (price < entryLow * 0.97) return { ...base, rejected: 'Lost the 15m EMA20' };
    const dipped = c5.slice(-3).some((c) => c.low <= entryHigh);
    // A healthy dip sells off on lighter volume; heavy volume into the EMA is a dump, not a pullback.
    const drying = avg(c5.slice(-3).map((c) => c.volume)) <= 1.2 * avg(c5.slice(-15, -3).map((c) => c.volume));
    if (dipped && drying && last5.close > last5.open && last5.close >= entryLow && last5.close <= entryHigh * 1.02) {
      return { ...base, levels: { setup: 'pullback', status: 'ready', reason: 'Dipped into the 15m EMA20 and bounced', entryLow, entryHigh, stop, invalidation } };
    }
    return { ...base, levels: { setup: 'pullback', status: 'watch', reason: `Uptrend - wait for a dip to ${px(entryLow)}-${px(entryHigh)} and a green 5m candle`, entryLow, entryHigh, stop, invalidation } };
  }

  // 4. Coiling under its 4h high: watch for the breakout.
  const level = highOf(c15.slice(-17, -1));
  if (price >= level * 0.94 && structure !== 'down') {
    return {
      ...base,
      levels: {
        setup: 'breakout',
        status: 'watch',
        reason: `Under its 4h high ${px(level)} - needs a 15m close above it on 2x volume`,
        entryLow: level * 0.985,
        entryHigh: level * 1.01,
        stop: level * 0.92,
        invalidation: `15m close under ${px(level * 0.88)}`,
      },
    };
  }

  return { ...base, rejected: structure === 'down' ? 'Downtrend' : 'No setup: ranging away from its highs' };
}

/* ------------------------------------------------------------------ scoring + swap check */

function scoreOf(pair: any, g: ScanGates, read: ChartRead): ScanScore {
  const liq = Number(pair.liquidity?.usd) || 0;
  const mcap = Number(pair.marketCap || pair.fdv) || 1;
  const buys = pair.txns?.h1?.buys || 0;
  const sells = pair.txns?.h1?.sells || 0;
  const flow = buys / Math.max(1, sells);
  const socials: { type?: string }[] = pair.info?.socials || [];

  const safety = clamp(30 - Math.max(0, g.top10Pct - 15) * 0.5 - Math.max(0, g.maxHolderPct - 2) * 1.5 - g.insiderPct * 0.6 - g.devPct * 2, 0, 30);
  const holders = g.holders >= 20_000 ? 20 : g.holders >= 10_000 ? 17 : g.holders >= 5_000 ? 14 : g.holders >= 2_000 ? 11 : 7;
  const liquidity = (liq >= 100_000 ? 12 : liq >= 50_000 ? 10 : 7) + (liq / mcap >= 0.1 ? 8 : 5);
  const momentum = (flow >= 1.5 ? 8 : flow >= 1.2 ? 6 : flow >= 1 ? 4 : 1) + (read.structure === 'up' ? 7 : read.structure === 'range' ? 3 : 0) + (read.aboveVwap ? 5 : 0);
  const social = Math.min(
    10,
    (pair.info?.websites?.length ? 4 : 0) + socials.reduce((a, s) => a + (s.type === 'twitter' || s.type === 'telegram' ? 3 : 1), 0)
  );
  return { safety: Math.round(safety), holders, liquidity, momentum, social, total: Math.round(safety + holders + liquidity + momentum + social) };
}

async function swapCheck(mint: string, lamports: number): Promise<SwapCheck> {
  const result = await cached<SwapCheck>(`swap:${mint}:${lamports}`, 2 * 60_000, async () => {
    const q = (input: string, output: string, amount: string | number) =>
      getJson(`${JUPITER}/quote?inputMint=${input}&outputMint=${output}&amount=${amount}&slippageBps=500&restrictIntermediateTokens=true`);
    const buy = await q(SOL_MINT, mint, lamports);
    if (!buy?.outAmount) return { sellable: false, error: 'No Jupiter route to buy' };
    const sell = await q(mint, SOL_MINT, buy.outAmount);
    if (!sell?.outAmount) return { sellable: false, error: 'No route to sell it back - possible honeypot' };
    return { sellable: true, roundTripPct: 100 * (1 - Number(sell.outAmount) / lamports) };
  });
  return result || { sellable: false, error: 'Jupiter did not answer' };
}

/* ------------------------------------------------------------------ scan */

export const ScannerService = {
  async scan(opts: ScanOptions): Promise<ScanResult> {
    const mints = await candidateMints();
    const pairs = await bestPairs(mints);
    const signals: ScanSignal[] = [];

    const signalFor = (pair: any, status: SignalStatus, reason: string): ScanSignal => ({
      id: pair.baseToken.address,
      coin: mapPairToCoinData(pair),
      status,
      reason,
      priceUsd: Number(pair.priceUsd) || 0,
      liquidityUsd: Number(pair.liquidity?.usd) || 0,
      marketCapUsd: Number(pair.marketCap || pair.fdv) || 0,
      ageHours: pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3.6e6 : 0,
      volume1hUsd: Number(pair.volume?.h1) || 0,
      buys1h: pair.txns?.h1?.buys || 0,
      sells1h: pair.txns?.h1?.sells || 0,
    });

    // Clones: when several candidates share a ticker, only the oldest one counts.
    const oldestBySymbol = new Map<string, number>();
    pairs.forEach((p) => {
      const sym = String(p.baseToken?.symbol || '').toLowerCase();
      const created = p.pairCreatedAt || Infinity;
      if (created < (oldestBySymbol.get(sym) ?? Infinity)) oldestBySymbol.set(sym, created);
    });

    const survivors: any[] = [];
    pairs.forEach((p) => {
      const sym = String(p.baseToken?.symbol || '').toLowerCase();
      const isClone = (p.pairCreatedAt || Infinity) > (oldestBySymbol.get(sym) ?? Infinity);
      const reject = prefilter(p, isClone);
      if (reject) signals.push(signalFor(p, 'rejected', reject));
      else survivors.push(p);
    });

    const gated: { pair: any; gates: ScanGates }[] = [];
    await mapLimit(survivors, 4, async (pair) => {
      const gates = await safetyGates(pair.baseToken.address);
      if (!gates) signals.push(signalFor(pair, 'rejected', 'RugCheck did not answer - unverified counts as risk'));
      else if (!gates.passed) signals.push({ ...signalFor(pair, 'rejected', gates.failure || 'Failed a safety gate'), gates });
      else gated.push({ pair, gates });
    });

    // Fetch order: tokens on the ready / watch list, then never-charted ones, then the stalest.
    const priority = new Set(opts.priorityMints || []);
    const chartAge = (pool: string) => {
      const hit = candleMemo.get(pool);
      return hit ? Date.now() - hit.at : Infinity;
    };
    gated.sort(
      (a, b) =>
        Number(priority.has(b.pair.baseToken.address)) - Number(priority.has(a.pair.baseToken.address)) ||
        chartAge(b.pair.pairAddress) - chartAge(a.pair.pairAddress) ||
        (b.pair.volume?.h1 || 0) - (a.pair.volume?.h1 || 0)
    );
    let fetchesLeft = MAX_FETCHES_PER_SCAN;

    const maxStop = opts.maxStopPercent / 100;
    const lamports = Math.round((opts.buyAmountUsd / (opts.solPriceUsd || 1)) * 1e9);
    const feePct = opts.buyAmountUsd > 0 ? (100 * 2 * opts.priorityFeeSol * opts.solPriceUsd) / opts.buyAmountUsd : 0;

    await mapLimit(gated, 1, async ({ pair, gates }) => {
      const mint = pair.baseToken.address;
      const ttl = priority.has(mint) ? PRIORITY_CANDLE_TTL_MS : CANDLE_TTL_MS;
      if (chartAge(pair.pairAddress) > ttl && fetchesLeft > 0 && Date.now() >= geckoCooldownUntil) {
        fetchesLeft--;
        const fresh = await fetchCandles(pair.pairAddress, mint);
        if (fresh?.length) candleMemo.set(pair.pairAddress, { at: Date.now(), candles: fresh });
        await sleep(CHART_SPACING_MS);
      }
      const memo = candleMemo.get(pair.pairAddress);
      if (!memo) {
        const why = Date.now() < geckoCooldownUntil ? 'Chart data rate-limited - retried next scan' : 'Chart queued for a coming scan';
        signals.push({ ...signalFor(pair, 'rejected', why), gates });
        return;
      }
      const candles = memo.candles;
      const chartAgeMs = Date.now() - memo.at;
      if (candles.length < 24) {
        signals.push({ ...signalFor(pair, 'rejected', 'Under 2 hours of candles'), gates });
        return;
      }
      const read = readChart(candles, maxStop, opts.mode);
      const score = scoreOf(pair, gates, read);
      if (!read.levels) {
        signals.push({ ...signalFor(pair, 'rejected', read.rejected || 'No setup'), gates, score });
        return;
      }

      const { levels } = read;
      const entry = (levels.entryLow + levels.entryHigh) / 2;
      let target = entry * (1 + opts.takeProfitPercent / 100);
      let status: SignalStatus = levels.status;
      let reason = levels.reason;

      // Sell before a nearby 4h high instead of through it (breakouts are already above theirs).
      if (levels.setup !== 'breakout' && levels.setup !== 'momentum' && read.high4h > entry && read.high4h < target) {
        target = read.high4h * 0.98;
        if (target < entry * 1.1 && status === 'ready') {
          status = 'watch';
          reason = `${reason}, but the 4h high ${px(read.high4h)} leaves under +10%`;
        }
      }
      const minScore = minEntryScore(opts.mode);
      if (status === 'ready' && score.total < minScore) {
        status = 'watch';
        reason = `${reason} - score ${score.total}/100 is under ${minScore}`;
      }
      // Never enter on a cached chart: the token is charted first next scan and re-checked fresh.
      if (status === 'ready' && chartAgeMs > FRESH_FOR_ENTRY_MS) {
        status = 'watch';
        reason = `${reason} (refreshing the chart before entry)`;
      }

      const slPercent = (100 * (entry - levels.stop)) / entry;
      const tpPercent = (100 * (target - entry)) / entry;
      const signal: ScanSignal = {
        ...signalFor(pair, status, reason),
        setup: levels.setup,
        gates,
        score,
        entryLow: levels.entryLow,
        entryHigh: levels.entryHigh,
        stopPrice: levels.stop,
        targetPrice: target,
        slPercent,
        tpPercent,
        invalidation: levels.invalidation,
      };

      if (status === 'ready') {
        const swap = await swapCheck(mint, lamports);
        signal.swap = swap;
        if (!swap.sellable) {
          signals.push({ ...signal, status: 'rejected', reason: swap.error });
          return;
        }
        const cost = swap.roundTripPct + feePct;
        signal.costPercent = cost;
        signal.netRewardRisk = (tpPercent - cost) / (slPercent + cost);
        if (signal.netRewardRisk < 1) {
          signal.status = 'watch';
          signal.reason = `${reason} - fees of ${cost.toFixed(1)}% leave reward under risk at this size`;
        }
      }
      signals.push(signal);
    });

    const rank: Record<SignalStatus, number> = { ready: 0, watch: 1, rejected: 2 };
    signals.sort((a, b) => rank[a.status] - rank[b.status] || (b.score?.total ?? 0) - (a.score?.total ?? 0) || b.volume1hUsd - a.volume1hUsd);
    return { scannedAt: Date.now(), candidateCount: pairs.size, signals };
  },
};
