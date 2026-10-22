/**
 * Stages 1-3 of the convergence flow, plus the package handed to the AI (stage 4).
 *
 *   1. ConvergenceTracker  smart-wallet buys per token inside the window: tier points, one count per
 *                          cluster, the "too late" checks (3x the first buy, first wallet selling)
 *   2. safetyGate          hard gate from RugCheck, the chain and a Jupiter round trip
 *   3. momentumScore       0-100 from GeckoTerminal's 15-minute pool stats and its trade list
 *
 * Everything that only reads data is a pure function of its inputs so the rules can be tested.
 */
import type {
  CheckState,
  ConvergenceConfig,
  ConvergenceTrigger,
  MomentumMetric,
  MomentumReport,
  SafetyCheck,
  SafetyReport,
  TriggerWallet,
  WalletSwap,
  WalletTier,
} from '../types/convergence';
import { GECKO, geckoAvailable, geckoJson, swapCheck } from './scanner.service';

const DEX = 'https://api.dexscreener.com';
const RUGCHECK = 'https://api.rugcheck.xyz/v1/tokens';

/* ================================================================== stage 1: convergence */

export interface WalletInfo {
  address: string;
  label?: string;
  tier: WalletTier;
  cluster: string;
  /** Active and not failing the criteria: its buys count toward a signal. */
  counts: boolean;
}

interface BuyRec {
  wallet: string;
  mint: string;
  solAmount: number;
  /** SOL per token; converted to USD when the trigger is read, so a SOL price that was not loaded yet is not frozen in. */
  priceSol: number;
  at: number;
  signature: string;
}

interface SellRec {
  wallet: string;
  at: number;
  /** Share of the wallet's holding this sell took, 0-1 (NaN when unknown). */
  fraction: number;
}

export interface Candidate {
  mint: string;
  points: number;
  wallets: TriggerWallet[];
  firstAt: number;
  lastAt: number;
}

/** Keeps every tracked wallet's trades for the window and answers "has this token converged?". */
export class ConvergenceTracker {
  private buys = new Map<string, BuyRec[]>();
  private sells = new Map<string, SellRec[]>();
  /** `${wallet}:${mint}` -> the most the wallet was seen holding, and what it holds now. */
  private holdings = new Map<string, { peak: number; now: number }>();

  constructor(
    private cfg: () => ConvergenceConfig,
    private walletInfo: (address: string) => WalletInfo | undefined,
    private solPriceUsd: () => number = () => 0
  ) {}

  ingest(swap: WalletSwap) {
    const key = `${swap.wallet}:${swap.mint}`;
    const h = this.holdings.get(key) || { peak: 0, now: 0 };
    if (Number.isFinite(swap.postBalance)) {
      h.now = swap.postBalance;
      h.peak = Math.max(h.peak, swap.postBalance, Number.isFinite(swap.preBalance) ? swap.preBalance : 0);
    } else if (swap.side === 'buy') {
      h.now += swap.tokenAmount;
      h.peak = Math.max(h.peak, h.now);
    } else {
      h.now = Math.max(0, h.now - swap.tokenAmount);
    }
    this.holdings.set(key, h);

    if (swap.side === 'buy') {
      const list = this.buys.get(swap.mint) || [];
      if (list.some((b) => b.signature === swap.signature)) return;
      list.push({ wallet: swap.wallet, mint: swap.mint, solAmount: swap.solAmount, priceSol: swap.priceSol, at: swap.at, signature: swap.signature });
      this.buys.set(swap.mint, list);
    } else {
      const pre = Number.isFinite(swap.preBalance) && swap.preBalance > 0 ? swap.preBalance : NaN;
      const list = this.sells.get(swap.mint) || [];
      list.push({ wallet: swap.wallet, at: swap.at, fraction: Number.isFinite(pre) ? Math.min(1, swap.tokenAmount / pre) : NaN });
      this.sells.set(swap.mint, list);
    }
  }

