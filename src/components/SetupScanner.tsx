'use client';

import React, { useState } from 'react';
import { Bell, BellOff, Check, Copy, ExternalLink, Gauge, Loader2, Pause, Play, Plus, Radar, RefreshCw, ShieldCheck, Users, X, Zap, ZapOff } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useScannerStore } from '@/store/useScannerStore';
import { useBotStore } from '@/store/useBotStore';
import { minEntryScore, MOMENTUM_MAX_RSI, ScanSignal, SetupKind } from '@/services/scanner.service';
import { isSolanaAddress, MAX_SMART_WALLETS } from '@/services/smartwallet.service';
import { CoinAvatar } from './CoinAvatar';
import { formatNumber, formatPrice, timeAgo } from '@/lib/formatters';

const SETUP_LABEL: Record<SetupKind, string> = {
  breakout: 'Breakout-retest',
  flag: 'Flag',
  pullback: 'Trend pullback',
  momentum: 'Momentum',
  rebound: 'RSI rebound',
};

const round1 = (v?: number) => Math.round((v ?? 0) * 10) / 10;

function scoreChip(total: number, minScore: number) {
  if (total >= 80) return 'chip chip-pos';
  if (total >= minScore) return 'chip chip-warn';
  return 'chip';
}

function ageLabel(hours: number) {
  if (hours >= 48) return `${Math.round(hours / 24)}d old`;
  if (hours >= 1) return `${Math.round(hours)}h old`;
  return `${Math.round(hours * 60)}m old`;
}

