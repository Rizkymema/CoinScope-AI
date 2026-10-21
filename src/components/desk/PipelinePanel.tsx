'use client';

import React from 'react';
import { AlertTriangle, Check, Loader2, Minus, Radar, Rocket, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useScannerStore, EntryReview, StageState } from '@/store/useScannerStore';
import { useBotStore } from '@/store/useBotStore';
import { aiModelLabel } from '@/lib/ai-models';
import { CoinAvatar } from '../CoinAvatar';
import { clock, seconds, useNow } from './shared';

type RowState = 'idle' | 'active' | 'done' | 'warn' | 'fail' | 'off';

interface Row {
  id: string;
  title: string;
  hint: string;
  state: RowState;
  value?: string;
  detail?: string;
  /** 0-1 share of the discovered tokens still in the funnel. */
  share?: number;
}

const SETUP_LABEL: Record<string, string> = {
  breakout: 'Breakout retest',
  flag: 'Flag',
  pullback: 'Pullback',
  momentum: 'Momentum',
  rebound: 'RSI rebound',
  launch: 'Launch dip',
};

const Node: React.FC<{ state: RowState }> = ({ state }) => {
  const base = 'grid place-items-center w-5 h-5 rounded-full border shrink-0 bg-ink-900';
  if (state === 'active') return <span className={`${base} border-signal/50 text-signal`}><Loader2 className="w-3 h-3 animate-spin" /></span>;
  if (state === 'done') return <span className={`${base} border-pos/40 text-pos`}><Check className="w-3 h-3" /></span>;
  if (state === 'warn') return <span className={`${base} border-warn/40 text-warn`}><Minus className="w-3 h-3" /></span>;
  if (state === 'fail') return <span className={`${base} border-neg/40 text-neg`}><X className="w-3 h-3" /></span>;
  return <span className={`${base} border-line-strong`}><span className="w-1.5 h-1.5 rounded-full bg-ink-600" /></span>;
};

const valueTone: Record<RowState, string> = {
  idle: 'text-slate-600',
  off: 'text-slate-600',
  active: 'text-signal',
  done: 'text-white',
  warn: 'text-warn',
  fail: 'text-neg',
};

function scanRow(st: StageState | undefined, scanning: boolean): RowState {
  if (!st || st.state === 'idle') return 'idle';
  if (st.state === 'active') return scanning ? 'active' : 'idle';
  return 'done';
}

function reviewRows(review: EntryReview | null, aiOn: boolean, now: number): [Row, Row] {
  const reviewRow: Row = { id: 'review', title: 'Claude review', hint: 'Checks the signal against the entry rules', state: aiOn ? 'idle' : 'off', value: aiOn ? undefined : 'Off' };
  const entryRow: Row = { id: 'entry', title: 'Entry', hint: 'Buy with the signal’s stop and target', state: 'idle' };
  // A finished review stays on screen for 10 minutes, then the rows go back to waiting.
  if (!review || (review.phase === 'done' && now - (review.endedAt || review.startedAt) > 10 * 60_000)) return [reviewRow, entryRow];
  const sym = `$${review.signal.coin.symbol}`;

  if (aiOn) {
    if (review.phase === 'review') Object.assign(reviewRow, { state: 'active', value: seconds(now - review.startedAt), detail: `Reviewing ${sym}` });
    else if (review.confidence !== undefined) {
      const skipped = review.outcome === 'skipped' && review.phase === 'done';
      Object.assign(reviewRow, { state: skipped ? 'warn' : 'done', value: `${skipped ? 'SKIP' : 'BUY'} ${review.confidence}%`, detail: sym });
    } else if (review.outcome === 'held') Object.assign(reviewRow, { state: 'warn', value: 'Held', detail: review.detail });
    else Object.assign(reviewRow, { state: 'done', value: 'Scanner only', detail: sym });
  }

  if (review.phase === 'entry') Object.assign(entryRow, { state: 'active', value: seconds(now - review.startedAt), detail: `Buying ${sym}` });
  else if (review.outcome === 'bought') Object.assign(entryRow, { state: 'done', value: 'Filled', detail: sym });
  else if (review.outcome === 'failed') Object.assign(entryRow, { state: 'fail', value: 'Failed', detail: review.detail });
  else if (review.outcome === 'skipped' && review.confidence === undefined) Object.assign(entryRow, { state: 'warn', value: 'Skipped', detail: review.detail });
  else if (review.outcome === 'held' && !aiOn) Object.assign(entryRow, { state: 'warn', value: 'Held', detail: review.detail });
  return [reviewRow, entryRow];
}