  /** Points of `mint` at `now`: tier points per cluster (each cluster once), qualifying buys only. */
  evaluate(mint: string, now = Date.now()): Candidate & { first: BuyRec | null } {
    const cfg = this.cfg();
    const from = now - cfg.windowMinutes * 60_000;
    const qualifying = (this.buys.get(mint) || [])
      .filter((b) => b.at >= from && b.at <= now + 60_000 && b.solAmount >= cfg.minBuySol)
      .map((b) => ({ b, info: this.walletInfo(b.wallet) }))
      .filter((x): x is { b: BuyRec; info: WalletInfo } => !!x.info?.counts)
      .sort((x, y) => x.b.at - y.b.at);

    // First qualifying buy per wallet.
    const firstByWallet = new Map<string, { b: BuyRec; info: WalletInfo }>();
    qualifying.forEach((x) => {
      if (!firstByWallet.has(x.b.wallet)) firstByWallet.set(x.b.wallet, x);
    });
    // Best tier per cluster: the cluster is worth that tier's points, once.
    const tierPoints = (t: WalletTier) => (t === 'A' ? cfg.tierAPoints : cfg.tierBPoints);
    const bestOfCluster = new Map<string, string>();
    firstByWallet.forEach(({ info }, wallet) => {
      const cur = bestOfCluster.get(info.cluster);
      const curInfo = cur ? firstByWallet.get(cur)!.info : null;
      if (!curInfo || tierPoints(info.tier) > tierPoints(curInfo.tier)) bestOfCluster.set(info.cluster, wallet);
    });

    const wallets: TriggerWallet[] = [...firstByWallet.values()].map(({ b, info }) => ({
      address: b.wallet,
      label: info.label,
      tier: info.tier,
      cluster: info.cluster,
      points: bestOfCluster.get(info.cluster) === b.wallet ? tierPoints(info.tier) : 0,
      solAmount: b.solAmount,
      priceUsd: b.priceSol * this.solPriceUsd(),
      at: b.at,
      signature: b.signature,
    }));
    const points = wallets.reduce((a, w) => a + w.points, 0);
    const first = qualifying[0]?.b || null;
    return {
      mint,
      points,
      wallets,
      first,
      firstAt: first?.at || 0,
      lastAt: qualifying.length ? qualifying[qualifying.length - 1].b.at : 0,
    };
  }

  /** Stage 1 output for a token that reached the trigger, or null. */
  trigger(mint: string, now = Date.now()): ConvergenceTrigger | null {
    const c = this.evaluate(mint, now);
    if (!c.first || c.points < this.cfg().triggerPoints) return null;
    return {
      mint,
      points: c.points,
      wallets: c.wallets,
      firstBuyPriceUsd: c.first.priceSol * this.solPriceUsd(),
      firstWallet: c.first.wallet,
      firstBuyAt: c.first.at,
      triggeredAt: now,
    };
  }

  /** Tokens with at least one counted point, most points first. */
  candidates(now = Date.now()): Candidate[] {
    const out: Candidate[] = [];
    this.buys.forEach((_, mint) => {
      const c = this.evaluate(mint, now);
      if (c.points > 0) out.push({ mint: c.mint, points: c.points, wallets: c.wallets, firstAt: c.firstAt, lastAt: c.lastAt });
    });
    return out.sort((a, b) => b.points - a.points || b.lastAt - a.lastAt);
  }

  /** Any sell of `mint` by `wallet` after `since`. */
  soldSince(mint: string, wallet: string, since: number): boolean {
    return (this.sells.get(mint) || []).some((s) => s.wallet === wallet && s.at > since);
  }

  /** A trigger wallet bought again after its first counted buy (adding to its position). */
  addedAgain(mint: string, trigger: ConvergenceTrigger): boolean {
    const firstAt = new Map(trigger.wallets.map((w) => [w.address, w.at]));
    return (this.buys.get(mint) || []).some((b) => firstAt.has(b.wallet) && b.at > firstAt.get(b.wallet)! && b.signature !== trigger.wallets.find((w) => w.address === b.wallet)?.signature);
  }

  /** The most of `mint` the wallet was seen holding (0 when unknown). */
  peakHolding(wallet: string, mint: string): number {
    return this.holdings.get(`${wallet}:${mint}`)?.peak || 0;
  }

  /** Share of its biggest holding `wallet` has sold since, 0-1 (0 when nothing is known). */
  soldFraction(wallet: string, mint: string): number {
    const h = this.holdings.get(`${wallet}:${mint}`);
    if (h && h.peak > 0) return Math.max(0, Math.min(1, 1 - h.now / h.peak));
    // Stream sells without balances: add up the fractions that are known.
    const sum = (this.sells.get(mint) || []).filter((s) => s.wallet === wallet && Number.isFinite(s.fraction)).reduce((a, s) => a + s.fraction, 0);
    return Math.min(1, sum);
  }

