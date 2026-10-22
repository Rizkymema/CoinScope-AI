'use client';

import React, { useMemo, useState } from 'react';
import { BookOpen, ChevronDown, Download, ExternalLink, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useConvergenceStore, CHECKPOINTS } from '@/store/useConvergenceStore';
import { buildReview, journalCsv, outcomeOf } from '@/lib/convergence-review';
import { formatNumber, formatPrice, timeAgo } from '@/lib/formatters';
import type { ConvergenceSignal } from '@/types/convergence';
import { CoinAvatar } from '../CoinAvatar';

const STATUS_CHIP: Record<ConvergenceSignal['status'], string> = {
  evaluating: 'chip chip-accent',
  watch: 'chip chip-warn',
  entered: 'chip chip-pos',
  rejected: 'chip',
  expired: 'chip',
  failed: 'chip chip-neg',
};

const STAGE_LABEL: Record<string, string> = {
  trigger: 'Convergence',
  late: 'Too late',
  safety: 'Safety',
  momentum: 'Momentum',
  ai: 'AI',
  risk: 'Risk guards',
  execution: 'Execution',
};

const EXIT_LABEL: Record<string, string> = {
  PARTIAL_TP: 'take profit (part)',
  TP_HIT: 'take profit',
  SL_HIT: 'stop loss',
  TRAILING_STOP: 'moonbag trail',
  TIME_STOP: 'time stop',
  EMERGENCY_EXIT: 'emergency exit',
  MANUAL_SELL: 'manual',
  PROFIT_LOCK: 'profit lock',
  AI_SELL: 'AI',
};

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

function multiple(sig: ConvergenceSignal, price?: number | null): string {
  if (price === undefined) return '·';
  if (price === null || !(sig.priceAtSignalUsd > 0)) return '—';
  const m = price / sig.priceAtSignalUsd;
  return `${m.toFixed(m >= 10 ? 0 : 2)}x`;
}

