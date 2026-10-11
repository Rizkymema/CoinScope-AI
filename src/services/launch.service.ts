/**
 * Launch watcher: the new-pair technique from the MemeCoin id videos and Setup 1 "Curve Momentum"
 * of skill memcoin.md, for Pump.fun tokens in their first 30 minutes.
 *
 *   discover  PumpPortal's free create stream names every new Pump.fun token
 *   sample    DexScreener every 10 s (price, buys/sells; it indexes a curve within ~1 minute)
 *   traction  buyers have to pile in: 40 buys by 3 minutes and 100 by 6, or the token is dropped
 *   gates     RugCheck for the ones with traction: 80+ holders, dev still holding (selling half its
 *             launch buy drops the token) and <= 5%, no wallet over 5%, top 10 <= 30%, insider
 *             networks <= 15%, clean contract; curve 20-85%
 *   entry     "jangan FOMO, tunggu RSI di bawah": RSI(14) on the 10 s samples sank to 30 or lower and
 *             the latest sample lifted it back over, 12-45% under the launch high, buys >= sells
 *   exits     stop under the dip low (at most 12%), target 2.5x the stop (30-50%), 15-minute time stop
 *
 * PumpPortal's per-token trade stream now needs a funded API key, and a key in the browser would hand
 * out its wallet, so trades are sampled instead of streamed.
 */
import { CoinData } from '../types/coin';
import { wsService } from './websocket.service';
import { SolPriceService } from './solprice.service';
import { LaunchFacts, rsiSeries, rugMetrics, RugMetrics, ScanScore, ScanSignal, SignalStatus, swapCheck } from './scanner.service';

const DEX = 'https://api.dexscreener.com';
const WATCH_MS = 30 * 60_000;
const MAX_WATCHED = 150;
const POLL_MS = 10_000;
/** RugCheck is asked about at most this many launches per poll, least recently checked first. */
const RUGCHECKS_PER_POLL = 2;
const RUG_TTL_MS = 60_000;
/** [age, minimum buy transactions since launch]: a launch that misses one is dropped. */
const TRACTION: [number, number][] = [
  [3 * 60_000, 40],
  [6 * 60_000, 100],
];
const MIN_HOLDERS = 80;
const MAX_TOP10_PCT = 30;
const MAX_WALLET_PCT = 5;
const MAX_DEV_PCT = 5;
const MAX_INSIDER_PCT = 15;
const CURVE_MIN = 20;
const CURVE_MAX = 85;
const CURVE_DROP = 95;
const DIP_RSI = 30;
const MIN_SAMPLES = 16;
const MIN_DRAWDOWN = 0.12;
const MAX_DRAWDOWN = 0.45;
const MIN_STOP = 0.06;
/** Same cap as the scanner: the user's auto-buy limit is a stop of 12% at most. */
const MAX_STOP = 0.12;
export const LAUNCH_TIME_STOP_MINUTES = 15;
export const MIN_LAUNCH_SCORE = 70;
/** A launch goes to confirmation at most this often. */
const READY_REPEAT_MS = 60_000;

interface Watch {
  coin: CoinData;
  mint: string;
  createdAt: number;
  /** Share of supply the creator bought at launch, from the create event. */
  devLaunchPct: number;
  samples: { t: number; price: number }[];
  highUsd: number;
  pair?: any;
  rug?: RugMetrics & { at: number; smart: number };
  holderHistory: { t: number; holders: number }[];
  lastReadyAt: number;
  confirming: boolean;
  /** Passed the swap check: shown as Ready for a short while. */
  confirmed?: { signal: ScanSignal; at: number };
  /** Why the last confirmation failed, shown until the next attempt. */
  blocked?: { reason: string; at: number };
}

export interface LaunchWatcherOptions {
  /** Ready launches that passed RugCheck and the sell-back quote. */
  onReady: (signal: ScanSignal) => void;
  smartWallets: () => string[];
  buyAmountUsd: () => number;
  priorityFeeSol: () => number;
}

const watches = new Map<string, Watch>();
const drops: { t: number; reason: string }[] = [];
let opts: LaunchWatcherOptions | null = null;
let running = false;
let wired = false;
let polling = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let latest: ScanSignal[] = [];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const px = (v: number) => `$${v.toPrecision(4)}`;
const solPrice = () => SolPriceService.getCached() || 0;

/**
 * Bonding-curve progress from market cap. Pump.fun prices on x*y=k with 30 virtual SOL against
 * 1.073B virtual tokens and graduates at 85 real SOL, so a market cap of M SOL means
 * sqrt(M * 32.19) virtual SOL in the curve.
 */