  /** Drops trades older than `keepMs`, except for mints still in use (open positions, signals). */
  prune(keepMs: number, keepMints: Set<string>, now = Date.now()) {
    const cutoff = now - keepMs;
    this.buys.forEach((list, mint) => {
      if (keepMints.has(mint)) return;
      const kept = list.filter((b) => b.at >= cutoff);
      if (kept.length) this.buys.set(mint, kept);
      else this.buys.delete(mint);
    });
    this.sells.forEach((list, mint) => {
      if (keepMints.has(mint)) return;
      const kept = list.filter((s) => s.at >= cutoff);
      if (kept.length) this.sells.set(mint, kept);
      else this.sells.delete(mint);
    });
    if (this.holdings.size > 5_000) {
      [...this.holdings.keys()].slice(0, 1_000).forEach((k) => {
        if (!keepMints.has(k.split(':')[1])) this.holdings.delete(k);
      });
    }
  }
}

/**
 * The "already too late" rules of stage 1: price more than N times what the first trigger wallet
 * paid, or the first trigger wallet already selling before the signal fired.
 */
export function lateCheck(trigger: ConvergenceTrigger, priceUsd: number, cfg: ConvergenceConfig, firstWalletSold: boolean): string | null {
  if (trigger.firstBuyPriceUsd > 0 && priceUsd > trigger.firstBuyPriceUsd * cfg.maxPriceMultipleVsFirst) {
    return `Price is ${(priceUsd / trigger.firstBuyPriceUsd).toFixed(1)}x what the first trigger wallet paid (limit ${cfg.maxPriceMultipleVsFirst}x) - too late`;
  }
  if (firstWalletSold) return 'The first trigger wallet already sold part of its position before the signal fired';
  return null;
}

/* ================================================================== market data */

async function getJson(url: string, timeoutMs = 10_000): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The pair a convergence entry trades: a graduated token's AMM pool wins over its bonding curve. */
export async function fetchBestPair(mint: string): Promise<any | null> {
  const pairs = await getJson(`${DEX}/tokens/v1/solana/${mint}`);
  const list = (Array.isArray(pairs) ? pairs : []).filter((p: any) => p?.baseToken?.address === mint);
  if (!list.length) return null;
  const amm = list.filter((p: any) => p.dexId !== 'pumpfun');
  const pool = (amm.length ? amm : list).sort((a: any, b: any) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0));
  return pool[0];
}

/** Current USD price per mint from DexScreener (batched by 30). */
export async function fetchPrices(mints: string[]): Promise<Map<string, { priceUsd: number; liquidityUsd: number; dexId?: string }>> {
  const out = new Map<string, { priceUsd: number; liquidityUsd: number; dexId?: string }>();
  for (let i = 0; i < mints.length; i += 30) {
    const pairs = await getJson(`${DEX}/tokens/v1/solana/${mints.slice(i, i + 30).join(',')}`);
    (Array.isArray(pairs) ? pairs : []).forEach((p: any) => {
      const mint = p?.baseToken?.address;
      const price = Number(p?.priceUsd) || 0;
      if (!mint || !price) return;
      const prev = out.get(mint);
      const liq = Number(p.liquidity?.usd) || 0;
      const better = !prev || (p.dexId !== 'pumpfun' && prev.dexId === 'pumpfun') || (liq > prev.liquidityUsd && !(p.dexId === 'pumpfun' && prev.dexId !== 'pumpfun'));
      if (better) out.set(mint, { priceUsd: price, liquidityUsd: liq, dexId: p.dexId });
    });
  }
  return out;
}

/* ================================================================== stage 2: safety */

export interface RugReport {
  mintAuthority: string | null | undefined;
  freezeAuthority: string | null | undefined;
  rugged: boolean;
  transferFee: boolean;
  permanentDelegate: boolean;
  transferHook: boolean;
  top10Pct: number;
  devPct: number;
  /** undefined when RugCheck has no insider-network data for the token. */
  insiderPct?: number;
  holders: number;
  creator?: string;
  lpLockedPct?: number;
  riskNames: string[];
  /** Tokens the creator launched before, when RugCheck lists them. */
  creatorTokens?: number;
}

const rugMemo = new Map<string, { at: number; value: RugReport }>();

/** RugCheck report reduced to what the hard gate reads; null when RugCheck did not answer. */
export async function rugReport(mint: string, ttlMs = 60_000): Promise<RugReport | null> {
  const hit = rugMemo.get(mint);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const r = await getJson(`${RUGCHECK}/${mint}/report`, 12_000);
  if (!r) return hit?.value ?? null;
  const value = parseRugReport(r);
  rugMemo.set(mint, { at: Date.now(), value });
  if (rugMemo.size > 400) [...rugMemo.keys()].slice(0, 100).forEach((k) => rugMemo.delete(k));
  return value;
}

