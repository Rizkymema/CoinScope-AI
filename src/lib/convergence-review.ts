/**
 * Stage 7: the weekly review, computed from the signal journal.
 *
 * Outcome of a signal: an entered signal is a win when its realized P&L (fees and slippage
 * included) is positive. A signal that was not traded counts as a winner when it reached 2x the
 * signal price at +1h, +6h or +24h (a "missed winner"), and as a loser when it sat under the
 * signal price at its last checkpoint.
 */
import type { ConvergenceConfig, ConvergenceSignal, SignalStage, TrackedWallet, WalletTier } from '../types/convergence';

export type Outcome = 'win' | 'loss' | 'unknown';

/** Highest +1h / +6h / +24h price as a multiple of the signal price. */
export function bestMultiple(s: ConvergenceSignal): number | null {
  if (!(s.priceAtSignalUsd > 0)) return null;
  const vals = (['h1', 'h6', 'h24'] as const).map((k) => s.checkpoints[k]).filter((v): v is number => typeof v === 'number' && v > 0);
  return vals.length ? Math.max(...vals) / s.priceAtSignalUsd : null;
}

export function lastMultiple(s: ConvergenceSignal): number | null {
  if (!(s.priceAtSignalUsd > 0)) return null;
  const v = s.checkpoints.h24 ?? s.checkpoints.h6 ?? s.checkpoints.h1 ?? s.checkpoints.m5;
  return typeof v === 'number' && v > 0 ? v / s.priceAtSignalUsd : null;
}

export function outcomeOf(s: ConvergenceSignal): Outcome {
  if (s.status === 'entered') return s.result ? (s.result.pnlUsd > 0 ? 'win' : 'loss') : 'unknown';
  const best = bestMultiple(s);
  if (best !== null && best >= 2) return 'win';
  const last = lastMultiple(s);
  if (last !== null && (s.checkpoints.h24 != null || s.checkpoints.h6 != null) && last < 1) return 'loss';
  return 'unknown';
}

export interface WalletReviewRow {
  address: string;
  label?: string;
  tier: WalletTier;
  signals: number;
  wins: number;
  losses: number;
  suggestion?: { tier?: WalletTier; remove?: boolean; why: string };
}

export interface GateReviewRow {
  stage: SignalStage;
  stopped: number;
  missedWinners: number;
}

export interface AiReviewRow {
  group: string;
  n: number;
  reached2x: number;
  avgH6Pct: number | null;
}

export interface CoreMetrics {
  trades: number;
  wins: number;
  winRate: number;
  avgWinUsd: number;
  avgLossUsd: number;
  totalPnlUsd: number;
  maxDrawdownUsd: number;
  /** (win rate x average win) - (loss rate x average loss); fees are already in each P&L. */
  expectancyUsd: number;
}

export interface Review {
  from: number;
  signals: number;
  entered: number;
  wallets: WalletReviewRow[];
  gates: GateReviewRow[];
  ai: AiReviewRow[];
  core: CoreMetrics;
  aiAddsValue: boolean | null;
}

const MIN_SAMPLE = 3;

