'use client';

import React from 'react';
import { AlertTriangle, Check, Eye, Loader2, Minus, Radio, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useConvergenceLive, useConvergenceStore, PipelineStep } from '@/store/useConvergenceStore';
import { useBotStore } from '@/store/useBotStore';
import { aiModelLabel } from '@/lib/ai-models';
import { timeAgo } from '@/lib/formatters';
import type { ConvergenceSignal } from '@/types/convergence';
import { CoinAvatar } from '../CoinAvatar';
import { seconds, useNow } from '../desk/shared';

type RowState = 'idle' | 'active' | 'done' | 'warn' | 'fail';

const STEPS: { id: PipelineStep; title: string; hint: string }[] = [
  { id: 'trigger', title: '1 · Convergence', hint: 'Smart wallets from different clusters buy the same token' },
  { id: 'safety', title: '2 · Safety (hard gate)', hint: 'Authorities, LP / curve, holders, dev, bundle, sell test' },
  { id: 'momentum', title: '3 · Momentum score', hint: 'Organic interest 0-100: AI from 60, watchlist 40-59' },
  { id: 'ai', title: '4 · AI verdict', hint: 'Claude looks for reasons to reject; ENTRY ≥ confidence trades' },
  { id: 'execution', title: 'Entry', hint: 'Size, risk guards, chase and price-impact checks' },
];

const ORDER: PipelineStep[] = ['trigger', 'safety', 'momentum', 'ai', 'execution'];
const STAGE_TO_STEP: Record<string, PipelineStep> = { trigger: 'trigger', late: 'trigger', safety: 'safety', momentum: 'momentum', ai: 'ai', risk: 'execution', execution: 'execution' };

const Node: React.FC<{ state: RowState }> = ({ state }) => {
  const base = 'grid place-items-center w-5 h-5 rounded-full border shrink-0 bg-ink-900';
  if (state === 'active') return <span className={`${base} border-signal/50 text-signal`}><Loader2 className="w-3 h-3 animate-spin" /></span>;
  if (state === 'done') return <span className={`${base} border-pos/40 text-pos`}><Check className="w-3 h-3" /></span>;
  if (state === 'warn') return <span className={`${base} border-warn/40 text-warn`}><Minus className="w-3 h-3" /></span>;
  if (state === 'fail') return <span className={`${base} border-neg/40 text-neg`}><X className="w-3 h-3" /></span>;
  return <span className={`${base} border-line-strong`}><span className="w-1.5 h-1.5 rounded-full bg-ink-600" /></span>;
};

/** State of each pipeline row for one signal. */
function rowStates(sig: ConvergenceSignal | undefined, active: PipelineStep | undefined): Record<PipelineStep, RowState> {
  const out: Record<PipelineStep, RowState> = { trigger: 'idle', safety: 'idle', momentum: 'idle', ai: 'idle', execution: 'idle' };
  if (!sig) return out;
  if (active) {
    const i = ORDER.indexOf(active);
    ORDER.forEach((st, j) => (out[st] = j < i ? 'done' : j === i ? 'active' : 'idle'));
    return out;
  }
  const stop = STAGE_TO_STEP[sig.stage] || 'trigger';
  const i = ORDER.indexOf(stop);
  ORDER.forEach((st, j) => {
    if (j < i) out[st] = 'done';
    else if (j === i) out[st] = sig.status === 'entered' ? 'done' : sig.status === 'watch' ? 'warn' : sig.status === 'evaluating' ? 'active' : 'fail';
  });
  return out;
}

function stepValue(sig: ConvergenceSignal | undefined, step: PipelineStep): string | undefined {
  if (!sig) return undefined;
  if (step === 'trigger') return `${sig.trigger.points} pts`;
  if (step === 'safety' && sig.safety) return sig.safety.passed ? 'pass' : 'fail';
  if (step === 'momentum' && sig.momentum) return `${sig.momentum.score}/100`;
  if (step === 'ai' && sig.ai) return sig.ai.available ? `${sig.ai.verdict} ${sig.ai.confidence}%` : 'n/a';
  if (step === 'execution' && sig.status === 'entered') return 'Filled';
  return undefined;
}