const SignalCard: React.FC<{ signal: ScanSignal }> = ({ signal: s }) => {
  const { manualSnipeCoin, settings, pendingTradeIds } = useBotStore(
    useShallow((st) => ({ manualSnipeCoin: st.manualSnipeCoin, settings: st.settings, pendingTradeIds: st.pendingTradeIds }))
  );
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const ready = s.status === 'ready';
  const busy = pendingTradeIds.includes(s.coin.id);

  const buy = async () => {
    setResult(null);
    const r = await manualSnipeCoin(s.coin, settings.buyAmountUsd, `scanner ${s.setup} ${s.score?.total ?? ''}`.trim(), {
      tp: round1(s.tpPercent),
      sl: round1(s.slPercent),
    });
    setResult({ ok: r.success, message: r.message });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(s.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked; the address is still visible in the chart link
    }
  };

  return (
    <article className="panel-interactive p-4">
      <div className="flex flex-col xl:flex-row xl:items-center gap-4">
        <div className="flex items-center gap-3 min-w-0 xl:w-64 shrink-0">
          <CoinAvatar imageUrl={s.coin.imageUrl} symbol={s.coin.symbol} chainId={s.coin.chainId} size="md" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-white text-[13px] truncate">{s.coin.symbol}</span>
              {ready && <span className="chip chip-pos">Ready</span>}
              {s.setup && <span className="chip chip-info">{SETUP_LABEL[s.setup]}</span>}
              {s.score && (
                <span
                  className={scoreChip(s.score.total, minEntryScore(settings.scannerMode))}
                  title={`Safety ${s.score.safety}/30 · Holders ${s.score.holders}/20 · Liquidity ${s.score.liquidity}/20 · Momentum ${s.score.momentum}/20 · Social ${s.score.social}/10`}
                >
                  {s.score.total}/100
                </span>
              )}
              {s.smartWallets ? (
                <span className="chip" title="Tracked smart wallets that still hold this token">
                  <Users className="w-3 h-3" />
                  {s.smartWallets} smart
                </span>
              ) : null}
            </div>
            <p className="text-[11px] text-slate-500 truncate mt-0.5">
              {s.coin.name} · {ageLabel(s.ageHours)}
              {s.gates ? ` · ${s.gates.holders.toLocaleString('en-US')} holders` : ''}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 flex-1 min-w-0">
          <div className="min-w-0">
            <dt className="text-[11px] text-slate-500">Price</dt>
            <dd className="mt-0.5 text-[13px] font-mono font-semibold text-white truncate">{formatPrice(s.priceUsd)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] text-slate-500">Entry zone</dt>
            <dd className="mt-0.5 text-[13px] font-mono font-semibold text-white truncate">
              {formatPrice(s.entryLow)} – {formatPrice(s.entryHigh)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] text-slate-500">Stop loss</dt>
            <dd className="mt-0.5 text-[13px] font-mono font-semibold text-neg truncate">
              {formatPrice(s.stopPrice)} <span className="text-neg/70">−{round1(s.slPercent)}%</span>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] text-slate-500">Take profit</dt>
            <dd className="mt-0.5 text-[13px] font-mono font-semibold text-pos truncate">
              {formatPrice(s.targetPrice)} <span className="text-pos/70">+{round1(s.tpPercent)}%</span>
            </dd>
          </div>
        </dl>

        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          {ready && (
            <button type="button" onClick={buy} disabled={busy} className="btn btn-sm btn-primary" title="Buys with these TP / SL levels; profit lock comes from Settings">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Buy ${settings.buyAmountUsd}
            </button>
          )}
          {s.coin.url && (
            <a href={s.coin.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost" title="Chart on DexScreener">
              Chart
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          <a href={`https://rugcheck.xyz/tokens/${s.id}`} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost" title="Full RugCheck report">
            <ShieldCheck className="w-3.5 h-3.5" />
            RugCheck
          </a>
          <button type="button" onClick={copy} className="btn btn-sm btn-ghost" title={`Copy contract address ${s.id}`}>
            {copied ? <Check className="w-3.5 h-3.5 text-pos" /> : <Copy className="w-3.5 h-3.5" />}
            CA
          </button>
        </div>
      </div>

      <p className="text-[13px] text-slate-300 mt-3">{s.reason}</p>
      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
        Liq {formatNumber(s.liquidityUsd)} · MC {formatNumber(s.marketCapUsd)} · 1h vol {formatNumber(s.volume1hUsd)} · 1h buys/sells {s.buys1h}/{s.sells1h}
        {s.rsi !== undefined ? ` · RSI 5m ${s.rsi.toFixed(0)}` : ''}
        {s.gates ?` · top 10 ${s.gates.top10Pct.toFixed(0)}% · insiders ${s.gates.insiderPct.toFixed(0)}%` : ''}
        {s.costPercent !== undefined ? ` · fees ${s.costPercent.toFixed(1)}% round trip · net R:R 1:${(s.netRewardRisk ?? 0).toFixed(1)}` : ''}
        {s.invalidation ? ` · cancel on ${s.invalidation}` : ''}
      </p>
      {result && <p className={`text-xs mt-2 ${result.ok ? 'text-pos' : 'text-neg'}`}>{result.message}</p>}
    </article>
  );
};

const SmartWallets: React.FC = () => {
  const { wallets, updateSettings } = useBotStore(useShallow((s) => ({ wallets: s.settings.smartWallets || [], updateSettings: s.updateSettings })));
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const add = () => {
    const found = draft.split(/[\s,]+/).filter(Boolean);
    const bad = found.find((a) => !isSolanaAddress(a));
    if (bad) {
      setNote(`Not a Solana wallet address: ${bad}`);
      return;
    }
    const merged = [...new Set([...wallets, ...found])];
    updateSettings({ smartWallets: merged.slice(0, MAX_SMART_WALLETS) });
    setDraft('');
    setNote(merged.length > MAX_SMART_WALLETS ? `Tracking the first ${MAX_SMART_WALLETS}; remove one to add another.` : null);
  };

  return (
    <details className="panel overflow-hidden">
      <summary className="px-4 py-3 text-[13px] font-bold text-white cursor-pointer select-none">
        Smart wallets <span className="text-slate-500 font-normal">({wallets.length})</span>
      </summary>
      <div className="border-t border-line px-4 py-3 space-y-3">
        <p className="text-xs text-slate-400 leading-relaxed">
          Wallets of traders worth following: KOLs, or accounts with steady PnL on the GMGN, Axiom or kolscan leaderboards. Tokens they hold join the scan
          (two of them must hold it once you track three or more), and each card shows how many still hold it. A holding is a lead, not a buy: the token still
          has to pass every gate and show a Ready setup.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            type="text"
            className="field font-mono text-xs flex-1 min-w-0"
            placeholder="Wallet address (paste several separated by spaces)"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn btn-secondary shrink-0" disabled={!draft.trim() || wallets.length >= MAX_SMART_WALLETS}>
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </form>
        {note && <p className="text-xs text-warn">{note}</p>}
        {wallets.length > 0 && (
          <ul>
            {wallets.map((w) => (
              <li key={w} className="row flex items-center gap-2 py-1.5 text-xs">
                <span className="font-mono text-slate-300 truncate flex-1 min-w-0">{w}</span>
                <a href={`https://gmgn.ai/sol/address/${w}`} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost" title="PnL and recent trades on GMGN">
                  PnL
                  <ExternalLink className="w-3 h-3" />
                </a>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  title="Stop tracking this wallet"
                  onClick={() => updateSettings({ smartWallets: wallets.filter((x) => x !== w) })}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
};

export const SetupScanner: React.FC = () => {
  const { enabled, alerts, scanning, signals, candidateCount, lastScanAt, error, setEnabled, setAlerts, scanNow } = useScannerStore(
    useShallow((s) => ({
      enabled: s.enabled,
      alerts: s.alerts,
      scanning: s.scanning,
      signals: s.signals,
      candidateCount: s.candidateCount,
      lastScanAt: s.lastScanAt,
      error: s.error,
      setEnabled: s.setEnabled,
      setAlerts: s.setAlerts,
      scanNow: s.scanNow,
    }))
  );
  const { settings, updateSettings } = useBotStore(useShallow((s) => ({ settings: s.settings, updateSettings: s.updateSettings })));

  const toggleAutoBuy = () => {
    const next = !settings.scannerAutoBuy;
    if (
      next &&
      !settings.paperTrading &&
      !window.confirm(
        `Auto-buy will spend real SOL: up to $${settings.buyAmountUsd} per entry, at most ${settings.maxPositions} open positions, only on Ready signals (score ≥ ${minEntryScore(settings.scannerMode)}) that pass the sell-back test. Turn it on?`
      )
    ) {
      return;
    }
    updateSettings({ scannerAutoBuy: next });
  };

  const ready = signals.filter((s) => s.status === 'ready');
  const watching = signals.filter((s) => s.status === 'watch');
  const rejected = signals.filter((s) => s.status === 'rejected');

  return (
    <section className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-[15px] font-bold text-white leading-tight flex items-center gap-2">
            <Radar className="w-4 h-4 text-slate-500" />
            Setup scanner
          </h1>
          <p className="text-[13px] text-slate-400 mt-0.5">
            Every minute: safety gates and clone filters, then{' '}
            {settings.scannerMode === 'simple' ? `momentum breakouts as they happen (not while 5m RSI is over ${MOMENTUM_MAX_RSI}), plus ` : ''}breakout, flag, RSI
            rebound and pullback setups. Buy only when a card says Ready.
          </p>
        </div>
        <div className="lg:ml-auto flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 flex items-center gap-1.5">
            <span className={`dot ${enabled ? 'dot-live' : 'dot-idle'}`} />
            {scanning ? 'Scanning…' : lastScanAt ? `Scanned ${timeAgo(lastScanAt)} · ${candidateCount} tokens` : enabled ? 'Starting…' : 'Paused'}
          </span>
          <button type="button" onClick={() => setAlerts(!alerts)} className="btn btn-secondary" title="Sound, vibration and a notification when a setup becomes ready">
            {alerts ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
            {alerts ? 'Alerts on' : 'Alerts off'}
          </button>
          <button
            type="button"
            onClick={toggleAutoBuy}
            className={`btn btn-secondary ${settings.scannerAutoBuy ? 'text-pos' : ''}`}
            title={`Buy Ready signals automatically: $${settings.buyAmountUsd} each, at most ${settings.maxPositions} open, score ≥ ${minEntryScore(settings.scannerMode)}, sell-back test passed, within the daily loss limit`}
          >
            {settings.scannerAutoBuy ? <Zap className="w-3.5 h-3.5" /> : <ZapOff className="w-3.5 h-3.5" />}
            {settings.scannerAutoBuy ? 'Auto-buy on' : 'Auto-buy off'}
          </button>
          <button
            type="button"
            onClick={() => updateSettings({ scannerMode: settings.scannerMode === 'simple' ? 'strict' : 'simple' })}
            className="btn btn-secondary"
            title={`Simple buys 5m momentum breakouts as they happen (more trades), skipping them while RSI is over ${MOMENTUM_MAX_RSI}. Strict waits for a retest, flag, RSI rebound or pullback (fewer trades).`}
          >
            <Gauge className="w-3.5 h-3.5" />
            {settings.scannerMode === 'simple' ? 'Mode: Simple' : 'Mode: Strict'}
          </button>
          <button type="button" onClick={() => void scanNow()} disabled={scanning} className="btn btn-secondary">
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            Scan now
          </button>
          <button type="button" onClick={() => setEnabled(!enabled)} className={enabled ? 'btn btn-secondary' : 'btn btn-primary'}>
            {enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {enabled ? 'Pause' : 'Start'}
          </button>
        </div>
      </div>

      <div className="panel-2 px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-slate-400">
        <span>
          <span className="text-pos font-semibold">{ready.length}</span> ready
        </span>
        <span>
          <span className="text-white font-semibold">{watching.length}</span> watching
        </span>
        <span>
          <span className="text-slate-300 font-semibold">{rejected.length}</span> rejected
        </span>
        <span className="sm:ml-auto">
          Buy size ${settings.buyAmountUsd} ·{' '}
          <span className={settings.paperTrading ? 'text-warn' : 'text-neg'}>{settings.paperTrading ? 'paper' : 'live'}</span> · TP +
          {Math.min(50, Math.max(10, settings.takeProfitPercent))}% · stop ≤ 12% · profit lock +{settings.profitLockTriggerPercent}% → +
          {settings.profitLockPercent}% · auto-buy{' '}
          <span className={settings.scannerAutoBuy ? 'text-pos' : 'text-slate-500'}>{settings.scannerAutoBuy ? `on, max ${settings.maxPositions} positions` : 'off'}</span>
        </span>
      </div>

      {error && <p className="panel-2 px-4 py-3 text-[13px] text-warn">{error}</p>}

      <SmartWallets />

      <div className="space-y-2">
        <h2 className="text-[13px] font-bold text-white">
          Ready to enter <span className="text-slate-500 font-normal">({ready.length})</span>
        </h2>
        {ready.length === 0 ? (
          <p className="panel px-4 py-5 text-[13px] text-slate-400">
            Nothing is ready. Entries only appear when a setup confirms; the scanner checks again every minute{alerts ? ' and alerts you' : ''}.
          </p>
        ) : (
          ready.map((s) => <SignalCard key={s.id} signal={s} />)
        )}
      </div>

      {watching.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-[13px] font-bold text-white">
            Watching <span className="text-slate-500 font-normal">({watching.length})</span>
          </h2>
          {watching.map((s) => (
            <SignalCard key={s.id} signal={s} />
          ))}
        </div>
      )}

      {rejected.length > 0 && (
        <details className="panel overflow-hidden">
          <summary className="px-4 py-3 text-[13px] font-bold text-white cursor-pointer select-none">
            Rejected <span className="text-slate-500 font-normal">({rejected.length})</span>
          </summary>
          <ul className="border-t border-line">
            {rejected.map((s) => (
              <li key={s.id} className="row flex items-center gap-3 px-4 py-2 text-[13px]">
                <span className="font-semibold text-white w-28 truncate shrink-0">{s.coin.symbol}</span>
                <span className="text-slate-400 flex-1 min-w-0 truncate">{s.reason}</span>
                <span className="text-slate-500 font-mono text-xs shrink-0 hidden sm:inline">{formatNumber(s.liquidityUsd)} liq</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
};