export function buildReview(journal: ConvergenceSignal[], wallets: TrackedWallet[], cfg: ConvergenceConfig, from: number): Review {
  const list = journal.filter((s) => s.createdAt >= from && s.status !== 'evaluating');

  // Wallets: how the signals each one triggered turned out.
  const byWallet = new Map<string, { signals: number; wins: number; losses: number }>();
  list.forEach((s) => {
    const o = outcomeOf(s);
    s.trigger.wallets.forEach((w) => {
      const r = byWallet.get(w.address) || { signals: 0, wins: 0, losses: 0 };
      r.signals++;
      if (o === 'win') r.wins++;
      if (o === 'loss') r.losses++;
      byWallet.set(w.address, r);
    });
  });
  const walletRows: WalletReviewRow[] = wallets
    .map((w) => {
      const r = byWallet.get(w.address) || { signals: 0, wins: 0, losses: 0 };
      const known = r.wins + r.losses;
      let suggestion: WalletReviewRow['suggestion'];
      if (known >= MIN_SAMPLE) {
        const rate = r.wins / known;
        if (rate >= 0.6 && w.tier === 'B') suggestion = { tier: 'A', why: `${r.wins}/${known} winners` };
        else if (rate <= 0.25 && w.tier === 'A') suggestion = { tier: 'B', why: `${r.losses}/${known} losers` };
        else if (rate <= 0.25 && w.tier === 'B') suggestion = { remove: true, why: `${r.losses}/${known} losers` };
      }
      return { address: w.address, label: w.label, tier: w.tier, ...r, suggestion };
    })
    .sort((a, b) => b.signals - a.signals || b.wins - a.wins);

  // Gates: where signals stopped, and how many of those turned into 2x anyway.
  const stages: SignalStage[] = ['late', 'safety', 'momentum', 'ai', 'risk', 'execution', 'trigger'];
  const gates = stages
    .map((stage) => {
      const stopped = list.filter((s) => s.status !== 'entered' && s.status !== 'watch' && s.stage === stage);
      return { stage, stopped: stopped.length, missedWinners: stopped.filter((s) => (bestMultiple(s) ?? 0) >= 2).length };
    })
    .filter((g) => g.stopped > 0);

  // AI: does its verdict pick better tokens than the momentum score alone?
  const h6 = (s: ConvergenceSignal) => (s.priceAtSignalUsd > 0 && typeof s.checkpoints.h6 === 'number' ? (s.checkpoints.h6 / s.priceAtSignalUsd - 1) * 100 : null);
  const row = (group: string, items: ConvergenceSignal[]): AiReviewRow => {
    const changes = items.map(h6).filter((v): v is number => v !== null);
    return {
      group,
      n: items.length,
      reached2x: items.filter((s) => (bestMultiple(s) ?? 0) >= 2).length,
      avgH6Pct: changes.length ? Math.round((changes.reduce((a, b) => a + b, 0) / changes.length) * 10) / 10 : null,
    };
  };
  const reviewed = list.filter((s) => s.ai?.available);
  const ai = [
    row(`Momentum ≥ ${cfg.aiScore} (all)`, list.filter((s) => (s.momentum?.score ?? 0) >= cfg.aiScore)),
    row('AI ENTRY', reviewed.filter((s) => s.ai!.verdict === 'ENTRY')),
    row('AI WATCH', reviewed.filter((s) => s.ai!.verdict === 'WATCH')),
    row('AI SKIP', reviewed.filter((s) => s.ai!.verdict === 'SKIP')),
  ];
  const rate = (r: AiReviewRow) => (r.n ? r.reached2x / r.n : 0);
  const aiAddsValue = ai[1].n >= MIN_SAMPLE && ai[0].n >= MIN_SAMPLE ? rate(ai[1]) > rate(ai[0]) : null;

  // Core metrics, one trade per entered signal.
  const closed = list.filter((s) => s.result).sort((a, b) => a.result!.closedAt - b.result!.closedAt);
  const pnls = closed.map((s) => s.result!.pnlUsd);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p <= 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  let peak = 0;
  let equity = 0;
  let maxDd = 0;
  pnls.forEach((p) => {
    equity += p;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  });
  const winRate = pnls.length ? wins.length / pnls.length : 0;
  const avgWin = avg(wins);
  const avgLoss = Math.abs(avg(losses));
  const round = (v: number) => Math.round(v * 100) / 100;

  return {
    from,
    signals: list.length,
    entered: list.filter((s) => s.status === 'entered').length,
    wallets: walletRows,
    gates,
    ai,
    core: {
      trades: pnls.length,
      wins: wins.length,
      winRate: Math.round(winRate * 1000) / 10,
      avgWinUsd: round(avgWin),
      avgLossUsd: round(avgLoss),
      totalPnlUsd: round(pnls.reduce((a, b) => a + b, 0)),
      maxDrawdownUsd: round(maxDd),
      expectancyUsd: round(winRate * avgWin - (1 - winRate) * avgLoss),
    },
    aiAddsValue,
  };
}

/** Journal as CSV, one row per signal. */
export function journalCsv(journal: ConvergenceSignal[]): string {
  const head = [
    'created_at', 'symbol', 'mint', 'status', 'stopped_at', 'reason', 'trigger_points', 'trigger_wallets', 'price_at_signal', 'liquidity_at_signal',
    'safety_passed', 'momentum', 'ai_verdict', 'ai_confidence', 'price_5m', 'price_1h', 'price_6h', 'price_24h', 'entry_usd', 'pnl_usd', 'pnl_pct', 'exit_reasons',
  ];
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = journal.map((s) =>
    [
      new Date(s.createdAt).toISOString(), s.symbol, s.mint, s.status, s.stage, s.reason, s.trigger.points, s.trigger.wallets.map((w) => `${w.label || w.address}:${w.tier}`).join(' '),
      s.priceAtSignalUsd, Math.round(s.liquidityAtSignalUsd), s.safety?.passed ?? '', s.momentum?.score ?? '', s.ai?.verdict ?? '', s.ai?.confidence ?? '',
      s.checkpoints.m5 ?? '', s.checkpoints.h1 ?? '', s.checkpoints.h6 ?? '', s.checkpoints.h24 ?? '', s.entry?.amountUsd ?? '', s.result?.pnlUsd ?? '', s.result?.pnlPercent ?? '',
      s.result?.exitReasons.join(' ') ?? '',
    ].map(esc).join(',')
  );
  return [head.join(','), ...rows].join('\n');
}