/** The convergence flow, live: monitor health, the four gates for the latest signal, tokens building points. */
export const ConvergencePanel: React.FC = () => {
  const now = useNow(1000);
  const { monitor, progress, candidates, feed } = useConvergenceLive(
    useShallow((s) => ({ monitor: s.monitor, progress: s.progress, candidates: s.candidates, feed: s.feed }))
  );
  const { journal, wallets, monitorOn, setMonitorOn, config } = useConvergenceStore(
    useShallow((s) => ({
      journal: s.journal,
      wallets: s.wallets,
      monitorOn: s.monitorOn,
      setMonitorOn: s.setMonitorOn,
      config: s.config,
    }))
  );
  const { running, strategy, aiModel } = useBotStore(useShallow((s) => ({ running: s.settings.scannerAutoBuy, strategy: s.settings.entryStrategy, aiModel: s.settings.aiModel })));

  const activeId = Object.keys(progress)[0];
  const focus = (activeId && journal.find((j) => j.id === activeId)) || journal.find((j) => j.status === 'evaluating' || j.status === 'watch') || journal[0];
  const states = rowStates(focus, focus ? progress[focus.id]?.step : undefined);
  const watching = journal.filter((j) => j.status === 'watch');
  const counted = wallets.filter((w) => w.active).length;
  const live = monitor?.running;

  return (
    <section className="panel p-4 flex flex-col min-w-0">
      <header className="flex items-center gap-2">
        <Radio className="w-4 h-4 text-slate-500" />
        <h3 className="text-[13px] font-bold text-white">Convergence pipeline</h3>
        <span className="ml-auto text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
          <span className={`dot ${live ? 'dot-live' : 'dot-idle'}`} />
          {live ? `${monitor!.wallets} wallets · ${monitor!.cycleSeconds}s cycle` : 'Monitor off'}
        </span>
      </header>

      <ol className="mt-3">
        {STEPS.map((st, i) => {
          const state = states[st.id];
          const value = stepValue(focus, st.id);
          return (
            <li key={st.id} className="relative flex gap-3 pb-3 last:pb-0">
              {i < STEPS.length - 1 && <span aria-hidden="true" className={`absolute left-[9.5px] top-5 bottom-0 w-px ${state === 'done' ? 'bg-pos/30' : 'bg-line'}`} />}
              <Node state={state} />
              <div className="min-w-0 flex-1 -mt-0.5">
                <div className="flex items-baseline gap-2">
                  <span className={`text-[13px] font-semibold ${state === 'idle' ? 'text-slate-400' : 'text-white'}`}>{st.title}</span>
                  {value && (
                    <span className={`ml-auto text-[11px] font-mono font-semibold whitespace-nowrap ${state === 'fail' ? 'text-neg' : state === 'warn' ? 'text-warn' : state === 'active' ? 'text-signal' : 'text-white'}`}>
                      {value}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 truncate">{st.hint}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {focus && (
        <div className="panel-2 p-3 mt-3 animate-fade-up">
          <div className="flex items-center gap-2.5 min-w-0">
            <CoinAvatar imageUrl={focus.imageUrl} symbol={focus.symbol} chainId="solana" size="sm" showChain={false} />
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-white truncate">${focus.symbol}</p>
              <p className="text-[11px] text-slate-500 truncate">
                {focus.trigger.wallets.length} wallets · {timeAgo(focus.createdAt)}
                {progress[focus.id] ? ` · ${progress[focus.id].step} ${seconds(now - progress[focus.id].startedAt)}` : ''}
              </p>
            </div>
            <span
              className={`ml-auto shrink-0 chip ${
                focus.status === 'entered' ? 'chip-pos' : focus.status === 'watch' ? 'chip-warn' : focus.status === 'evaluating' ? 'chip-accent' : 'chip-neg'
              }`}
            >
              {focus.status}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2 leading-relaxed line-clamp-3">{focus.reason}</p>
        </div>
      )}

      <div className="mt-3">
        <p className="text-[11px] font-semibold text-slate-400 mb-1.5">Building points (need {config.triggerPoints} in {config.windowMinutes} min)</p>
        {candidates.length === 0 ? (
          <p className="text-[11px] text-slate-600">{live ? 'No tracked wallet bought anything in the window yet.' : 'Start the monitor to see tokens building points.'}</p>
        ) : (
          <ul className="space-y-1">
            {candidates.slice(0, 5).map((c) => (
              <li key={c.mint} className="flex items-center gap-2 text-[11px]">
                <span className="font-mono text-slate-300 truncate w-24 shrink-0">{c.mint.slice(0, 4)}…{c.mint.slice(-4)}</span>
                <span className="flex-1 h-1 rounded-full bg-ink-800 overflow-hidden" role="presentation">
                  <span className={`block h-full ${c.points >= config.triggerPoints ? 'bg-pos' : 'bg-signal/60'}`} style={{ width: `${Math.min(100, (c.points / config.triggerPoints) * 100)}%` }} />
                </span>
                <span className="font-mono text-white shrink-0">
                  {c.points}/{config.triggerPoints}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {feed.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold text-slate-400 mb-1.5">Wallet activity</p>
          <ul className="space-y-0.5">
            {feed.slice(0, 5).map((f) => (
              <li key={f.swap.signature} className="flex items-center gap-1.5 text-[11px] min-w-0">
                <span className={f.swap.side === 'buy' ? 'text-pos font-semibold w-7 shrink-0' : 'text-neg font-semibold w-7 shrink-0'}>{f.swap.side === 'buy' ? 'BUY' : 'SELL'}</span>
                <span className="text-slate-300 truncate">
                  {f.label}
                  {f.tier ? ` (${f.tier})` : f.dev ? ' (dev)' : ''}
                </span>
                <span className="text-slate-500 font-mono shrink-0 ml-auto">
                  {f.swap.solAmount.toFixed(2)} SOL · {f.swap.mint.slice(0, 4)}…
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="mt-3 pt-3 border-t border-line space-y-1.5 text-[11px] text-slate-500">
        <p className="flex items-center gap-1.5">
          <Eye className="w-3.5 h-3.5 shrink-0" />
          {watching.length} on the watchlist · {counted} wallets counting
          <button type="button" className="btn btn-sm btn-ghost ml-auto -my-1" onClick={() => setMonitorOn(!monitorOn)} title="Record signals even while auto trade is off">
            {monitorOn ? 'Observe: on' : 'Observe: off'}
          </button>
        </p>
        <p className="truncate">
          {running && strategy !== 'setups' ? 'Auto trade buys ENTRY signals' : 'Auto trade off for this flow - signals are recorded only'} · {aiModelLabel(aiModel)}
        </p>
        {monitor?.lastError && monitor.errors > 0 && (
          <p className="text-warn flex items-start gap-1.5" title={monitor.lastError}>
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            RPC: {monitor.errors} errors - {monitor.lastError.slice(0, 80)}. A private RPC (Settings) helps.
          </p>
        )}
      </footer>
    </section>
  );
};
