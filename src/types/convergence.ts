/**
 * Smart-wallet convergence flow ("Flow Sistem Meme Coin: Konvergensi Smart Wallet").
 *
 * The bot enters a token only after it passes four gates in order:
 *   1. convergence   tracked smart wallets from different clusters buy it inside a short window
 *   2. safety        hard gate: authorities, liquidity / curve, holders, dev, bundle, sell test
 *   3. momentum      0-100 score of organic interest (watchlist 40-59, AI from 60)
 *   4. AI verdict    Claude looks for reasons to reject; only ENTRY with enough confidence trades
 * Exits run on their own (staged take-profit, moonbag trail, stop, time stop, emergency exits),
 * and every signal - rejected ones too - is written to the journal for the weekly review.
 *
 * Every number here is a starting point to test, not a proven value.
 */

export type WalletTier = 'A' | 'B';

/** What an on-chain read of a wallet's recent transactions shows (Stage 0 verification). */
export interface WalletStats {
  analyzedAt: number;
  /** Transactions read for this analysis (the sample can be shorter than 30 days for busy wallets). */
  sampleTxs: number;
  /** Days the sample actually covers. */
  sampleDays: number;
  /** Distinct tokens bought in the last 30 days of the sample. */
  tokensTraded30d: number;
  /** Share of closed token round trips with a realized profit, in % (null: none closed in the sample). */
  winRate: number | null;
  /** Realized profit in SOL over the last 30 / 90 days of the sample (null: the sample does not reach that far). */
  pnl30dSol: number | null;
  pnl90dSol: number | null;
  /** Realized profit in SOL over the whole sample, whatever its length. */
  pnlSampleSol: number;
  /** Token round trips closed inside the sample. */
  closedTrades: number;
  /** Biggest single-token profit as a share of total profit, 0-1 (null: no profit). */
  largestWinShare: number | null;
  /** Average minutes between the first buy and the last sell of a token. */
  avgHoldMinutes: number | null;
  /** Newest transaction seen. */
  lastActiveAt: number | null;
  /** Account that sent the wallet its first SOL, when the sample reaches back that far. */
  funder: string | null;
  /** The funder is a busy account (exchange hot wallet, service): it does not make a cluster. */
  funderIsService?: boolean;
  /** The wallet created a token in the sample (deployer / dev wallet). */
  deployer: boolean;
}

/** Figures the user copied from Kolscan / GMGN / Nansen. They win over the on-chain sample. */
export interface WalletManualStats {
  tokensTraded30d?: number;
  winRate?: number;
  /** Any unit (SOL or USD): only the sign is checked. */
  pnl30d?: number;
  pnl90d?: number;
  largestWinShare?: number;
  avgHoldMinutes?: number;
}

export interface TrackedWallet {
  address: string;
  label?: string;
  /** Where the candidate came from: DexScreener top traders, early buyer, Kolscan, Nansen, manual... */
  source: string;
  addedAt: number;
  tier: WalletTier;
  /** Cluster set by the user. Wallets in one cluster count once in the convergence trigger. */
  clusterId?: string;
  /** Cluster derived from a funder shared with another tracked wallet. */
  autoClusterId?: string;
  /** Paused wallets are not monitored and never count toward a signal. */
  active: boolean;
  /** Last trade the monitor saw (written at most hourly), so a wallet that trades is never flagged inactive. */
  lastSeenAt?: number;
  notes?: string;
  stats?: WalletStats;
  manual?: WalletManualStats;
}

export type CheckState = 'pass' | 'fail' | 'unknown';

export interface CriteriaCheck {
  key: string;
  label: string;
  value: string;
  state: CheckState;
}

export interface WalletEvaluation {
  checks: CriteriaCheck[];
  /** pass = every criterion met; fail = one failed or a must-drop flag; incomplete = some unknown. */
  verdict: 'pass' | 'fail' | 'incomplete';
  /** Must-drop and weekly-maintenance flags. */
  flags: string[];
}

/** One swap by a monitored wallet, parsed from a transaction or the PumpPortal stream. */
export interface WalletSwap {
  wallet: string;
  mint: string;
  side: 'buy' | 'sell';
  /** SOL spent (buy) or received (sell), network fees excluded. */
  solAmount: number;
  /** Tokens bought or sold (UI amount). */
  tokenAmount: number;
  /** SOL per token. */
  priceSol: number;
  /** Token balance of the wallet before / after the swap (UI amount). */
  preBalance: number;
  postBalance: number;
  signature: string;
  /** Block time in ms. */
  at: number;
  source: 'rpc' | 'stream';
}