/**
 * The bot's pipeline, live: each market scan stage with how many tokens survived it, then the
 * Claude review and the entry of the current candidate.
 */
export const PipelinePanel: React.FC = () => {
  const now = useNow(1000);
  const { cycle, scanning, nextScanAt, review, enabled, launchWatched, error } = useScannerStore(
    useShallow((s) => ({
      cycle: s.cycle,
      scanning: s.scanning,
      nextScanAt: s.nextScanAt,
      review: s.review,
      enabled: s.enabled,
      launchWatched: s.launchWatched,
      error: s.error,
    }))
  );
  const { aiOn, aiModel, scanLaunches, running } = useBotStore(
    useShallow((s) => ({ aiOn: s.settings.aiGateEnabled, aiModel: s.settings.aiModel, scanLaunches: s.settings.scanLaunches, running: s.settings.scannerAutoBuy }))
  );

  const st = cycle?.stages;
  const discovered = st?.discover.count || 0;
  const share = (n?: number) => (discovered > 0 && n !== undefined ? Math.max(0.02, Math.log10(1 + n) / Math.log10(1 + discovered)) : undefined);
  const count = (s: StageState | undefined, unit: string) => (s && s.count !== undefined ? `${s.count} ${unit}` : undefined);

  const rows: Row[] = [
    { id: 'discover', title: 'Discover', hint: 'Trending, new and top-volume Solana pools', state: scanRow(st?.discover, scanning), value: count(st?.discover, 'tokens'), share: discovered ? 1 : undefined },
    { id: 'filter', title: 'Filter', hint: 'Depth, age, volume, clones', state: scanRow(st?.filter, scanning), value: count(st?.filter, 'pass'), share: share(st?.filter.count) },
    { id: 'safety', title: 'Safety', hint: 'RugCheck: authorities, holders, insiders, dev', state: scanRow(st?.safety, scanning), value: count(st?.safety, 'pass'), detail: st?.safety.state === 'active' ? st.safety.detail : undefined, share: share(st?.safety.count) },
    { id: 'setup', title: 'Chart setup', hint: 'Retest, flag, rebound, pullback, momentum', state: scanRow(st?.setup, scanning), value: count(st?.setup, 'setups'), detail: st?.setup.state === 'active' ? `charting ${st.setup.detail}` : undefined, share: share(st?.setup.count) },
    { id: 'sellback', title: 'Sell-back test', hint: 'Jupiter round trip, reward over risk after fees', state: scanRow(st?.sellback, scanning), value: count(st?.sellback, 'ready'), detail: st?.sellback.state === 'active' ? `quoting ${st.sellback.detail}` : undefined, share: share(st?.sellback.count) },
    ...reviewRows(review, aiOn, now),
  ];

  const cycleMs = 60_000;
  const untilNext = nextScanAt ? nextScanAt - now : null;
  const waitShare = untilNext !== null ? Math.max(0, Math.min(1, 1 - untilNext / cycleMs)) : scanning ? 1 : 0;

  return (
    <section className="panel p-4 flex flex-col min-w-0">
      <header className="flex items-center gap-2">
        <Radar className="w-4 h-4 text-slate-500" />
        <h3 className="text-[13px] font-bold text-white">Pipeline</h3>
        {cycle && <span className="text-[11px] text-slate-500">scan #{cycle.n}</span>}
        <span className="ml-auto text-[11px] font-mono text-slate-400">
          {!enabled ? 'Scanner paused' : scanning && cycle ? `Scanning ${seconds(now - cycle.startedAt)}` : untilNext !== null ? `Next scan ${clock(untilNext)}` : 'Starting…'}
        </span>
      </header>
      <div className="h-0.5 rounded-full bg-ink-800 mt-2.5 overflow-hidden" role="presentation">
        <div className={`h-full ${scanning ? 'bg-signal' : 'bg-ink-600'} transition-[width] duration-1000 ease-linear`} style={{ width: `${waitShare * 100}%` }} />
      </div>

      <ol className="mt-3 flex-1">
        {rows.map((r, i) => (
          <li key={r.id} className="relative flex gap-3 pb-3 last:pb-0">
            {i < rows.length - 1 && <span aria-hidden="true" className={`absolute left-[9.5px] top-5 bottom-0 w-px ${r.state === 'done' ? 'bg-pos/30' : 'bg-line'}`} />}
            <Node state={r.state} />
            <div className="min-w-0 flex-1 -mt-0.5">
              <div className="flex items-baseline gap-2">
                <span className={`text-[13px] font-semibold ${r.state === 'idle' || r.state === 'off' ? 'text-slate-400' : 'text-white'}`}>{r.title}</span>
                {r.value && <span className={`ml-auto text-[11px] font-mono font-semibold whitespace-nowrap ${valueTone[r.state]}`}>{r.value}</span>}
              </div>
              <p className="text-[11px] text-slate-500 truncate" title={r.detail || r.hint}>
                {r.detail || r.hint}
              </p>
              {r.share !== undefined && (
                <div className="h-0.5 mt-1.5 rounded-full bg-ink-800 overflow-hidden" role="presentation">
                  <div className="h-full bg-pos/50 transition-[width] duration-200" style={{ width: `${r.share * 100}%` }} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      {review && (review.phase !== 'done' || now - (review.endedAt || 0) < 10 * 60_000) && <Candidate review={review} now={now} />}

      <footer className="mt-3 pt-3 border-t border-line space-y-1.5 text-[11px] text-slate-500">
        <p className="flex items-center gap-1.5">
          <Rocket className="w-3.5 h-3.5 shrink-0" />
          {scanLaunches && enabled ? `Launch watcher · ${launchWatched} new Pump.fun launches followed, checked every 10 s` : 'Launch watcher off'}
        </p>
        <p className="truncate">
          {running ? 'Auto trade on' : 'Auto trade off - signals are listed, nothing is bought'} · {aiOn ? aiModelLabel(aiModel) : 'AI review off'}
        </p>
        {error && (
          <p className="text-warn flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            {error}
          </p>
        )}
      </footer>
    </section>
  );
};

const OUTCOME: Record<NonNullable<EntryReview['outcome']>, { label: string; chip: string }> = {
  bought: { label: 'Bought', chip: 'chip chip-pos' },
  skipped: { label: 'Skipped', chip: 'chip chip-warn' },
  held: { label: 'Held', chip: 'chip chip-warn' },
  failed: { label: 'Failed', chip: 'chip chip-neg' },
};

/** The token the auto-buy is working on, with the numbers Claude sees. */
const Candidate: React.FC<{ review: EntryReview; now: number }> = ({ review, now }) => {
  const s = review.signal;
  const status = review.phase === 'done' && review.outcome ? OUTCOME[review.outcome] : { label: review.phase === 'review' ? 'Reviewing' : 'Buying', chip: 'chip chip-accent' };
  return (
    <div className="panel-2 p-3 mt-3 animate-fade-up">
      <div className="flex items-center gap-2.5 min-w-0">
        <CoinAvatar imageUrl={s.coin.imageUrl} symbol={s.coin.symbol} chainId={s.coin.chainId} size="sm" showChain={false} />
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-white truncate">${s.coin.symbol}</p>
          <p className="text-[11px] text-slate-500 truncate">
            {review.source === 'launch' ? 'Launch watcher' : 'Scanner'} · {SETUP_LABEL[s.setup || ''] || s.setup} · {review.phase === 'done' ? `${seconds((review.endedAt || now) - review.startedAt)} total` : seconds(now - review.startedAt)}
          </p>
        </div>
        <span className={`${status.chip} ml-auto shrink-0`}>{status.label}</span>
      </div>
      <dl className="grid grid-cols-4 gap-2 mt-2.5 text-[11px]">
        <div>
          <dt className="text-slate-500">Score</dt>
          <dd className="font-mono text-white font-semibold">{s.score?.total ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Stop</dt>
          <dd className="font-mono text-neg font-semibold">−{(s.slPercent ?? 0).toFixed(1)}%</dd>
        </div>
        <div>
          <dt className="text-slate-500">Target</dt>
          <dd className="font-mono text-pos font-semibold">+{(s.tpPercent ?? 0).toFixed(1)}%</dd>
        </div>
        <div>
          <dt className="text-slate-500">R:R net</dt>
          <dd className="font-mono text-white font-semibold">{s.netRewardRisk !== undefined ? s.netRewardRisk.toFixed(1) : '—'}</dd>
        </div>
      </dl>
      {review.detail && <p className="text-[11px] text-slate-400 mt-2 leading-relaxed line-clamp-3">{review.detail}</p>}
    </div>
  );
};
