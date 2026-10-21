'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Brain,
  Check,
  CheckCircle2,
  DollarSign,
  FlaskConical,
  Loader2,
  Server,
  ShieldAlert,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { useBotStore } from '@/store/useBotStore';
import { LiveSignerKind } from '@/types/bot';
import { RPC_PROXY } from '@/services/wallet.service';
import { AI_MODELS } from '@/lib/ai-models';
import { BotMcpPanel } from './BotMcpPanel';
import { BotWalletPanel } from './BotWalletPanel';

/* ------------------------------------------------------------------ atoms */

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }> = ({
  checked,
  onChange,
  label,
  disabled,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative w-9 h-5 rounded-full shrink-0 transition-colors duration-150 disabled:opacity-40 ${
      checked ? 'bg-signal' : 'bg-ink-700'
    }`}
  >
    <span
      className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-150 ${
        checked ? 'translate-x-4' : 'translate-x-0'
      }`}
    />
  </button>
);

const SwitchRow: React.FC<{
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}> = ({ title, description, checked, onChange, disabled }) => (
  <div className="flex items-start justify-between gap-4 py-3 border-b border-line last:border-b-0">
    <div className="min-w-0">
      <p className="text-[13px] font-semibold text-white">{title}</p>
      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{description}</p>
    </div>
    <Toggle checked={checked} onChange={onChange} label={title} disabled={disabled} />
  </div>
);

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div>
    <label className="label">{label}</label>
    {children}
    {hint && <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">{hint}</p>}
  </div>
);

const SectionTitle: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <h3 className="text-[13px] font-bold text-white flex items-center gap-2 pb-3 mb-4 border-b border-line">
    {icon}
    {children}
  </h3>
);

/* ------------------------------------------------------------------ panel */