const SignalRow: React.FC<{ sig: ConvergenceSignal }> = ({ sig }) => {
  const [open, setOpen] = useState(false);
  const outcome = outcomeOf(sig);
  return (
    <li className="row py-2.5">
      <button type="button" className="w-full text-left flex items-center gap-2.5 min-w-0" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <CoinAvatar imageUrl={sig.imageUrl} symbol={sig.symbol} chainId="solana" size="sm" showChain={false} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[13px] font-bold text-white">${sig.symbol}</span>
            <span className={STATUS_CHIP[sig.status]}>{sig.status === 'entered' ? 'Entered' : sig.status === 'watch' ? 'Watchlist' : `${sig.status} · ${STAGE_LABEL[sig.stage] || sig.stage}`}</span>
            {sig.momentum && <span className="chip">M {sig.momentum.score}</span>}
            {sig.ai?.available && <span className={`chip ${sig.ai.verdict === 'ENTRY' ? 'chip-pos' : sig.ai.verdict === 'WATCH' ? 'chip-warn' : ''}`}>AI {sig.ai.verdict} {sig.ai.confidence}%</span>}
            {sig.result && (
              <span className={`chip ${sig.result.pnlUsd > 0 ? 'chip-pos' : 'chip-neg'}`}>
                {sig.result.pnlUsd >= 0 ? '+' : '−'}${Math.abs(sig.result.pnlUsd).toFixed(2)}
              </span>
            )}
            {!sig.result && outcome === 'win' && sig.status !== 'entered' && <span className="chip chip-accent">missed 2x</span>}
          </div>
          <p className="text-[11px] text-slate-500 truncate">
            {timeAgo(sig.createdAt)} · {sig.trigger.points} pts from {sig.trigger.wallets.length} wallets · {sig.reason}
          </p>
        </div>
        <span className="hidden md:flex items-center gap-2 text-[11px] font-mono text-slate-400 shrink-0">
          {CHECKPOINTS.map((c) => (
            <span key={c.key} title={`Price ${c.label} after the signal vs the signal price`}>
              <span className="text-slate-600">{c.label} </span>
              {multiple(sig, sig.checkpoints[c.key])}
            </span>
          ))}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-2.5 panel-2 p-3 grid grid-cols-1 lg:grid-cols-2 gap-4 text-[11px] animate-fade-up">
          <div className="space-y-2">
            <p className="text-slate-400 font-semibold">1 · Trigger wallets</p>
            <ul className="space-y-0.5">
              {sig.trigger.wallets.map((w) => (
                <li key={w.address} className="flex gap-2">
                  <span className="text-white w-28 truncate">{w.label || short(w.address)}</span>
                  <span className="text-slate-500">
                    tier {w.tier} · {w.points} pt · {w.solAmount.toFixed(2)} SOL @ {formatPrice(w.priceUsd)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-slate-500">
              Signal price {formatPrice(sig.priceAtSignalUsd)} · liquidity {formatNumber(sig.liquidityAtSignalUsd)} · MC {formatNumber(sig.marketCapAtSignalUsd)}
            </p>
            {sig.safety && (
              <>
                <p className="text-slate-400 font-semibold pt-1">2 · Safety {sig.safety.passed ? '(passed)' : '(failed)'}</p>
                <ul className="space-y-0.5">
                  {sig.safety.checks.map((c) => (
                    <li key={c.key} className="flex gap-2">
                      <span className={`w-9 shrink-0 font-semibold ${c.state === 'pass' ? 'text-pos' : c.state === 'fail' ? 'text-neg' : 'text-slate-500'}`}>{c.state === 'unknown' ? '?' : c.state.toUpperCase()}</span>
                      <span className="text-slate-400 truncate">{c.label}</span>
                      <span className="ml-auto font-mono text-slate-200 text-right">{c.value}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="space-y-2">
            {sig.momentum && (
              <>
                <p className="text-slate-400 font-semibold">3 · Momentum {sig.momentum.score}/100{sig.momentum.washTrading ? ' - wash trading' : ''}</p>
                <ul className="space-y-0.5">
                  {sig.momentum.metrics.map((m) => (
                    <li key={m.key} className="flex gap-2">
                      <span className="font-mono text-white w-12 shrink-0">
                        {m.points}/{m.weight}
                      </span>
                      <span className="text-slate-400 shrink-0">{m.label}</span>
                      <span className="ml-auto text-slate-300 text-right truncate">{m.value}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {sig.redFlags.length > 0 && <p className="text-neg">Red flags: {sig.redFlags.join('; ')}</p>}
            {sig.ai && (
              <>
                <p className="text-slate-400 font-semibold pt-1">
                  4 · AI {sig.ai.available ? `${sig.ai.verdict} ${sig.ai.confidence}%` : 'unavailable'} {sig.ai.model ? `· ${sig.ai.model}` : ''}
                </p>
                {sig.ai.alasan.length > 0 && <p className="text-slate-300">Reasons: {sig.ai.alasan.join(' · ')}</p>}
                {sig.ai.red_flags.length > 0 && <p className="text-neg">Red flags: {sig.ai.red_flags.join(' · ')}</p>}
                {sig.ai.syarat_naik_ke_entry && <p className="text-warn">To reach ENTRY: {sig.ai.syarat_naik_ke_entry}</p>}
                {sig.ai.data_kurang.length > 0 && <p className="text-slate-500">Missing data: {sig.ai.data_kurang.join(' · ')}</p>}
                {!sig.ai.available && sig.ai.note && <p className="text-slate-500">{sig.ai.note}</p>}
              </>
            )}
            {sig.entry && (
              <p className="text-slate-300 pt-1">
                Entry ${sig.entry.amountUsd.toFixed(2)} @ {formatPrice(sig.entry.priceUsd)} ({sig.entry.isLive ? 'live' : 'paper'})
                {sig.result
                  ? ` · result ${sig.result.pnlUsd >= 0 ? '+' : '−'}$${Math.abs(sig.result.pnlUsd).toFixed(2)} (${sig.result.pnlPercent}%) · ${sig.result.exitReasons.map((r) => EXIT_LABEL[r] || r).join(', ')}`
                  : ' · open'}
              </p>
            )}
            <a href={`https://dexscreener.com/solana/${sig.mint}`} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost">
              DexScreener
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      )}
    </li>
  );
};

const Stat: React.FC<{ label: string; value: string; tone?: string }> = ({ label, value, tone = 'text-white' }) => (
  <div className="panel-2 px-3 py-2.5 min-w-0">
    <p className="text-[11px] text-slate-500 truncate">{label}</p>
    <p className={`text-[15px] font-mono font-bold ${tone}`}>{value}</p>
  </div>
);

const money = (v: number) => `${v >= 0 ? '+' : '−'}$${Math.abs(v).toFixed(2)}`;

/** Stage 7: the weekly review - wallets, gates, the AI's value and the core metrics. */
const WeeklyReview: React.FC<{ days: number }> = ({ days }) => {
  const { journal, wallets, config, updateWallet, removeWallet } = useConvergenceStore(
    useShallow((s) => ({ journal: s.journal, wallets: s.wallets, config: s.config, updateWallet: s.updateWallet, removeWallet: s.removeWallet }))
  );
  const review = useMemo(() => buildReview(journal, wallets, config, Date.now() - days * 86_400_000), [journal, wallets, config, days]);
  const c = review.core;
  const suggestions = review.wallets.filter((w) => w.suggestion);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Stat label="Signals / entered" value={`${review.signals} / ${review.entered}`} />
        <Stat label="Win rate (closed)" value={c.trades ? `${c.winRate}%` : '—'} />
        <Stat label="Avg win / avg loss" value={c.trades ? `$${c.avgWinUsd} / $${c.avgLossUsd}` : '—'} />
        <Stat label="Max drawdown" value={c.trades ? `$${c.maxDrawdownUsd}` : '—'} tone={c.maxDrawdownUsd > 0 ? 'text-neg' : 'text-white'} />
        <Stat label="Realized P&L" value={c.trades ? money(c.totalPnlUsd) : '—'} tone={c.totalPnlUsd >= 0 ? 'text-pos' : 'text-neg'} />
        <Stat label="Expectancy / trade" value={c.trades ? money(c.expectancyUsd) : '—'} tone={c.expectancyUsd > 0 ? 'text-pos' : 'text-neg'} />
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Expectancy = (win rate × average win) − (loss rate × average loss). Fees and slippage are already inside each trade&apos;s P&amp;L. Run it with real money
        only once this stays positive over 2-4 weeks or 100 signals of paper trading{c.trades ? ` (now ${c.trades} closed trades)` : ''}.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-white mb-1.5">Wallets</p>
          {review.wallets.filter((w) => w.signals > 0).length === 0 ? (
            <p className="text-[11px] text-slate-500">No signal in this period yet.</p>
          ) : (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-slate-500 text-left">
                  <th className="font-normal py-1">Wallet</th>
                  <th className="font-normal">Signals</th>
                  <th className="font-normal">Win / loss</th>
                </tr>
              </thead>
              <tbody>
                {review.wallets
                  .filter((w) => w.signals > 0)
                  .slice(0, 10)
                  .map((w) => (
                    <tr key={w.address} className="border-t border-line">
                      <td className="py-1 text-slate-200 truncate max-w-[9rem]">
                        {w.label || short(w.address)} <span className="text-slate-500">{w.tier}</span>
                      </td>
                      <td className="font-mono">{w.signals}</td>
                      <td className="font-mono">
                        <span className="text-pos">{w.wins}</span> / <span className="text-neg">{w.losses}</span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
          {suggestions.length > 0 && (
            <ul className="mt-2 space-y-1">
              {suggestions.map((w) => (
                <li key={w.address} className="flex items-center gap-2 text-[11px]">
                  <span className="text-slate-300 truncate">
                    {w.label || short(w.address)}: {w.suggestion!.remove ? 'remove' : `tier ${w.tier} → ${w.suggestion!.tier}`} ({w.suggestion!.why})
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost ml-auto"
                    onClick={() => (w.suggestion!.remove ? removeWallet(w.address) : updateWallet(w.address, { tier: w.suggestion!.tier! }))}
                  >
                    Apply
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-white mb-1.5">Gates</p>
          {review.gates.length === 0 ? (
            <p className="text-[11px] text-slate-500">Nothing stopped yet.</p>
          ) : (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-slate-500 text-left">
                  <th className="font-normal py-1">Stopped at</th>
                  <th className="font-normal">Signals</th>
                  <th className="font-normal">Went 2x anyway</th>
                </tr>
              </thead>
              <tbody>
                {review.gates.map((g) => (
                  <tr key={g.stage} className="border-t border-line">
                    <td className="py-1 text-slate-200">{STAGE_LABEL[g.stage] || g.stage}</td>
                    <td className="font-mono">{g.stopped}</td>
                    <td className={`font-mono ${g.missedWinners ? 'text-warn' : ''}`}>{g.missedWinners}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[11px] text-slate-500 mt-1.5">A gate that often stops tokens that later run is a candidate to loosen a little.</p>
        </div>

        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-white mb-1.5">Does the AI add accuracy?</p>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-slate-500 text-left">
                <th className="font-normal py-1">Group</th>
                <th className="font-normal">n</th>
                <th className="font-normal">Hit 2x</th>
                <th className="font-normal">Avg +6h</th>
              </tr>
            </thead>
            <tbody>
              {review.ai.map((r) => (
                <tr key={r.group} className="border-t border-line">
                  <td className="py-1 text-slate-200">{r.group}</td>
                  <td className="font-mono">{r.n}</td>
                  <td className="font-mono">{r.n ? `${Math.round((100 * r.reached2x) / r.n)}%` : '—'}</td>
                  <td className="font-mono">{r.avgH6Pct === null ? '—' : `${r.avgH6Pct > 0 ? '+' : ''}${r.avgH6Pct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-slate-500 mt-1.5">
            {review.aiAddsValue === null
              ? 'Needs at least 3 signals in each group to compare.'
              : review.aiAddsValue
              ? 'AI ENTRY picks hit 2x more often than momentum alone.'
              : 'AI ENTRY picks do not beat momentum alone yet - consider simplifying.'}
          </p>
        </div>
      </div>
    </div>
  );
};

type Filter = 'all' | 'entered' | 'watch' | 'stopped';

/** Every signal, rejected ones too, with the price after it and its result. */
export const SignalJournal: React.FC = () => {
  const { journal, clearJournal } = useConvergenceStore(useShallow((s) => ({ journal: s.journal, clearJournal: s.clearJournal })));
  const [tab, setTab] = useState<'journal' | 'review'>('journal');
  const [filter, setFilter] = useState<Filter>('all');
  const [days, setDays] = useState(7);
  const list = journal.filter((s) =>
    filter === 'all' ? true : filter === 'entered' ? s.status === 'entered' : filter === 'watch' ? s.status === 'watch' || s.status === 'evaluating' : !['entered', 'watch', 'evaluating'].includes(s.status)
  );

  const download = (name: string, body: string, type: string) => {
    const url = URL.createObjectURL(new Blob([body], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="panel overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-line">
        <h3 className="text-[15px] font-bold text-white flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-slate-500" />
          Signal journal <span className="text-slate-500 font-normal">({journal.length})</span>
        </h3>
        <nav className="tabbar" aria-label="Journal view">
          <button type="button" className="tab" data-active={tab === 'journal'} onClick={() => setTab('journal')}>
            Signals
          </button>
          <button type="button" className="tab" data-active={tab === 'review'} onClick={() => setTab('review')}>
            Weekly review
          </button>
        </nav>
        <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-1.5 flex-wrap">
          {tab === 'journal' ? (
            <select className="field w-auto" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filter signals">
              <option value="all">All</option>
              <option value="entered">Entered</option>
              <option value="watch">Watchlist / evaluating</option>
              <option value="stopped">Stopped at a gate</option>
            </select>
          ) : (
            <select className="field w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Review period">
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={3650}>All</option>
            </select>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => download('convergence-journal.csv', journalCsv(journal), 'text/csv')} disabled={!journal.length} title="Download CSV">
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => download('convergence-journal.json', JSON.stringify(journal, null, 2), 'application/json')}
            disabled={!journal.length}
            title="Download the full journal as JSON"
          >
            JSON
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => window.confirm('Clear the whole signal journal?') && clearJournal()} disabled={!journal.length} title="Clear journal">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>
      <div className="px-5 py-4">
        {tab === 'review' ? (
          <WeeklyReview days={days} />
        ) : list.length === 0 ? (
          <p className="text-[13px] text-slate-500">
            No signals yet. A signal opens when tracked wallets from different clusters reach the trigger points inside the window; every one is recorded here,
            rejected ones too, with its price after 5 minutes, 1, 6 and 24 hours.
          </p>
        ) : (
          <ul>
            {list.slice(0, 100).map((s) => (
              <SignalRow key={s.id} sig={s} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