export interface TriggerWallet {
  address: string;
  label?: string;
  tier: WalletTier;
  cluster: string;
  points: number;
  solAmount: number;
  priceUsd: number;
  at: number;
  signature: string;
}

/** Stage 1 output: carried to every later stage. */
export interface ConvergenceTrigger {
  mint: string;
  points: number;
  wallets: TriggerWallet[];
  /** Price the first trigger wallet paid. */
  firstBuyPriceUsd: number;
  firstWallet: string;
  firstBuyAt: number;
  triggeredAt: number;
}

export interface SafetyCheck {
  key: 'mint' | 'freeze' | 'liquidity' | 'top10' | 'dev' | 'devHistory' | 'bundle' | 'honeypot';
  label: string;
  state: CheckState;
  value: string;
}

export interface SafetyReport {
  passed: boolean;
  /** First failed check, in plain words. */
  failure?: string;
  checks: SafetyCheck[];
  onCurve: boolean;
  curvePercent?: number;
  liquidityUsd: number;
  lpLockedPct?: number;
  top10Pct?: number;
  devPct?: number;
  bundlePct?: number;
  holders?: number;
  creator?: string;
  sellable?: boolean;
  roundTripPct?: number;
  checkedAt: number;
}

export interface MomentumMetric {
  key: 'holders' | 'buyerRatio' | 'smallWallets' | 'smartAdding' | 'social' | 'narrative';
  label: string;
  weight: number;
  points: number;
  value: string;
}

export interface MomentumReport {
  score: number;
  metrics: MomentumMetric[];
  washTrading: boolean;
  volume15mUsd: number;
  buys15m: number;
  sells15m: number;
  buyers15m: number;
  sellers15m: number;
  newBuyers15m: number;
  top5VolumeShare: number | null;
  poolAddress?: string;
  dataMissing: string[];
  scoredAt: number;
}

export type AiVerdictKind = 'ENTRY' | 'WATCH' | 'SKIP';

export interface ConvergenceAiVerdict {
  verdict: AiVerdictKind;
  confidence: number;
  red_flags: string[];
  alasan: string[];
  syarat_naik_ke_entry: string;
  data_kurang: string[];
  model?: string;
  at: number;
  /** false when Claude could not be asked (no key, timeout). Not a verdict on the token. */
  available: boolean;
  note?: string;
}

/** Where a signal stopped, or that it was traded. */
export type SignalStage = 'trigger' | 'late' | 'safety' | 'momentum' | 'ai' | 'execution' | 'risk';

export type SignalStatus = 'evaluating' | 'watch' | 'entered' | 'rejected' | 'expired' | 'failed';

export type CheckpointKey = 'm5' | 'h1' | 'h6' | 'h24';

export interface ConvergenceSignal {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  imageUrl?: string;
  createdAt: number;
  status: SignalStatus;
  /** The gate the signal stopped at (rejected / expired / failed), or 'execution' once traded. */
  stage: SignalStage;
  reason: string;
  trigger: ConvergenceTrigger;
  priceAtSignalUsd: number;
  liquidityAtSignalUsd: number;
  marketCapAtSignalUsd: number;
  dexId?: string;
  pairAddress?: string;
  safety?: SafetyReport;
  momentum?: MomentumReport;
  ai?: ConvergenceAiVerdict;
  /** Momentum evaluations so far (watchlist re-checks included). */
  evaluations: number;
  lastEvaluatedAt?: number;
  /** Deterministic red flags found by code before (or instead of) the AI. */
  redFlags: string[];
  entry?: { positionId: string; at: number; priceUsd: number; amountUsd: number; isLive: boolean };
  /** Price after the signal; null = could not be read. */
  checkpoints: Partial<Record<CheckpointKey, number | null>>;
  checkpointTries?: Partial<Record<CheckpointKey, number>>;
  result?: { pnlUsd: number; pnlPercent: number; exitReasons: string[]; closedAt: number };
}

/** Per-position exit rules of a convergence entry (Stage 6). */
export interface ExitPlan {
  kind: 'convergence';
  signalId: string;
  tp1Multiple: number;
  /** Share of the ORIGINAL position sold at tp1, in %. */
  tp1SellPct: number;
  tp1Done: boolean;
  tp2Multiple: number;
  tp2SellPct: number;
  tp2Done: boolean;
  /** Trailing stop of the moonbag, % under the high since entry. */
  moonbagTrailPct: number;
  stopLossPct: number;
  timeStopMinutes: number;
  timeStopMinGainPct: number;
  triggerWallets: string[];
  devWallet?: string;
  entryLiquidityUsd?: number;
  entryDexId?: string;
  emergencyLiquidityDropPct: number;
  emergencyTriggerSellers: number;
  /** A trigger wallet counts as out once it sold more than this share of its holding (0-1). */
  emergencySellFraction: number;
  /** Trigger wallets that already sold past the fraction. */
  exitedWallets: string[];
  /** Each trigger wallet's biggest holding of the token seen up to the entry (sell-fraction baseline). */
  walletPeaks?: Record<string, number>;
  /** Tokens bought at entry (reconciles a stage marked done whose sell never ran). */
  entryTokens?: number;
  /** Set once an emergency exit is due: every tick retries the full sell until it goes through. */
  emergency?: string;
}

