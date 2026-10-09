'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Bot, Brain, Check, DollarSign, Play, Square, Wallet } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useBotStore } from '@/store/useBotStore';
import { useScannerStore } from '@/store/useScannerStore';
import { AI_MODELS, aiModelLabel } from '@/lib/ai-models';
import { minEntryScore } from '@/services/scanner.service';
import { timeAgo } from '@/lib/formatters';
import { ScannerSignals } from './ScannerSignals';
import { BotMetricsBar } from './bot/BotMetricsBar';
import { BotPositionsTable } from './bot/BotPositionsTable';
import { BotTerminalLogs } from './bot/BotTerminalLogs';
import { BotTradeHistory } from './bot/BotTradeHistory';

/** Lets any page jump to a header tab (the tab state lives in page.tsx). */
export const goToTab = (tab: 'trending' | 'new' | 'auto' | 'settings') => window.dispatchEvent(new CustomEvent('coinscope:tab', { detail: tab }));

function uptime(since: number): string {
  const mins = Math.max(0, Math.round((Date.now() - since) / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

const Step: React.FC<{ n: number; title: string; ok: boolean; children: React.ReactNode }> = ({ n, title, ok, children }) => (
  <div className="panel-2 p-4 min-w-0">
    <div className="flex items-center gap-2">
      <span
        className={`grid place-items-center w-6 h-6 rounded-full text-[11px] font-bold shrink-0 ${
          ok ? 'bg-pos/15 text-pos' : 'bg-ink-700 text-slate-300'
        }`}
      >
        {ok ? <Check className="w-3.5 h-3.5" /> : n}
      </span>
      <p className="text-[13px] font-semibold text-white">{title}</p>
    </div>
    <div className="mt-3">{children}</div>
  </div>
);

export const AutoTradePage: React.FC = () => {
  const { settings, updateSettings, botWallet, positions, lastAiDecision, getTodayRealizedPnl, setWalletDialogOpen } = useBotStore(
    useShallow((s) => ({
      settings: s.settings,
      updateSettings: s.updateSettings,
      botWallet: s.botWallet,
      positions: s.positions,
      lastAiDecision: s.lastAiDecision,
      getTodayRealizedPnl: s.getTodayRealizedPnl,
      setWalletDialogOpen: s.setWalletDialogOpen,
    }))
  );
  const { enabled, scanning, lastScanAt, candidateCount, readyCount, autoSince, startAutoTrade, stopAutoTrade } = useScannerStore(
    useShallow((s) => ({
      enabled: s.enabled,
      scanning: s.scanning,
      lastScanAt: s.lastScanAt,
      candidateCount: s.candidateCount,
      readyCount: s.readyIds.length,
      autoSince: s.autoSince,
      startAutoTrade: s.startAutoTrade,
      stopAutoTrade: s.stopAutoTrade,
    }))
  );

  const [aiKey, setAiKey] = useState<{ configured: boolean } | null>(null);
  useEffect(() => {
    fetch('/api/ai/decide')
      .then((r) => r.json())
      .then((d) => setAiKey({ configured: !!d?.configured }))
      .catch(() => setAiKey({ configured: false }));
  }, []);

  // Re-render once a minute so "since 12 min" and "scanned 40s ago" stay current.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const running = settings.scannerAutoBuy;
  const live = !settings.paperTrading;
  const walletConnected = settings.phantomWalletConnected && !!settings.connectedWalletAddress;
  const signerReady = live ? (settings.liveSigner === 'bot' ? botWallet.unlocked : walletConnected) : true;
  const moneyText = live
    ? settings.liveSigner === 'bot'
      ? botWallet.address
        ? botWallet.unlocked
          ? `Bot wallet · ${botWallet.solBalance === null ? '—' : botWallet.solBalance.toFixed(3)} SOL`
          : 'Bot wallet is locked'
        : 'No bot wallet yet'
      : walletConnected
      ? `${settings.walletType === 'solflare' ? 'Solflare' : 'Phantom'} · ${settings.solBalance.toFixed(3)} SOL (you approve every trade)`
      : 'No wallet connected'
    : 'Paper money — nothing real is spent';
  const aiOn = settings.aiGateEnabled;
  const aiReady = !aiOn || aiKey?.configured !== false;
  const todayPnl = getTodayRealizedPnl();
  const lossLimitHit = settings.dailyLossLimitUsd > 0 && todayPnl <= -settings.dailyLossLimitUsd;
  const canStart = signerReady && !lossLimitHit;

  const toggle = () => {
    if (running) {
      stopAutoTrade();
      return;
    }
    if (
      live &&
      !window.confirm(
        `Auto trade will spend real SOL: up to $${settings.buyAmountUsd} per entry, at most ${settings.maxPositions} open positions, only on Ready signals (score ≥ ${minEntryScore(
          settings.scannerMode
        )}) that pass the sell-back test${aiOn ? ' and Claude approves' : ''}. It stops for the day after $${settings.dailyLossLimitUsd} of losses. Turn it on?`
      )
    ) {
      return;
    }
    startAutoTrade();
  };

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------ hero */}
      <section className={`panel p-5 sm:p-6 ${running ? 'border-pos/30' : ''}`}>
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
          <div className="flex items-start gap-3.5 min-w-0">
            <span
              className={`grid place-items-center w-11 h-11 rounded-xl border shrink-0 ${
                running ? 'bg-pos/10 border-pos/30 text-pos' : 'bg-ink-850 border-line text-slate-500'
              }`}
            >
              <Bot className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-[15px] font-bold text-white leading-none">Auto trade</h1>
                <span className="flex items-center gap-1.5 text-[13px] text-slate-400">
                  <span className={`dot ${running ? 'dot-live' : 'dot-idle'}`} />
                  {running ? `On${autoSince ? ` · ${uptime(autoSince)}` : ''}` : 'Off'}
                </span>
                <span className={live ? 'chip chip-neg' : 'chip chip-warn'}>{live ? 'Live funds' : 'Paper'}</span>
              </div>
              <p className="text-[13px] text-slate-400 mt-1.5 max-w-2xl leading-relaxed">
                Every minute the scanner checks Solana tokens for safety and a confirmed chart setup. Each Ready signal
                {aiOn ? ' is reviewed by Claude, and the approved ones are' : ' is'} bought with the signal&apos;s stop and target, then managed
                with take-profit, stop-loss and profit lock until it closes.
              </p>
              <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
                <span className="chip" title="Scanner heartbeat">
                  <span className={`dot ${enabled ? 'dot-live' : 'dot-idle'}`} />
                  {scanning ? 'Scanning…' : lastScanAt ? `Scanned ${timeAgo(lastScanAt)} · ${candidateCount} tokens` : enabled ? 'Starting…' : 'Scanner paused'}
                </span>
                <span className="chip">
                  <Brain className={`w-3 h-3 ${aiOn ? 'text-signal' : 'text-slate-500'}`} />
                  {aiOn ? aiModelLabel(settings.aiModel) : 'AI review off'}
                </span>
                <span className="chip">{readyCount} ready</span>
                <span className="chip">
                  {positions.length}/{settings.maxPositions} open
                </span>
                <span className={`chip ${todayPnl > 0 ? 'chip-pos' : todayPnl < 0 ? 'chip-neg' : ''}`} title="Realized P&L today">
                  Today {todayPnl >= 0 ? '+' : '−'}${Math.abs(todayPnl).toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <div className="shrink-0 w-full lg:w-auto">
            <button
              type="button"
              onClick={toggle}
              disabled={!running && !canStart}
              className={`btn btn-lg w-full lg:w-auto ${running ? 'btn-danger' : 'btn-primary'}`}
              title={!running && !canStart ? (lossLimitHit ? 'Daily loss limit reached' : 'Finish step 1 first') : undefined}
            >
              {running ? (
                <>
                  <Square className="w-4 h-4" />
                  Stop auto trade
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Start auto trade
                </>
              )}
            </button>
            {lossLimitHit && (
              <p className="text-[11px] text-neg mt-2 flex items-center gap-1.5 lg:justify-end">
                <AlertTriangle className="w-3.5 h-3.5" />
                Daily loss limit reached — resumes tomorrow.
              </p>
            )}
          </div>
        </div>

        {/* ---------------------------------------------------------- steps */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
          <Step n={1} title="Money" ok={signerReady}>
            <p className={`text-[13px] ${signerReady ? 'text-slate-200' : 'text-neg'}`}>{moneyText}</p>
            <div className="flex items-center gap-2 mt-2.5 flex-wrap">
              {live && settings.liveSigner === 'wallet' && !walletConnected && (
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setWalletDialogOpen(true)}>
                  <Wallet className="w-3.5 h-3.5 text-signal" />
                  Connect wallet
                </button>
              )}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => goToTab('settings')}>
                {live ? 'Wallet & mode settings' : 'Switch to live in Settings'}
              </button>
            </div>
          </Step>

          <Step n={2} title="Size" ok={settings.buyAmountUsd > 0 && settings.maxPositions > 0}>
            <div className="grid grid-cols-3 gap-2">
              <label className="min-w-0">
                <span className="label">Per trade</span>
                <span className="relative block">
                  <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                  <input
                    type="number"
                    min={1}
                    className="field pl-7 font-mono"
                    value={settings.buyAmountUsd}
                    onChange={(e) => updateSettings({ buyAmountUsd: Math.max(1, Number(e.target.value)) })}
                  />
                </span>
              </label>
              <label className="min-w-0">
                <span className="label">Max open</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  className="field font-mono"
                  value={settings.maxPositions}
                  onChange={(e) => updateSettings({ maxPositions: Math.max(1, Number(e.target.value)) })}
                />
              </label>
              <label className="min-w-0">
                <span className="label">Stop day at</span>
                <span className="relative block">
                  <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                  <input
                    type="number"
                    min={0}
                    className="field pl-7 font-mono"
                    value={settings.dailyLossLimitUsd}
                    onChange={(e) => updateSettings({ dailyLossLimitUsd: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </span>
              </label>
            </div>
            <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
              Stops and targets come from each signal (stop ≤ 12%). Profit lock +{settings.profitLockTriggerPercent}% → +{settings.profitLockPercent}%.
            </p>
          </Step>

          <Step n={3} title="AI review" ok={aiReady}>
            <div className="flex items-center gap-2">
              <select className="field" value={settings.aiModel} onChange={(e) => updateSettings({ aiModel: e.target.value })} aria-label="Claude model">
                {AI_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — ${m.inputPerM}/${m.outputPerM} per M tokens
                  </option>
                ))}
              </select>
              <button
                type="button"
                role="switch"
                aria-checked={aiOn}
                aria-label="Ask Claude before each entry"
                onClick={() => updateSettings({ aiGateEnabled: !aiOn })}
                className={`relative w-9 h-5 rounded-full shrink-0 transition-colors duration-150 ${aiOn ? 'bg-signal' : 'bg-ink-700'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-150 ${aiOn ? 'translate-x-4' : ''}`} />
              </button>
            </div>
            <p className={`text-[11px] mt-2 leading-relaxed ${aiReady ? 'text-slate-500' : 'text-neg'}`}>
              {!aiOn
                ? 'Off: the scanner buys on its own checks.'
                : aiKey === null
                ? 'Checking the Claude key…'
                : aiKey.configured
                ? `Claude reviews every Ready signal against the entry rules; buys need ≥ ${settings.aiMinConfidence}% confidence.`
                : 'No ANTHROPIC_API_KEY on the server — entries are held until it is set.'}
            </p>
          </Step>
        </div>

        {running && (
          <p className="text-[11px] text-slate-500 mt-4 pt-3 border-t border-line leading-relaxed">
            The engine runs in this tab. For 24-hour trading keep it open in the foreground on a PC that does not sleep; the page keeps the screen awake
            and warns before closing. Closing the tab stops entries, exits and the profit lock.
          </p>
        )}
        {lastAiDecision && (
          <p className="text-xs text-slate-500 mt-3 truncate">
            <span className="text-slate-400">Last AI review:</span>{' '}
            <span className={lastAiDecision.action === 'buy' ? 'text-pos font-semibold' : 'text-warn font-semibold'}>
              {lastAiDecision.action.toUpperCase()} {lastAiDecision.symbol} ({lastAiDecision.confidence}%)
            </span>{' '}
            — {lastAiDecision.reason}
          </p>
        )}
      </section>

      <BotMetricsBar />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <BotPositionsTable />
        <BotTerminalLogs />
      </div>

      <ScannerSignals />

      <BotTradeHistory />
    </div>
  );
};