/** Pure: the RugCheck fields the gate needs. Pools, curves and exchanges are not counted as holders. */
export function parseRugReport(r: any): RugReport {
  const known = r?.knownAccounts || {};
  const supply = Number(r?.token?.supply) || 0;
  const holders = (r?.topHolders || []).filter((h: any) => !known[h.owner] && !known[h.address]);
  const insiderAmount = (r?.insiderNetworks || []).reduce((a: number, n: any) => a + (Number(n.tokenAmount) || 0), 0);
  const ext = r?.token_extensions || {};
  const fee = ext.transferFeeConfig;
  const feeBps = Number(fee?.newerTransferFee?.transferFeeBasisPoints ?? fee?.olderTransferFee?.transferFeeBasisPoints ?? (fee ? 1 : 0)) || 0;
  const lockPcts = (r?.markets || [])
    .map((m: any) => Number(m?.lp?.lpLockedPct))
    .filter((v: number) => Number.isFinite(v));
  return {
    // null = revoked; undefined = the report did not say (the chain is asked instead).
    mintAuthority: r?.mintAuthority !== undefined ? r.mintAuthority : r?.token?.mintAuthority,
    freezeAuthority: r?.freezeAuthority !== undefined ? r.freezeAuthority : r?.token?.freezeAuthority,
    rugged: !!r?.rugged,
    transferFee: !!fee && feeBps > 0,
    permanentDelegate: !!ext.permanentDelegate,
    transferHook: !!ext.transferHook?.programId,
    top10Pct: holders.slice(0, 10).reduce((a: number, h: any) => a + (Number(h.pct) || 0), 0),
    devPct: supply ? (100 * (Number(r?.creatorBalance) || 0)) / supply : 0,
    insiderPct: Array.isArray(r?.insiderNetworks) && supply ? (100 * insiderAmount) / supply : undefined,
    holders: Number(r?.totalHolders) || 0,
    creator: r?.creator || undefined,
    lpLockedPct: lockPcts.length ? Math.max(...lockPcts) : undefined,
    riskNames: (r?.risks || []).map((x: any) => String(x?.name || '')).filter(Boolean),
    creatorTokens: Array.isArray(r?.creatorTokens) ? r.creatorTokens.length : undefined,
  };
}

/** On-chain mint / freeze authorities (our own RPC read), used when RugCheck is silent. */
async function chainAuthorities(mint: string): Promise<{ mintAuthority: string | null; freezeAuthority: string | null } | null> {
  const d = await getJson(`/api/token/safety?mint=${mint}`);
  return d && !d.error ? { mintAuthority: d.mintAuthority ?? null, freezeAuthority: d.freezeAuthority ?? null } : null;
}

const pct = (v: number) => `${v.toFixed(1)}%`;

/**
 * Pump.fun bonding-curve progress from market cap (same model as the launch watcher: x*y=k with
 * 30 virtual SOL against 1.073B virtual tokens, graduating at 85 real SOL), with the SOL price
 * passed in so the function stays pure.
 */