export type EntryStrategy = 'convergence' | 'setups' | 'both';

export interface ConvergenceConfig {
  /* Stage 0 - wallet criteria */
  minTokensTraded30d: number;
  minWinRate: number;
  maxLargestWinShare: number;
  minAvgHoldMinutes: number;
  inactiveDays: number;
  /** Only wallets that pass every criterion count; off = incomplete (unverified) wallets count too. */
  onlyVerifiedWallets: boolean;
  /* Stage 1 - trigger */
  tierAPoints: number;
  tierBPoints: number;
  triggerPoints: number;
  windowMinutes: number;
  minBuySol: number;
  maxPriceMultipleVsFirst: number;
  /** Seconds between two polls of the same wallet. */
  pollSeconds: number;
  /* Stage 2 - safety */
  minLiquidityUsd: number;
  minLpLockedPct: number;
  maxTop10Pct: number;
  maxDevPct: number;
  maxBundlePct: number;
  curveMinPct: number;
  curveMaxPct: number;
  /** Buy + sell-back quote may lose at most this much (fees, impact, hidden tax). */
  maxRoundTripPct: number;
  /* Stage 3 - momentum */
  aiScore: number;
  watchScore: number;
  watchMinutes: number;
  recheckMinutes: number;
  narratives: string[];
  washMinVolumeUsd: number;
  /* Stage 4 - AI */
  requireAi: boolean;
  aiMinConfidence: number;
  /** Momentum a signal needs to trade when Claude cannot be asked and requireAi is off. */
  noAiMinScore: number;
  /* Stage 5 - execution */
  positionPct: number;
  dailyLossPct: number;
  maxPriceImpactPct: number;
  maxSlippagePct: number;
  maxChaseUpPct: number;
  /* Stage 6 - exits */
  tp1Multiple: number;
  tp1SellPct: number;
  tp2Multiple: number;
  tp2SellPct: number;
  moonbagTrailPct: number;
  stopLossPct: number;
  timeStopMinutes: number;
  timeStopMinGainPct: number;
  emergencyTriggerSellers: number;
  emergencySellFraction: number;
  emergencyLiquidityDropPct: number;
}

/** Defaults straight from the flow document. */
export const DEFAULT_CONVERGENCE_CONFIG: ConvergenceConfig = {
  minTokensTraded30d: 20,
  minWinRate: 40,
  maxLargestWinShare: 0.5,
  minAvgHoldMinutes: 2,
  inactiveDays: 14,
  onlyVerifiedWallets: false,

  tierAPoints: 2,
  tierBPoints: 1,
  triggerPoints: 3,
  windowMinutes: 15,
  minBuySol: 0.2,
  maxPriceMultipleVsFirst: 3,
  pollSeconds: 30,

  minLiquidityUsd: 10_000,
  minLpLockedPct: 90,
  maxTop10Pct: 30,
  maxDevPct: 5,
  maxBundlePct: 20,
  curveMinPct: 20,
  curveMaxPct: 85,
  maxRoundTripPct: 12,

  aiScore: 60,
  watchScore: 40,
  watchMinutes: 30,
  recheckMinutes: 5,
  narratives: [],
  washMinVolumeUsd: 15_000,

  requireAi: true,
  aiMinConfidence: 70,
  noAiMinScore: 75,

  positionPct: 1.5,
  dailyLossPct: 5,
  maxPriceImpactPct: 3,
  maxSlippagePct: 15,
  maxChaseUpPct: 30,

  tp1Multiple: 2,
  tp1SellPct: 50,
  tp2Multiple: 5,
  tp2SellPct: 25,
  moonbagTrailPct: 40,
  stopLossPct: 35,
  timeStopMinutes: 60,
  timeStopMinGainPct: 30,
  emergencyTriggerSellers: 2,
  emergencySellFraction: 0.5,
  emergencyLiquidityDropPct: 50,
};

/** Most wallets the monitor follows (the document starts with 20-50 verified ones). */
export const MAX_TRACKED_WALLETS = 50;
