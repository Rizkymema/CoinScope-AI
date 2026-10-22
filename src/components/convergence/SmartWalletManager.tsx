'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ExternalLink, Loader2, Pause, Play, Plus, RefreshCw, ShieldCheck, Users, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useConvergenceLive, useConvergenceStore } from '@/store/useConvergenceStore';
import { evaluateWallet, clusterOf } from '@/services/walletanalysis.service';
import { timeAgo } from '@/lib/formatters';
import { MAX_TRACKED_WALLETS, TrackedWallet, WalletManualStats, WalletTier } from '@/types/convergence';

const SOURCES = ['DexScreener top traders', 'Early buyer of a runner', 'Kolscan', 'Nansen', 'GMGN', 'Manual'];

const VERDICT_CHIP: Record<string, { label: string; chip: string }> = {
  pass: { label: 'Verified', chip: 'chip chip-pos' },
  incomplete: { label: 'Incomplete', chip: 'chip chip-warn' },
  fail: { label: 'Excluded', chip: 'chip chip-neg' },
};

const STATE_TONE = { pass: 'text-pos', fail: 'text-neg', unknown: 'text-slate-500' } as const;

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

const NumberField: React.FC<{ label: string; value?: number; onChange: (v: number | undefined) => void; step?: number }> = ({ label, value, onChange, step = 1 }) => (
  <label className="min-w-0">
    <span className="label">{label}</span>
    <input
      type="number"
      step={step}
      className="field font-mono"
      value={value ?? ''}
      placeholder="—"
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  </label>
);