export function curveProgress(marketCapUsd: number, solPriceUsd: number): number {
  if (!(solPriceUsd > 0) || !(marketCapUsd > 0)) return 0;
  const vSol = Math.sqrt((marketCapUsd / solPriceUsd) * 32.19);
  return Math.max(0, Math.min(100, ((vSol - 30) / 85) * 100));
}
const usd = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(1)}K`);

/**
 * Pure evaluation of the hard gate. Contract, liquidity, holder and sell checks fail when the data
 * is missing (unverified counts as risk); dev history and bundle stay "unknown" without blocking.
 */
export function evaluateSafety(
  input: {
    rug: RugReport | null;
    chain: { mintAuthority: string | null; freezeAuthority: string | null } | null;
    pair: any;
    sell: { sellable: true; roundTripPct: number } | { sellable: false; error: string } | null;
    solPriceUsd: number;
  },
  cfg: ConvergenceConfig
): SafetyReport {
  const { rug, chain, pair } = input;
  const checks: SafetyCheck[] = [];
  const onCurve = pair?.dexId === 'pumpfun';
  const liquidityUsd = Number(pair?.liquidity?.usd) || 0;
  const marketCap = Number(pair?.marketCap || pair?.fdv) || 0;

  const authority = (fromRug: string | null | undefined, fromChain: string | null | undefined): CheckState =>
    fromRug !== undefined ? (fromRug ? 'fail' : 'pass') : fromChain !== undefined ? (fromChain ? 'fail' : 'pass') : 'unknown';
  const mintState = authority(rug?.mintAuthority, chain ? chain.mintAuthority : undefined);
  checks.push({ key: 'mint', label: 'Mint authority revoked', state: mintState, value: mintState === 'unknown' ? 'no data' : mintState === 'fail' ? 'still set' : 'revoked' });
  const freezeState = authority(rug?.freezeAuthority, chain ? chain.freezeAuthority : undefined);
  checks.push({ key: 'freeze', label: 'Freeze authority revoked', state: freezeState, value: freezeState === 'unknown' ? 'no data' : freezeState === 'fail' ? 'still set' : 'revoked' });

  let curve: number | undefined;
  if (onCurve) {
    curve = curveProgress(marketCap, input.solPriceUsd);
    const ok = curve >= cfg.curveMinPct && curve <= cfg.curveMaxPct;
    checks.push({
      key: 'liquidity',
      label: `Bonding curve ${cfg.curveMinPct}-${cfg.curveMaxPct}%`,
      state: input.solPriceUsd > 0 && marketCap > 0 ? (ok ? 'pass' : 'fail') : 'unknown',
      value: input.solPriceUsd > 0 && marketCap > 0 ? `curve ${curve.toFixed(0)}%` : 'no data',
    });
  } else {
    // Pump.fun burns the LP of every token it migrates to PumpSwap.
    const burnedByProtocol = pair?.dexId === 'pumpswap';
    const locked = rug?.lpLockedPct;
    const unlockedRisk = !!rug?.riskNames.some((n) => /LP Unlocked/i.test(n));
    const lpOk = burnedByProtocol || (locked !== undefined && locked >= cfg.minLpLockedPct && !unlockedRisk);
    const lpKnown = burnedByProtocol || locked !== undefined || unlockedRisk;
    const deepEnough = liquidityUsd >= cfg.minLiquidityUsd;
    checks.push({
      key: 'liquidity',
      label: `LP burned/locked, liquidity ≥ ${usd(cfg.minLiquidityUsd)}`,
      state: !deepEnough || (lpKnown && !lpOk) ? 'fail' : lpKnown ? 'pass' : 'unknown',
      value: `${usd(liquidityUsd)} · LP ${burnedByProtocol ? 'burned (PumpSwap)' : locked !== undefined ? `${locked.toFixed(0)}% locked` : unlockedRisk ? 'unlocked' : 'lock unknown'}`,
    });
  }

  checks.push({
    key: 'top10',
    label: `Top 10 holders ≤ ${cfg.maxTop10Pct}% (no LP/curve)`,
    state: rug ? (rug.top10Pct <= cfg.maxTop10Pct ? 'pass' : 'fail') : 'unknown',
    value: rug ? pct(rug.top10Pct) : 'no data',
  });
  checks.push({
    key: 'dev',
    label: `Dev holds ≤ ${cfg.maxDevPct}%`,
    state: rug ? (rug.devPct <= cfg.maxDevPct ? 'pass' : 'fail') : 'unknown',
    value: rug ? pct(rug.devPct) : 'no data',
  });

  const rugHistory = rug?.riskNames.find((n) => /creator.*(rug|history)/i.test(n));
  const serial = rug?.creatorTokens !== undefined && rug.creatorTokens >= 5;
  checks.push({
    key: 'devHistory',
    label: 'Dev has no rugged token',
    state: !rug ? 'unknown' : rug.rugged || rugHistory || serial ? 'fail' : rug.creatorTokens !== undefined ? 'pass' : 'unknown',
    value: !rug
      ? 'no data'
      : rug.rugged
      ? 'this token is marked rugged'
      : rugHistory
      ? rugHistory
      : serial
      ? `${rug.creatorTokens} earlier tokens (serial launcher)`
      : rug.creatorTokens !== undefined
      ? `${rug.creatorTokens} earlier tokens`
      : 'no creator history in RugCheck',
  });
  checks.push({
    key: 'bundle',
    label: `Bundle / insider networks ≤ ${cfg.maxBundlePct}%`,
    state: rug?.insiderPct === undefined ? 'unknown' : rug.insiderPct <= cfg.maxBundlePct ? 'pass' : 'fail',
    value: rug?.insiderPct === undefined ? 'no RugCheck insider data' : pct(rug.insiderPct),
  });

  const sell = input.sell;
  const taxed = !!rug && (rug.transferFee || rug.permanentDelegate || rug.transferHook);
  // A round trip far above swap fees and impact means a hidden sell tax or a dynamic-fee pool.
  const costly = !!sell && sell.sellable && sell.roundTripPct > cfg.maxRoundTripPct;
  checks.push({
    key: 'honeypot',
    label: `Sell test passes, 0% sell tax (round trip ≤ ${cfg.maxRoundTripPct}%)`,
    state: taxed || costly || (sell && !sell.sellable) ? 'fail' : sell?.sellable ? 'pass' : 'unknown',
    value: taxed
      ? rug!.transferFee
        ? 'Token-2022 transfer fee'
        : rug!.permanentDelegate
        ? 'Token-2022 permanent delegate'
        : 'Token-2022 transfer hook'
      : sell
      ? sell.sellable
        ? `sellable, round trip ${sell.roundTripPct.toFixed(1)}%`
        : sell.error
      : 'no quote',
  });

  // Unknown blocks for everything except dev history and bundle, which RugCheck does not always fill.
  const soft = new Set<SafetyCheck['key']>(['devHistory', 'bundle']);
  const failed = checks.find((c) => c.state === 'fail' || (c.state === 'unknown' && !soft.has(c.key)));
  return {
    passed: !failed,
    failure: failed ? `${failed.label}: ${failed.value}` : undefined,
    checks,
    onCurve,
    curvePercent: curve,
    liquidityUsd,
    lpLockedPct: rug?.lpLockedPct,
    top10Pct: rug?.top10Pct,
    devPct: rug?.devPct,
    bundlePct: rug?.insiderPct,
    holders: rug?.holders,
    creator: rug?.creator,
    sellable: sell ? sell.sellable : undefined,
    roundTripPct: sell && sell.sellable ? sell.roundTripPct : undefined,
    checkedAt: Date.now(),
  };
}

/** Stage 2: fetches what the hard gate reads and evaluates it. */
export async function safetyGate(mint: string, pair: any, cfg: ConvergenceConfig, ctx: { buyLamports: number; solPriceUsd: number }): Promise<SafetyReport> {
  // Jupiter wants a whole number of lamports.
  const [rug, sell] = await Promise.all([rugReport(mint), swapCheck(mint, Math.max(1_000_000, Math.round(ctx.buyLamports)))]);
  const chain = !rug || rug.mintAuthority === undefined || rug.freezeAuthority === undefined ? await chainAuthorities(mint) : null;
  return evaluateSafety({ rug, chain, pair, sell, solPriceUsd: ctx.solPriceUsd }, cfg);
}

/* ================================================================== stage 3: momentum */

export interface PoolStats {
  pool: string;
  buys15m: number;
  sells15m: number;
  buyers15m: number;
  sellers15m: number;
  volume15mUsd: number;
}

export interface PoolTrade {
  at: number;
  kind: 'buy' | 'sell';
  from: string;
  volumeUsd: number;
}

/** The token's deepest GeckoTerminal pool with its 15-minute stats. */
export async function fetchPoolStats(mint: string): Promise<PoolStats | null> {
  if (!geckoAvailable()) return null;
  const data = await geckoJson(`${GECKO}/tokens/${mint}/pools?page=1`);
  const pools: any[] = data?.data || [];
  if (!pools.length) return null;
  const best = [...pools].sort((a, b) => (Number(b?.attributes?.reserve_in_usd) || 0) - (Number(a?.attributes?.reserve_in_usd) || 0))[0];
  const a = best?.attributes || {};
  const t = a.transactions?.m15 || {};
  return {
    pool: String(a.address || String(best.id || '').replace(/^solana_/, '')),
    buys15m: Number(t.buys) || 0,
    sells15m: Number(t.sells) || 0,
    buyers15m: Number(t.buyers) || 0,
    sellers15m: Number(t.sellers) || 0,
    volume15mUsd: Number(a.volume_usd?.m15) || 0,
  };
}

/** The pool's latest trades (GeckoTerminal returns up to 300 from the last 24 hours). */
export async function fetchPoolTrades(pool: string): Promise<PoolTrade[] | null> {
  if (!geckoAvailable()) return null;
  const data = await geckoJson(`${GECKO}/pools/${pool}/trades`);
  const rows: any[] | undefined = data?.data;
  if (!Array.isArray(rows)) return null;
  return rows
    .map((r) => r?.attributes || {})
    .map((a) => ({
      at: Date.parse(a.block_timestamp) || 0,
      kind: a.kind === 'sell' ? ('sell' as const) : ('buy' as const),
      from: String(a.tx_from_address || ''),
      volumeUsd: Number(a.volume_in_usd) || 0,
    }))
    .filter((t) => t.at > 0 && t.from);
}

export interface MomentumInputs {
  now: number;
  windowMinutes: number;
  stats: PoolStats | null;
  trades: PoolTrade[] | null;
  /** RugCheck holder counts read at earlier evaluations, oldest first. */
  holderSamples: { at: number; holders: number }[];
  smartAdding: boolean;
  socials: { twitter: boolean; telegram: boolean; website: boolean };
  narrativeText: string;
  narratives: string[];
}

/** Pure stage-3 score from already fetched data. */
export function scoreMomentum(x: MomentumInputs, cfg: ConvergenceConfig): MomentumReport {
  const missing: string[] = [];
  const from = x.now - x.windowMinutes * 60_000;
  const recent = (x.trades || []).filter((t) => t.at >= from && t.at <= x.now + 60_000);
  if (!x.trades) missing.push('trade list (GeckoTerminal) unavailable');
  if (!x.stats) missing.push('15-minute pool stats (GeckoTerminal) unavailable');

  // New unique buyers per third of the window (or of the span the trade list covers).
  const oldest = x.trades && x.trades.length ? Math.min(...x.trades.map((t) => t.at)) : x.now;
  const spanFrom = Math.max(from, oldest);
  const third = Math.max(1, (x.now - spanFrom) / 3);
  const firstBuy = new Map<string, number>();
  recent
    .filter((t) => t.kind === 'buy')
    .sort((a, b) => a.at - b.at)
    .forEach((t) => {
      if (!firstBuy.has(t.from)) firstBuy.set(t.from, t.at);
    });
  const buckets = [0, 0, 0];
  firstBuy.forEach((at) => {
    buckets[Math.min(2, Math.max(0, Math.floor((at - spanFrom) / third)))]++;
  });
  const newBuyers = firstBuy.size;
  const consistent = buckets.every((b) => b >= 2) && Math.max(...buckets) / Math.max(1, newBuyers) <= 0.6;
  const twoBuckets = buckets.filter((b) => b > 0).length >= 2;
  const samples = x.holderSamples;
  const holdersFalling = samples.length >= 2 && samples[samples.length - 1].holders < samples[0].holders;
  let holderPts = !x.trades ? 0 : newBuyers >= 15 && consistent ? 25 : newBuyers >= 8 && twoBuckets ? 15 : newBuyers >= 3 ? 6 : 0;
  if (holdersFalling) holderPts = 0;

  const buyers = x.stats?.buyers15m ?? 0;
  const sellers = x.stats?.sellers15m ?? 0;
  const ratio = buyers / Math.max(1, sellers);
  let ratioPts = !x.stats ? 0 : ratio >= 1.5 ? 20 : ratio >= 1.25 ? 12 : ratio >= 1 ? 6 : 0;

  const byWallet = new Map<string, number>();
  recent.forEach((t) => byWallet.set(t.from, (byWallet.get(t.from) || 0) + t.volumeUsd));
  const totalVol = [...byWallet.values()].reduce((a, b) => a + b, 0);
  const top5 = [...byWallet.values()].sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
  const top5Share = totalVol > 0 ? top5 / totalVol : null;
  let smallPts = top5Share === null ? 0 : top5Share < 0.3 ? 20 : top5Share < 0.45 ? 10 : top5Share < 0.6 ? 4 : 0;

  // Wash trading: real volume with no new wallets behind it.
  const volume = x.stats?.volume15mUsd ?? recent.reduce((a, t) => a + t.volumeUsd, 0);
  const buys = x.stats?.buys15m ?? recent.filter((t) => t.kind === 'buy').length;
  const wash = volume >= cfg.washMinVolumeUsd && ((!!x.trades && newBuyers <= 5) || (buys >= 40 && buyers / Math.max(1, buys) < 0.2) || holdersFalling);
  if (wash) {
    ratioPts = 0;
    smallPts = 0;
  }

  const socialPts = Math.min(5, (x.socials.twitter ? 3 : 0) + (x.socials.telegram ? 2 : 0) + (x.socials.website && !x.socials.twitter ? 1 : 0));
  missing.push('social activity and mention growth are not measured (link presence only, max 5 of 10)');
  const text = x.narrativeText.toLowerCase();
  const matched = x.narratives.map((n) => n.trim().toLowerCase()).filter(Boolean).find((n) => text.includes(n));
  if (!x.narratives.length) missing.push("this week's narratives are not set");

  const metrics: MomentumMetric[] = [
    {
      key: 'holders',
      label: 'Unique holder growth',
      weight: 25,
      points: holderPts,
      value: x.trades ? `${newBuyers} new buyers (${buckets.join(' / ')} per 5 min)${holdersFalling ? ', holders falling' : ''}` : 'no data',
    },
    { key: 'buyerRatio', label: 'Unique buyers : sellers', weight: 20, points: ratioPts, value: x.stats ? `${buyers} : ${sellers} (${ratio.toFixed(2)})${wash ? ' - wash' : ''}` : 'no data' },
    {
      key: 'smallWallets',
      label: 'Volume from small wallets',
      weight: 20,
      points: smallPts,
      value: top5Share === null ? 'no data' : `top 5 wallets ${(top5Share * 100).toFixed(0)}% of volume${wash ? ' - wash' : ''}`,
    },
    { key: 'smartAdding', label: 'Smart wallets adding', weight: 15, points: x.smartAdding ? 15 : 0, value: x.smartAdding ? 'a trigger wallet bought again' : 'no repeat buy yet' },
    {
      key: 'social',
      label: 'Social (X / Telegram)',
      weight: 10,
      points: socialPts,
      value: [x.socials.twitter && 'X', x.socials.telegram && 'Telegram', x.socials.website && 'website'].filter(Boolean).join(', ') || 'no links',
    },
    { key: 'narrative', label: 'Narrative fit', weight: 10, points: matched ? 10 : 0, value: matched ? `matches "${matched}"` : x.narratives.length ? 'no match' : 'no narratives set' },
  ];

  return {
    score: metrics.reduce((a, m) => a + m.points, 0),
    metrics,
    washTrading: wash,
    volume15mUsd: Math.round(volume),
    buys15m: buys,
    sells15m: x.stats?.sells15m ?? recent.filter((t) => t.kind === 'sell').length,
    buyers15m: buyers,
    sellers15m: sellers,
    newBuyers15m: newBuyers,
    top5VolumeShare: top5Share === null ? null : Math.round(top5Share * 1000) / 1000,
    poolAddress: x.stats?.pool,
    dataMissing: missing,
    scoredAt: x.now,
  };
}

/** Stage 3: fetches GeckoTerminal's pool stats and trades, then scores. */
export async function momentumScore(
  mint: string,
  ctx: Omit<MomentumInputs, 'now' | 'stats' | 'trades' | 'windowMinutes'>,
  cfg: ConvergenceConfig
): Promise<MomentumReport> {
  const stats = await fetchPoolStats(mint);
  const trades = stats?.pool ? await fetchPoolTrades(stats.pool) : null;
  return scoreMomentum({ ...ctx, now: Date.now(), windowMinutes: cfg.windowMinutes, stats, trades }, cfg);
}

/** Social links of a DexScreener pair. */
export function socialsOf(pair: any): { twitter: boolean; telegram: boolean; website: boolean } {
  const socials: { type?: string; url?: string }[] = pair?.info?.socials || [];
  return {
    twitter: socials.some((s) => s.type === 'twitter' || /x\.com|twitter\.com/.test(s.url || '')),
    telegram: socials.some((s) => s.type === 'telegram' || /t\.me/.test(s.url || '')),
    website: !!pair?.info?.websites?.length,
  };
}

/* ================================================================== stage 5: entry quote */

const JUPITER = 'https://lite-api.jup.ag/swap/v1';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Price impact, in %, of buying `lamports` of SOL worth of `mint` right now (Jupiter quote). Jupiter
 * reports it as a fraction ("0.0123" = 1.23%). null when no route was found.
 */
export async function entryImpactPct(mint: string, lamports: number, slippagePct: number): Promise<number | null> {
  const q = await getJson(
    `${JUPITER}/quote?inputMint=${SOL_MINT}&outputMint=${mint}&amount=${Math.max(1, Math.round(lamports))}&slippageBps=${Math.round(slippagePct * 100)}&restrictIntermediateTokens=true`,
    6_000
  );
  if (!q?.outAmount) return null;
  const v = Number(q.priceImpactPct);
  return Number.isFinite(v) ? Math.abs(v) * 100 : 0;
}

/* ================================================================== stage 7: price checkpoints */

/** Close of the 5-minute candle that ends at `at` (backfill of a checkpoint the app was closed for). */
export async function priceAt(pool: string, mint: string, at: number): Promise<number | null> {
  if (!geckoAvailable()) return null;
  const ts = Math.floor(at / 1000) + 300;
  const data = await geckoJson(`${GECKO}/pools/${pool}/ohlcv/minute?aggregate=5&before_timestamp=${ts}&limit=1&currency=usd&token=${mint}`);
  const row: number[] | undefined = data?.data?.attributes?.ohlcv_list?.[0];
  const close = row ? Number(row[4]) : NaN;
  return Number.isFinite(close) && close > 0 ? close : null;
}
