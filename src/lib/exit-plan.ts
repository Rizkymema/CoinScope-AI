/**
 * Stage 6 of the convergence flow: automatic exits, no manual confirmation.
 *
 *   take profit   tp1 (2x): sell 50% of the position, the capital is back
 *                 tp2 (5x): sell another 25% of the original position
 *   moonbag       the last 25% rides with a trailing stop 40% under the high since entry
 *   stop loss     35% under the entry: sell everything
 *   time stop     60 minutes without ever touching +30%: sell everything
 *   emergency     handled by the convergence store (trigger wallets / dev selling, liquidity drop)
 *
 * Pure functions: the bot store calls them on every price tick.
 */
import type { BotPosition, BotTradeHistory } from '../types/bot';
import type { ConvergenceConfig, ExitPlan } from '../types/convergence';

type ExitReason = BotTradeHistory['exitReason'];

export interface PlanDecision {
  action: 'none' | 'partial' | 'all';
  /** Share of the CURRENT holding to sell, in %. */
  percent?: number;
  reason?: ExitReason;
  stage?: 'tp1' | 'tp2';
  note?: string;
}

type PlanPosition = Pick<BotPosition, 'buyPriceUsd' | 'highPriceUsd' | 'boughtAt'> & { exitPlan: ExitPlan };

export function buildExitPlan(cfg: ConvergenceConfig, extra: Pick<ExitPlan, 'signalId' | 'triggerWallets' | 'devWallet' | 'entryLiquidityUsd' | 'entryDexId'>): ExitPlan {
  return {
    kind: 'convergence',
    tp1Multiple: cfg.tp1Multiple,
    tp1SellPct: cfg.tp1SellPct,
    tp1Done: false,
    tp2Multiple: cfg.tp2Multiple,
    tp2SellPct: cfg.tp2SellPct,
    tp2Done: false,
    moonbagTrailPct: cfg.moonbagTrailPct,
    stopLossPct: cfg.stopLossPct,
    timeStopMinutes: cfg.timeStopMinutes,
    timeStopMinGainPct: cfg.timeStopMinGainPct,
    emergencyLiquidityDropPct: cfg.emergencyLiquidityDropPct,
    emergencyTriggerSellers: cfg.emergencyTriggerSellers,
    emergencySellFraction: cfg.emergencySellFraction,
    exitedWallets: [],
    ...extra,
  };
}

/** What the plan does at `price`. Stops are checked before targets, targets before the trail. */
export function planExit(pos: PlanPosition, price: number, now: number): PlanDecision {
  const p = pos.exitPlan;
  const entry = pos.buyPriceUsd;
  if (!(entry > 0)) return { action: 'none' };
  // An emergency (trigger wallets or dev selling, liquidity gone) closes everything, retried until done.
  if (p.emergency) return { action: 'all', reason: 'EMERGENCY_EXIT', note: p.emergency };
  if (!(price > 0)) return { action: 'none' };
  const high = Math.max(pos.highPriceUsd, price);

  if (price <= entry * (1 - p.stopLossPct / 100)) {
    return { action: 'all', reason: 'SL_HIT', note: `${p.stopLossPct}% under the entry` };
  }
  if (!p.tp1Done && price >= entry * p.tp1Multiple) {
    return { action: 'partial', percent: p.tp1SellPct, reason: 'PARTIAL_TP', stage: 'tp1', note: `${p.tp1Multiple}x: sell ${p.tp1SellPct}% (capital back)` };
  }
  if (p.tp1Done && !p.tp2Done && price >= entry * p.tp2Multiple) {
    // tp2SellPct is a share of the ORIGINAL position; what is left after tp1 is (100 - tp1SellPct)%.
    const left = 100 - p.tp1SellPct;
    // Whole percent: the live sell rounds to one as well.
    const percent = left > 0 ? Math.min(100, Math.max(1, Math.round((p.tp2SellPct / left) * 100))) : 100;
    return { action: 'partial', percent, reason: 'PARTIAL_TP', stage: 'tp2', note: `${p.tp2Multiple}x: sell ${p.tp2SellPct}% of the original position` };
  }
  if (p.tp2Done && price <= high * (1 - p.moonbagTrailPct / 100)) {
    return { action: 'all', reason: 'TRAILING_STOP', note: `moonbag ${p.moonbagTrailPct}% under its high` };
  }
  if (now - pos.boughtAt >= p.timeStopMinutes * 60_000 && high < entry * (1 + p.timeStopMinGainPct / 100)) {
    return { action: 'all', reason: 'TIME_STOP', note: `${p.timeStopMinutes} min without touching +${p.timeStopMinGainPct}%` };
  }
  return { action: 'none' };
}

/** Stop and next target shown on the position card and the chart. */
export function planLevels(pos: PlanPosition, price: number): { tpPriceUsd: number; slPriceUsd: number } {
  const p = pos.exitPlan;
  const entry = pos.buyPriceUsd;
  const high = Math.max(pos.highPriceUsd, price);
  const stop = entry * (1 - p.stopLossPct / 100);
  if (p.tp2Done) return { tpPriceUsd: high, slPriceUsd: Math.max(stop, high * (1 - p.moonbagTrailPct / 100)) };
  return { tpPriceUsd: entry * (p.tp1Done ? p.tp2Multiple : p.tp1Multiple), slPriceUsd: stop };
}

/** Short label of the plan's current stage. */
export function planStage(p: ExitPlan): string {
  if (p.tp2Done) return `Moonbag · trail ${p.moonbagTrailPct}%`;
  if (p.tp1Done) return `Next ${p.tp2Multiple}x · sell ${p.tp2SellPct}% of original`;
  return `Next ${p.tp1Multiple}x · sell ${p.tp1SellPct}%`;
}