export const BotSettingsPanel: React.FC = () => {
  const { settings, updateSettings, dryRunLiveTrade, lastDryRun, isDryRunning, botWallet, setWalletDialogOpen, getTodayRealizedPnl } =
    useBotStore();
  const walletConnected = settings.phantomWalletConnected && !!settings.connectedWalletAddress;
  const live = !settings.paperTrading;
  const signerReady = settings.liveSigner === 'bot' ? botWallet.unlocked : walletConnected;
  const canDryRun = walletConnected || !!botWallet.address;
  const todayPnl = getTodayRealizedPnl();
  const signerStatus =
    settings.liveSigner === 'bot'
      ? botWallet.address
        ? botWallet.unlocked
          ? `Bot wallet · ${botWallet.solBalance === null ? '—' : botWallet.solBalance.toFixed(3)} SOL`
          : 'Bot wallet locked'
        : 'Create a bot wallet first'
      : walletConnected
      ? `${settings.walletType === 'solflare' ? 'Solflare' : 'Phantom'} · ${settings.solBalance.toFixed(3)} SOL`
      : 'Connect a wallet first';

  const [aiKey, setAiKey] = useState<{ configured: boolean; defaultModel?: string } | null>(null);
  useEffect(() => {
    fetch('/api/ai/decide')
      .then((r) => r.json())
      .then((d) => setAiKey({ configured: !!d?.configured, defaultModel: d?.defaultModel }))
      .catch(() => setAiKey({ configured: false }));
  }, []);

  const SIGNERS: { id: LiveSignerKind; title: string; body: string }[] = [
    {
      id: 'wallet',
      title: 'Your wallet',
      body: 'Phantom or Solflare signs. You approve every buy and sell, so the bot cannot trade while you are away.',
    },
    {
      id: 'bot',
      title: 'Bot wallet',
      body: 'Signs automatically. Needed for unattended auto-entry and take-profit. Fund it with trading money only.',
    },
  ];

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------ execution mode */}
      <section className={`panel p-5 ${live ? 'border-neg/35' : ''}`}>
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-white flex items-center gap-2">
              <Wallet className="w-4 h-4 text-slate-500" />
              Money
              <span className={live ? 'chip chip-neg' : 'chip chip-warn'}>{live ? 'Live funds' : 'Paper'}</span>
            </h3>
            <p className="text-[13px] text-slate-400 mt-2 max-w-2xl leading-relaxed">
              {live
                ? 'Every buy and sell is a real Solana swap. Jupiter handles routing, including Pump.fun bonding curves, with PumpPortal as fallback. Tokens on EVM chains stay on paper.'
                : 'Fills are simulated against a $1,000 virtual balance, priced from a real Jupiter quote of the same size (price impact and fees included). Only the money is virtual.'}
            </p>
            {live && !signerReady && (
              <p className="text-xs text-neg flex items-center gap-1.5 mt-2.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {signerStatus}. Nothing trades live until the selected signer is ready.
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 panel-2 px-4 py-3 shrink-0">
            <div className="text-right">
              <p className="text-xs font-semibold text-white">Live trading</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{signerStatus}</p>
            </div>
            <Toggle
              checked={live}
              disabled={!live && !signerReady}
              label="Enable live trading"
              onChange={(v) => (v ? signerReady && updateSettings({ paperTrading: false }) : updateSettings({ paperTrading: true }))}
            />
          </div>
        </div>

        {/* signer */}
        <div className="mt-5 pt-4 border-t border-line">
          <p className="label">Who signs live trades</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {SIGNERS.map(({ id, title, body }) => {
              const active = settings.liveSigner === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => updateSettings({ liveSigner: id })}
                  aria-pressed={active}
                  className={`p-3.5 text-left rounded-xl border transition-colors duration-150 ${
                    active ? 'bg-signal/[0.08] border-signal/40' : 'bg-ink-850 border-line hover:border-line-strong'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className={`text-[13px] font-bold ${active ? 'text-signal' : 'text-white'}`}>{title}</span>
                    {active && <Check className="w-3.5 h-3.5 text-signal" />}
                  </span>
                  <span className="block text-[11px] text-slate-500 mt-1 leading-relaxed">{body}</span>
                </button>
              );
            })}
          </div>

          {settings.liveSigner === 'wallet' && !walletConnected && (
            <button type="button" className="btn btn-secondary mt-3" onClick={() => setWalletDialogOpen(true)}>
              <Wallet className="w-4 h-4 text-signal" />
              Connect wallet
            </button>
          )}
          {settings.liveSigner === 'bot' && (
            <div className="mt-3">
              <BotWalletPanel />
            </div>
          )}
        </div>

        {/* dry run */}
        <div className="mt-5 pt-4 border-t border-line">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              type="button"
              onClick={() => dryRunLiveTrade()}
              disabled={isDryRunning || !canDryRun}
              className="btn btn-secondary shrink-0"
              title={
                canDryRun
                  ? 'Builds the real swap for your address and simulates it on the RPC'
                  : 'Connect a wallet or create a bot wallet first'
              }
            >
              {isDryRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4 text-signal" />}
              Test live pipeline (${settings.buyAmountUsd})
            </button>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Builds a real swap for your wallet address and simulates it on the RPC. Nothing is signed and no funds move.
            </p>
          </div>

          {lastDryRun && (
            <div className={`mt-3 panel-2 p-3 ${lastDryRun.success ? 'border-pos/25' : 'border-neg/25'}`}>
              <div className="flex items-start gap-2">
                {lastDryRun.success ? (
                  <CheckCircle2 className="w-4 h-4 text-pos shrink-0 mt-px" />
                ) : (
                  <XCircle className="w-4 h-4 text-neg shrink-0 mt-px" />
                )}
                <div className="min-w-0 space-y-1.5">
                  <p className="text-xs text-slate-200 break-words leading-relaxed">
                    <span className="font-semibold">{lastDryRun.symbol}</span> — {lastDryRun.message}
                  </p>
                  {lastDryRun.attempts.map((a, i) => (
                    <p key={i} className="text-[11px] text-slate-500 flex items-start gap-1.5 break-words">
                      {a.ok ? (
                        <Check className="w-3 h-3 text-pos shrink-0 mt-0.5" />
                      ) : (
                        <X className="w-3 h-3 text-neg shrink-0 mt-0.5" />
                      )}
                      <span>
                        <span className="text-slate-400">{a.route}</span> — {a.detail}
                      </span>
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------ risk + AI */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="panel p-5">
          <SectionTitle icon={<ShieldAlert className="w-4 h-4 text-slate-500" />}>Sizing and risk</SectionTitle>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Buy size (USD)">
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                  <input
                    type="number"
                    min={1}
                    className="field pl-9 font-mono"
                    value={settings.buyAmountUsd}
                    onChange={(e) => updateSettings({ buyAmountUsd: Math.max(1, Number(e.target.value)) })}
                  />
                </div>
              </Field>
              <Field label="Max open positions">
                <input
                  type="number"
                  min={1}
                  max={50}
                  className="field font-mono"
                  value={settings.maxPositions}
                  onChange={(e) => updateSettings({ maxPositions: Math.max(1, Number(e.target.value)) })}
                />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Take profit %">
                <input
                  type="number"
                  min={5}
                  className="field font-mono text-pos"
                  value={settings.takeProfitPercent}
                  onChange={(e) => updateSettings({ takeProfitPercent: Math.max(1, Number(e.target.value)) })}
                />
              </Field>
              <Field label="Stop loss %">
                <input
                  type="number"
                  min={5}
                  max={95}
                  className="field font-mono text-neg"
                  value={settings.stopLossPercent}
                  onChange={(e) => updateSettings({ stopLossPercent: Math.min(95, Math.max(1, Number(e.target.value))) })}
                />
              </Field>
              <Field label="Trailing %">
                <input
                  type="number"
                  min={0}
                  max={90}
                  className="field font-mono text-warn"
                  value={settings.trailingStopPercent}
                  onChange={(e) => updateSettings({ trailingStopPercent: Math.min(90, Math.max(0, Number(e.target.value))) })}
                />
              </Field>
            </div>
            <p className="text-[11px] text-slate-500 -mt-2 leading-relaxed">
              Auto trade uses each signal&apos;s own stop and target (take profit capped 10-50%); take profit and stop loss here apply to manual buys from Market and the copilot. The trailing stop applies to every position.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Profit lock at +%" hint="Once a position is up this much (or half way to its own target if sooner, not under +8% unless set lower), its stop moves above cost. 0 turns it off.">
                <input
                  type="number"
                  min={0}
                  max={1000}
                  className="field font-mono text-pos"
                  value={settings.profitLockTriggerPercent}
                  onChange={(e) => updateSettings({ profitLockTriggerPercent: Math.min(1000, Math.max(0, Number(e.target.value))) })}
                />
              </Field>
              <Field label="Locked profit %" hint="Profit the raised stop keeps, so the sell's fees still leave you green.">
                <input
                  type="number"
                  min={0}
                  max={500}
                  className="field font-mono"
                  value={settings.profitLockPercent}
                  onChange={(e) => updateSettings({ profitLockPercent: Math.min(500, Math.max(0, Number(e.target.value))) })}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Slippage %">
                <input
                  type="number"
                  min={0.5}
                  max={50}
                  step={0.5}
                  className="field font-mono"
                  value={settings.slippagePercent}
                  onChange={(e) => updateSettings({ slippagePercent: Math.max(0.5, Number(e.target.value)) })}
                />
              </Field>
              <Field label="Priority fee (SOL)">
                <input
                  type="number"
                  min={0}
                  max={0.1}
                  step={0.0001}
                  className="field font-mono"
                  value={settings.priorityFeeSol}
                  onChange={(e) => updateSettings({ priorityFeeSol: Math.max(0, Number(e.target.value)) })}
                />
              </Field>
            </div>

            <Field
              label="Daily loss limit (USD)"
              hint={`Auto trade opens no new positions for the rest of the day once today's realized loss reaches this. 0 turns it off. Today: ${todayPnl >= 0 ? '+' : '-'}$${Math.abs(todayPnl).toFixed(2)} (${live ? 'live' : 'paper'}).`}
            >
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                <input
                  type="number"
                  min={0}
                  step={10}
                  className="field pl-9 font-mono"
                  value={settings.dailyLossLimitUsd}
                  onChange={(e) => updateSettings({ dailyLossLimitUsd: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
            </Field>

            <div className="pt-1">
              <SwitchRow
                title="Automatic exits"
                description="Close a position as soon as take-profit, stop-loss, profit lock or the trailing stop is hit."
                checked={settings.autoSell}
                onChange={(v) => updateSettings({ autoSell: v })}
              />
              <SwitchRow
                title="Sound alerts"
                description="Play a short chime on fills and exits."
                checked={settings.soundAlerts}
                onChange={(v) => updateSettings({ soundAlerts: v })}
              />
            </div>
          </div>
        </section>

        <section className="panel p-5">
          <SectionTitle icon={<Brain className="w-4 h-4 text-signal" />}>AI (Claude)</SectionTitle>

          <div className="space-y-4">
            <Field
              label="Model"
              hint={
                aiKey === null
                  ? 'Checking the server key…'
                  : aiKey.configured
                  ? 'Key found on the server. Prices are per million tokens, input / output; a review costs well under a cent on every model.'
                  : 'No ANTHROPIC_API_KEY on the server: add it to .env.local (and the Vercel project) to turn the AI on.'
              }
            >
              <select className="field" value={settings.aiModel} onChange={(e) => updateSettings({ aiModel: e.target.value })}>
                {AI_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — ${m.inputPerM} / ${m.outputPerM} · {m.blurb}
                  </option>
                ))}
              </select>
            </Field>

            <div>
              <SwitchRow
                title="Review every entry"
                description="Before a buy, Claude checks the signal against the entry rules (gates, score, setup, fees) and answers buy or skip with a confidence figure."
                checked={settings.aiGateEnabled}
                onChange={(v) => updateSettings({ aiGateEnabled: v })}
              />
              <SwitchRow
                title="Let the model tighten exits"
                description="Use the stop and target it suggests. It may tighten a stop, never widen it."
                checked={settings.aiAdjustTargets}
                onChange={(v) => updateSettings({ aiAdjustTargets: v })}
              />
            </div>

            <div>
              <label className="label">Minimum confidence — {settings.aiMinConfidence}%</label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={settings.aiMinConfidence}
                onChange={(e) => updateSettings({ aiMinConfidence: Number(e.target.value) })}
                className="w-full accent-signal cursor-pointer"
                aria-label="Minimum AI confidence"
              />
              <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">Entries the model rates below this are skipped and logged with its reason.</p>
            </div>

            <p className="text-[11px] text-slate-500 pt-3 border-t border-line leading-relaxed">
              The same model powers the copilot chat (bottom right) and the scorecard on the Market tab. The key never reaches the browser.
            </p>
          </div>
        </section>
      </div>

      {/* ------------------------------------------------ RPC */}
      <section className="panel p-5">
        <SectionTitle icon={<Server className="w-4 h-4 text-slate-500" />}>Solana connection</SectionTitle>
        <Field
          label="RPC endpoint"
          hint={`${RPC_PROXY} routes through this app's server with public-endpoint fallback. For live trading paste a private endpoint (Helius, QuickNode, Triton): faster and not rate-limited.`}
        >
          <div className="relative">
            <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
            <input
              type="text"
              className="field pl-9 font-mono text-xs"
              value={settings.solanaRpcUrl}
              placeholder={RPC_PROXY}
              onChange={(e) => updateSettings({ solanaRpcUrl: e.target.value.trim() || RPC_PROXY })}
            />
          </div>
        </Field>
      </section>

      {/* ------------------------------------------------ MCP */}
      <BotMcpPanel />
    </div>
  );
};