const WalletRow: React.FC<{ w: TrackedWallet }> = ({ w }) => {
  const { config, updateWallet, removeWallet, analyzeWallet } = useConvergenceStore(
    useShallow((s) => ({ config: s.config, updateWallet: s.updateWallet, removeWallet: s.removeWallet, analyzeWallet: s.analyzeWallet }))
  );
  const analyzing = useConvergenceLive((s) => s.analyzing[w.address]);
  const [open, setOpen] = useState(false);
  const ev = useMemo(() => evaluateWallet(w, config), [w, config]);
  const v = VERDICT_CHIP[ev.verdict];
  const setManual = (patch: Partial<WalletManualStats>) => updateWallet(w.address, { manual: { ...(w.manual || {}), ...patch } });
  const cluster = clusterOf(w);

  return (
    <li className="row py-2">
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <button
          type="button"
          onClick={() => updateWallet(w.address, { tier: w.tier === 'A' ? 'B' : 'A' })}
          className={`chip font-bold ${w.tier === 'A' ? 'chip-accent' : ''}`}
          title={`Tier ${w.tier}: ${w.tier === 'A' ? config.tierAPoints : config.tierBPoints} points per buy. Click to switch.`}
        >
          {w.tier}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-white truncate">
            {w.label || short(w.address)}
            {!w.active && <span className="text-slate-500"> · paused</span>}
          </p>
          <p className="text-[11px] text-slate-500 truncate font-mono">
            {w.label ? short(w.address) + ' · ' : ''}
            {w.source}
            {cluster !== w.address ? ` · cluster ${cluster.replace(/^funder:/, 'funder ').slice(0, 14)}` : ''}
            {w.stats?.lastActiveAt ? ` · active ${timeAgo(w.stats.lastActiveAt)}` : ''}
          </p>
        </div>
        {analyzing && !analyzing.error ? (
          <span className="chip">
            <Loader2 className="w-3 h-3 animate-spin" />
            {analyzing.total ? `${analyzing.done}/${analyzing.total}` : 'reading'}
          </span>
        ) : (
          <span className={v.chip} title={ev.flags.join(' · ') || undefined}>
            {v.label}
          </span>
        )}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Criteria and details">
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="mt-2.5 panel-2 p-3 space-y-3 animate-fade-up">
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            {ev.checks.map((c) => (
              <li key={c.key} className="flex items-center gap-2 min-w-0">
                <span className={`font-semibold w-10 shrink-0 ${STATE_TONE[c.state]}`}>{c.state === 'pass' ? 'PASS' : c.state === 'fail' ? 'FAIL' : '?'}</span>
                <span className="text-slate-400 truncate">{c.label}</span>
                <span className="ml-auto font-mono text-slate-200 shrink-0">{c.value}</span>
              </li>
            ))}
          </ul>
          {ev.flags.length > 0 && (
            <ul className="text-[11px] text-warn space-y-0.5">
              {ev.flags.map((f) => (
                <li key={f}>• {f}</li>
              ))}
            </ul>
          )}
          {analyzing?.error && <p className="text-[11px] text-neg">Verification failed: {analyzing.error}</p>}
          {w.stats && (
            <p className="text-[11px] text-slate-500">
              On-chain sample: {w.stats.sampleTxs} transactions over {w.stats.sampleDays} days, {w.stats.closedTrades} closed trades, realized{' '}
              {w.stats.pnlSampleSol >= 0 ? '+' : ''}
              {w.stats.pnlSampleSol.toFixed(2)} SOL{w.stats.funder ? ` · funded by ${short(w.stats.funder)}` : ''} · read {timeAgo(w.stats.analyzedAt)}
            </p>
          )}
          <div>
            <p className="text-[11px] text-slate-400 mb-1.5">From Kolscan / GMGN / Nansen (win over the on-chain sample; profit fields only need the right sign):</p>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              <NumberField label="Tokens 30d" value={w.manual?.tokensTraded30d} onChange={(v) => setManual({ tokensTraded30d: v })} />
              <NumberField label="Win rate %" value={w.manual?.winRate} onChange={(v) => setManual({ winRate: v })} />
              <NumberField label="PnL 30d" value={w.manual?.pnl30d} onChange={(v) => setManual({ pnl30d: v })} step={0.01} />
              <NumberField label="PnL 90d" value={w.manual?.pnl90d} onChange={(v) => setManual({ pnl90d: v })} step={0.01} />
              <NumberField
                label="Best trade %"
                value={w.manual?.largestWinShare !== undefined ? Math.round(w.manual.largestWinShare * 100) : undefined}
                onChange={(v) => setManual({ largestWinShare: v === undefined ? undefined : v / 100 })}
              />
              <NumberField label="Hold min" value={w.manual?.avgHoldMinutes} onChange={(v) => setManual({ avgHoldMinutes: v })} step={0.1} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="min-w-0">
              <span className="label">Label</span>
              <input className="field" value={w.label || ''} onChange={(e) => updateWallet(w.address, { label: e.target.value || undefined })} />
            </label>
            <label className="min-w-0">
              <span className="label">Cluster (same funder / owner)</span>
              <input
                className="field font-mono"
                placeholder={w.autoClusterId ? 'auto: shared funder' : 'own cluster'}
                value={w.clusterId || ''}
                onChange={(e) => updateWallet(w.address, { clusterId: e.target.value.trim() || undefined })}
              />
            </label>
            <label className="min-w-0">
              <span className="label">Notes</span>
              <input className="field" value={w.notes || ''} onChange={(e) => updateWallet(w.address, { notes: e.target.value || undefined })} />
            </label>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => void analyzeWallet(w.address)} disabled={!!analyzing && !analyzing.error}>
              <RefreshCw className="w-3.5 h-3.5" />
              Verify on-chain
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => updateWallet(w.address, { active: !w.active })}>
              {w.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {w.active ? 'Pause' : 'Resume'}
            </button>
            <a href={`https://kolscan.io/account/${w.address}`} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost">
              Kolscan
              <ExternalLink className="w-3 h-3" />
            </a>
            <a href={`https://gmgn.ai/sol/address/${w.address}`} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost">
              GMGN
              <ExternalLink className="w-3 h-3" />
            </a>
            <button type="button" className="btn btn-sm btn-ghost ml-auto text-neg" onClick={() => removeWallet(w.address)}>
              <X className="w-3.5 h-3.5" />
              Remove
            </button>
          </div>
        </div>
      )}
    </li>
  );
};