function curvePercent(marketCapUsd: number): number {
  const sol = solPrice();
  if (!sol || !marketCapUsd) return 0;
  const vSol = Math.sqrt((marketCapUsd / sol) * 32.19);
  return clamp(((vSol - 30) / 85) * 100, 0, 100);
}

async function fetchPairs(mints: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  for (let i = 0; i < mints.length; i += 30) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(`${DEX}/tokens/v1/solana/${mints.slice(i, i + 30).join(',')}`, { signal: ctrl.signal });
      const pairs = res.ok ? await res.json() : [];
      (Array.isArray(pairs) ? pairs : []).forEach((p: any) => {
        const mint = p?.baseToken?.address;
        // The curve pair while it lives; a graduated token also has a PumpSwap pool, which wins.
        if (mint && (!out.has(mint) || p.dexId !== 'pumpfun')) out.set(mint, p);
      });
    } catch {
      // a failed batch is retried on the next poll
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ discovery */

function onNewToken(coin: CoinData) {
  // Only Pump.fun curves: the curve maths above is Pump.fun's.
  if (!running || !coin.mint || coin.poolType !== 'pump' || watches.has(coin.mint) || watches.size >= MAX_WATCHED) return;
  watches.set(coin.mint, {
    coin,
    mint: coin.mint,
    createdAt: coin.createdAt || Date.now(),
    devLaunchPct: (100 * (coin.devInitialTokens || 0)) / 1e9,
    samples: [],
    highUsd: 0,
    holderHistory: [],
    lastReadyAt: 0,
    confirming: false,
  });
}

function drop(w: Watch, reason: string) {
  watches.delete(w.mint);
  drops.push({ t: Date.now(), reason });
}

/* ------------------------------------------------------------------ evaluation */

function factsOf(w: Watch, now: number): LaunchFacts {
  const p = w.pair;
  const price = Number(p?.priceUsd) || 0;
  const hist = w.holderHistory;
  const first = hist.find((h) => now - h.t <= 3 * 60_000) || hist[0];
  const last = hist[hist.length - 1];
  const minutes = first && last && last.t > first.t ? (last.t - first.t) / 60_000 : 0;
  return {
    ageMinutes: (now - w.createdAt) / 60_000,
    holders: w.rug?.holders || 0,
    newHoldersPerMin: minutes > 0 ? Math.max(0, Math.round((last.holders - first.holders) / minutes)) : 0,
    buys: Number(p?.txns?.h1?.buys) || 0,
    curvePercent: curvePercent(Number(p?.marketCap) || 0),
    devPct: w.rug?.devPct ?? w.devLaunchPct,
    devSold: !!w.rug && w.devLaunchPct >= 0.5 && w.rug.devPct < w.devLaunchPct * 0.5,
    drawdownPct: w.highUsd > 0 && price > 0 ? 100 * (1 - price / w.highUsd) : 0,
    smartBuyers: w.rug?.smart || 0,
  };
}

function scoreOf(w: Watch, f: LaunchFacts): ScanScore {
  const r = w.rug;
  const buys5m = Number(w.pair?.txns?.m5?.buys) || 0;
  const ratio = buys5m / Math.max(1, Number(w.pair?.txns?.m5?.sells) || 0);
  const safety = r
    ? clamp(30 - Math.max(0, r.top10Pct - 15) * 0.6 - Math.max(0, r.maxHolderPct - 2) * 2 - r.insiderPct * 0.6 - Math.max(0, f.devPct - 2) * 1.5, 0, 30)
    : 0;
  const holders = f.holders >= 300 ? 20 : f.holders >= 200 ? 17 : f.holders >= 120 ? 14 : f.holders >= MIN_HOLDERS ? 11 : 7;
  const liquidity = f.curvePercent >= 25 && f.curvePercent <= 70 ? 20 : f.curvePercent >= CURVE_MIN && f.curvePercent <= CURVE_MAX ? 14 : 8;
  const momentum = (ratio >= 1.5 ? 10 : ratio >= 1.2 ? 8 : ratio >= 1 ? 6 : 2) + (f.newHoldersPerMin >= 30 ? 10 : f.newHoldersPerMin >= 15 ? 7 : f.newHoldersPerMin >= 5 ? 4 : 1);
  const socials = (w.pair?.info?.socials?.length || 0) + (w.pair?.info?.websites?.length || 0);
  const social = Math.min(10, 4 * f.smartBuyers + (socials > 0 ? 3 : 0));
  return { safety: Math.round(safety), holders, liquidity, momentum, social, total: Math.round(safety + holders + liquidity + momentum + social) };
}

function baseSignal(w: Watch, f: LaunchFacts, status: SignalStatus, reason: string, extra: Partial<ScanSignal> = {}): ScanSignal {
  const p = w.pair;
  const priceUsd = Number(p?.priceUsd) || 0;
  const marketCapUsd = Number(p?.marketCap) || 0;
  return {
    id: w.mint,
    coin: {
      ...w.coin,
      priceUsd,
      priceSol: solPrice() ? priceUsd / solPrice() : w.coin.priceSol,
      bondingCurve: Math.round(f.curvePercent),
      imageUrl: w.coin.imageUrl || p?.info?.imageUrl,
      fundamentals: { ...w.coin.fundamentals, marketCap: marketCapUsd },
    },
    status,
    reason,
    setup: 'launch',
    priceUsd,
    liquidityUsd: Number(p?.liquidity?.usd) || 0,
    marketCapUsd,
    ageHours: f.ageMinutes / 60,
    volume1hUsd: Number(p?.volume?.h1) || 0,
    buys1h: Number(p?.txns?.h1?.buys) || 0,
    sells1h: Number(p?.txns?.h1?.sells) || 0,
    buys5m: Number(p?.txns?.m5?.buys) || 0,
    sells5m: Number(p?.txns?.m5?.sells) || 0,
    gates: w.rug
      ? { top10Pct: w.rug.top10Pct, maxHolderPct: w.rug.maxHolderPct, insiderPct: w.rug.insiderPct, devPct: w.rug.devPct, holders: w.rug.holders, passed: status !== 'rejected' }
      : undefined,
    score: w.rug ? scoreOf(w, f) : undefined,
    smartWallets: f.smartBuyers || undefined,
    launch: f,
    ...extra,
  };
}

/** The holder gate that fails first, or null. These numbers can still improve, so a failure is not a drop. */
function gateFailure(w: Watch, f: LaunchFacts): string | null {
  const r = w.rug;
  if (!r) return f.buys < TRACTION[0][1] ? `${f.buys} buys - waiting for ${TRACTION[0][1]}` : 'Traction - waiting for RugCheck';
  if (f.holders < MIN_HOLDERS) return `${f.holders} holders - waiting for ${MIN_HOLDERS}`;
  if (f.devPct > MAX_DEV_PCT) return `Dev holds ${f.devPct.toFixed(1)}%`;
  if (r.maxHolderPct > MAX_WALLET_PCT) return `One wallet holds ${r.maxHolderPct.toFixed(1)}%`;
  if (r.top10Pct > MAX_TOP10_PCT) return `Top 10 wallets hold ${r.top10Pct.toFixed(0)}%`;
  if (f.curvePercent < CURVE_MIN) return `Curve ${f.curvePercent.toFixed(0)}% - waiting for ${CURVE_MIN}%`;
  if (f.curvePercent > CURVE_MAX) return `Curve ${f.curvePercent.toFixed(0)}% - too close to graduation`;
  return null;
}

function evaluate(w: Watch, now: number): ScanSignal | null {
  const age = now - w.createdAt;
  const f = factsOf(w, now);
  const dropped = (reason: string) => {
    drop(w, reason);
    return null;
  };
  if (age > WATCH_MS) return dropped('Older than 30 minutes');
  if (!w.pair) return age > 3 * 60_000 ? dropped('No trades indexed after 3 min') : null;
  if (w.pair.dexId !== 'pumpfun') return dropped('Graduated off the curve');
  for (const [at, min] of TRACTION) if (age >= at && f.buys < min) return dropped(`Under ${min} buys in the first ${at / 60_000} min`);
  if (f.curvePercent >= CURVE_DROP) return dropped('Curve nearly complete');
  if (f.drawdownPct > 60) return dropped('Down over 60% from its high');
  if (f.devSold) return dropped('Dev sold');
  if (w.rug?.contractRisk) return dropped(w.rug.contractRisk);
  if (w.rug && w.rug.insiderPct > MAX_INSIDER_PCT) return dropped(`Insider networks hold ${w.rug.insiderPct.toFixed(0)}%`);

  const failure = gateFailure(w, f);
  if (failure) return baseSignal(w, f, 'rejected', failure);

  const samples = w.samples;
  if (samples.length < MIN_SAMPLES) return baseSignal(w, f, 'watch', `Building the 10 s chart (${samples.length}/${MIN_SAMPLES})`);
  const rsi = rsiSeries(samples.map((s) => s.price));
  const rsiNow = rsi[rsi.length - 1];
  const rsiDip = Math.min(...rsi.slice(-4, -1).filter(Number.isFinite));
  const price = samples[samples.length - 1].price;
  const prev = samples[samples.length - 2].price;
  const drawdown = 1 - price / w.highUsd;
  const signalWith = (status: SignalStatus, reason: string, extra: Partial<ScanSignal> = {}) =>
    baseSignal(w, f, status, reason, { rsi: Number.isFinite(rsiNow) ? rsiNow : undefined, ...extra });

  if (rsiNow <= DIP_RSI) return signalWith('watch', `RSI ${rsiNow.toFixed(0)} oversold - waiting for it to turn up`);
  if (rsiDip > DIP_RSI) return signalWith('watch', `RSI ${rsiNow.toFixed(0)} - not chasing; waiting for a dip to ${DIP_RSI}`);
  if (rsi[rsi.length - 2] > DIP_RSI + 2 || price <= prev) return signalWith('watch', `RSI bounced from ${rsiDip.toFixed(0)} without a fresh up-tick`);
  if (drawdown < MIN_DRAWDOWN) return signalWith('watch', `Only ${(drawdown * 100).toFixed(0)}% under the high - not a real pullback`);
  if (drawdown > MAX_DRAWDOWN) return signalWith('rejected', `${(drawdown * 100).toFixed(0)}% under the high - a collapse, not a pullback`);
  const buys5m = Number(w.pair.txns?.m5?.buys) || 0;
  const sells5m = Number(w.pair.txns?.m5?.sells) || 0;
  if (buys5m < sells5m) return signalWith('watch', `Sells lead the last 5 minutes (${buys5m}/${sells5m})`);

  let stop = Math.min(...samples.slice(-4).map((s) => s.price)) * 0.97;
  if (1 - stop / price < MIN_STOP) stop = price * (1 - MIN_STOP);
  const slPercent = 100 * (1 - stop / price);
  if (slPercent > MAX_STOP * 100) return signalWith('rejected', `Dip low is ${slPercent.toFixed(0)}% away - wider than the ${MAX_STOP * 100}% stop`);
  const tpPercent = clamp(2.5 * slPercent, 30, 50);
  return signalWith('ready', `Launch dip: RSI ${rsiDip.toFixed(0)} -> ${rsiNow.toFixed(0)}, ${(drawdown * 100).toFixed(0)}% under the high, ${f.holders} holders`, {
    entryLow: price * 0.99,
    entryHigh: price * 1.03,
    stopPrice: stop,
    targetPrice: price * (1 + tpPercent / 100),
    slPercent,
    tpPercent,
    invalidation: `price under ${px(stop)}`,
  });
}

/** Sell-back quote and score, then the signal goes to auto trade. */
async function confirm(w: Watch, signal: ScanSignal) {
  w.confirming = true;
  w.lastReadyAt = Date.now();
  const block = (reason: string) => {
    w.blocked = { reason, at: Date.now() };
  };
  try {
    const sol = solPrice();
    const buyUsd = opts?.buyAmountUsd() || 0;
    const swap = await swapCheck(w.mint, Math.round((buyUsd / (sol || 1)) * 1e9));
    if (!swap.sellable) return drop(w, swap.error);
    const feePct = buyUsd > 0 ? (100 * 2 * (opts?.priorityFeeSol() || 0) * sol) / buyUsd : 0;
    const costPercent = swap.roundTripPct + feePct;
    const netRewardRisk = ((signal.tpPercent || 0) - costPercent) / ((signal.slPercent || 0) + costPercent);
    if (netRewardRisk < 1) return block(`Fees of ${costPercent.toFixed(1)}% leave reward under risk at this size`);
    if ((signal.score?.total ?? 0) < MIN_LAUNCH_SCORE) return block(`Score ${signal.score?.total ?? 0}/100 is under ${MIN_LAUNCH_SCORE}`);
    const ready: ScanSignal = { ...signal, swap, costPercent, netRewardRisk };
    w.blocked = undefined;
    w.confirmed = { signal: ready, at: Date.now() };
    opts?.onReady(ready);
  } finally {
    w.confirming = false;
  }
}

async function refreshRug(w: Watch, now: number) {
  const m = await rugMetrics(w.mint, RUG_TTL_MS);
  if (!m) return;
  const smartSet = new Set(opts?.smartWallets() || []);
  w.rug = { ...m, at: now, smart: m.topOwners.filter((o) => smartSet.has(o)).length };
  if (w.holderHistory[w.holderHistory.length - 1]?.holders !== m.holders) w.holderHistory.push({ t: now, holders: m.holders });
  if (w.holderHistory.length > 30) w.holderHistory.shift();
}

async function poll() {
  if (!running || polling) return;
  polling = true;
  try {
    const now = Date.now();
    const pairs = await fetchPairs([...watches.keys()]);
    pairs.forEach((p, mint) => {
      const w = watches.get(mint);
      if (!w) return;
      w.pair = p;
      const price = Number(p.priceUsd) || 0;
      if (price > 0 && p.dexId === 'pumpfun') {
        w.samples.push({ t: now, price });
        if (w.samples.length > 120) w.samples.shift();
        w.highUsd = Math.max(w.highUsd, price);
      }
    });

    // RugCheck only for launches with traction, the least recently checked first.
    const due = [...watches.values()]
      .filter((w) => w.pair?.dexId === 'pumpfun' && (Number(w.pair.txns?.h1?.buys) || 0) >= TRACTION[0][1] && (!w.rug || now - w.rug.at >= RUG_TTL_MS))
      .sort((a, b) => (a.rug?.at || 0) - (b.rug?.at || 0))
      .slice(0, RUGCHECKS_PER_POLL);
    for (const w of due) await refreshRug(w, now);

    const out: ScanSignal[] = [];
    for (const w of [...watches.values()]) {
      let s = evaluate(w, Date.now());
      if (!s) continue;
      if (s.status === 'ready') {
        if (w.confirmed && Date.now() - w.confirmed.at < READY_REPEAT_MS / 2) {
          s = w.confirmed.signal;
        } else {
          if (!w.confirming && Date.now() - w.lastReadyAt > READY_REPEAT_MS) void confirm(w, s);
          const blocked = w.blocked && Date.now() - w.blocked.at < READY_REPEAT_MS ? w.blocked.reason : null;
          s = blocked
            ? { ...s, status: 'rejected', reason: blocked }
            : { ...s, status: 'watch', reason: w.confirming ? `${s.reason} - checking the sell-back quote` : `${s.reason} - offered to auto trade ${Math.round((Date.now() - w.lastReadyAt) / 1000)} s ago` };
        }
      }
      out.push(s);
    }
    while (drops.length && now - drops[0].t > 30 * 60_000) drops.shift();
    const rank: Record<SignalStatus, number> = { ready: 0, watch: 1, rejected: 2 };
    latest = out.sort((a, b) => rank[a.status] - rank[b.status] || (b.score?.total ?? 0) - (a.score?.total ?? 0) || b.buys1h - a.buys1h);
  } finally {
    polling = false;
  }
}

export const LaunchWatcher = {
  start(options: LaunchWatcherOptions) {
    opts = options;
    if (!wired) {
      wired = true;
      wsService.onNewToken(onNewToken);
    }
    if (running) return;
    running = true;
    wsService.connect();
    wsService.subscribeNewTokens();
    pollTimer = setInterval(() => void poll(), POLL_MS);
  },

  stop() {
    running = false;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    watches.clear();
    latest = [];
  },

  isRunning: () => running,

  /** Launches being watched right now: ready first, then by score. */
  signals: (): ScanSignal[] => latest,

  watchedCount: () => watches.size,

  /** Why launches were dropped in the last 30 minutes, most common first. */
  dropReasons(): { reason: string; count: number }[] {
    const tally = new Map<string, number>();
    drops.forEach((d) => {
      const key = d.reason.replace(/\d+(\.\d+)?/g, '#');
      tally.set(key, (tally.get(key) || 0) + 1);
    });
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));
  },

  /**
   * Fresh check right before buying (Claude's review takes seconds and launches move fast): still
   * watched, still on the curve, and price not above the entry zone. Returns the current price.
   */
  async recheck(mint: string, maxPriceUsd: number): Promise<{ ok: true; priceUsd: number } | { ok: false; reason: string }> {
    if (!watches.has(mint)) return { ok: false, reason: 'no longer watched (dropped)' };
    const pair = (await fetchPairs([mint])).get(mint);
    const priceUsd = Number(pair?.priceUsd) || 0;
    if (!pair || !priceUsd) return { ok: false, reason: 'no fresh price' };
    if (pair.dexId !== 'pumpfun') return { ok: false, reason: 'graduated while it was being reviewed' };
    if (priceUsd > maxPriceUsd) return { ok: false, reason: `price ran to ${px(priceUsd)}, above the ${px(maxPriceUsd)} entry zone` };
    return { ok: true, priceUsd };
  },
};