/** Stage 0: the smart-wallet list - tiers, clusters, criteria and weekly maintenance flags. */
export const SmartWalletManager: React.FC = () => {
  const { wallets, config, addWallets, analyzeAll } = useConvergenceStore(
    useShallow((s) => ({ wallets: s.wallets, config: s.config, addWallets: s.addWallets, analyzeAll: s.analyzeAll }))
  );
  const [draft, setDraft] = useState('');
  const [tier, setTier] = useState<WalletTier>('B');
  const [source, setSource] = useState(SOURCES[0]);
  const [note, setNote] = useState<string | null>(null);

  const evals = wallets.map((w) => evaluateWallet(w, config));
  const verified = evals.filter((e) => e.verdict === 'pass').length;
  const excluded = evals.filter((e) => e.verdict === 'fail').length;
  const maintenance = wallets.filter((w, i) => w.active && evals[i].verdict === 'fail').length;
  const sorted = [...wallets].sort((a, b) => (a.tier === b.tier ? b.addedAt - a.addedAt : a.tier === 'A' ? -1 : 1));

  const add = () => {
    const r = addWallets(draft.split(/[\s,]+/), { tier, source });
    setNote(r.error || (r.added ? `${r.added} added - verifying on-chain.` : 'Already on the list.'));
    if (!r.error) setDraft('');
  };

  return (
    <section className="panel overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-line">
        <h3 className="text-[15px] font-bold text-white flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-500" />
          Smart wallets <span className="text-slate-500 font-normal">({wallets.length}/{MAX_TRACKED_WALLETS})</span>
        </h3>
        <span className="chip chip-pos">
          <ShieldCheck className="w-3 h-3" />
          {verified} verified
        </span>
        {excluded > 0 && <span className="chip chip-neg">{excluded} excluded</span>}
        <button
          type="button"
          className="btn btn-sm btn-ghost ml-auto"
          onClick={analyzeAll}
          disabled={!wallets.length}
          title="Re-read every wallet's recent transactions (weekly maintenance)"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Verify all
        </button>
      </header>
      <div className="px-5 py-4 space-y-3">
        <p className="text-xs text-slate-400 leading-relaxed">
          The whole flow is only as good as this list: start with 20-50 verified wallets. A wallet counts toward a signal only when it is active and
          {config.onlyVerifiedWallets ? ' verified (every criterion met)' : ' not excluded (deployer, inactive ' + config.inactiveDays + '+ days, or a failed criterion; incomplete ones count until "Only fully verified wallets count" is on)'}. Tier A = {config.tierAPoints} points, tier B = {config.tierBPoints};
          wallets funded from one source are one cluster and count once.
          {maintenance > 0 ? ` ${maintenance} active wallet${maintenance > 1 ? 's fail' : ' fails'} the criteria now - review or remove ${maintenance > 1 ? 'them' : 'it'}.` : ''}
        </p>
        <form
          className="flex flex-col sm:flex-row gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            type="text"
            className="field font-mono text-xs flex-1 min-w-0"
            placeholder="Wallet addresses (several separated by spaces)"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <select className="field sm:w-48" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
            {SOURCES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select className="field sm:w-24" value={tier} onChange={(e) => setTier(e.target.value as WalletTier)} aria-label="Tier">
            <option value="A">Tier A</option>
            <option value="B">Tier B</option>
          </select>
          <button type="submit" className="btn btn-secondary shrink-0" disabled={!draft.trim() || wallets.length >= MAX_TRACKED_WALLETS}>
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </form>
        {note && <p className="text-xs text-slate-400">{note}</p>}
        {sorted.length > 0 ? (
          <ul>
            {sorted.map((w) => (
              <WalletRow key={w.address} w={w} />
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-slate-500">
            No wallets yet. Good sources: DexScreener Top Traders of tokens that ran, the earliest buyers that took the most profit on a parabolic token, and
            the Kolscan / Nansen leaderboards (verify them again here).
          </p>
        )}
      </div>
    </section>
  );
};
