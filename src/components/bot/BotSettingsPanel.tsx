'use client';

import React from 'react';
import {
  AlertTriangle,
  Brain,
  Check,
  CheckCircle2,
  DollarSign,
  FlaskConical,
  Loader2,
  Radar,
  Server,
  ShieldAlert,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { useBotStore } from '@/store/useBotStore';
import { ChainOption, LaunchPlatform } from '@/types/bot';
import { BotMcpPanel } from './BotMcpPanel';

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
  const { settings, updateSettings, dryRunLiveTrade, lastDryRun, isDryRunning } = useBotStore();
  const walletConnected = settings.phantomWalletConnected;
  const live = !settings.paperTrading;

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------ execution mode */}
      <section className={`panel p-5 ${live ? 'border-neg/35' : ''}`}>
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-white flex items-center gap-2">
              <Wallet className="w-4 h-4 text-slate-500" />
              Execution mode
              <span className={live ? 'chip chip-neg' : 'chip chip-warn'}>{live ? 'Live funds' : 'Paper'}</span>
            </h3>
            <p className="text-[13px] text-slate-400 mt-2 max-w-2xl leading-relaxed">
              {live
                ? 'Every buy and sell is a real Solana swap signed by your wallet. Jupiter handles routing, including Pump.fun bonding curves, with PumpPortal as fallback. Tokens on EVM chains stay on paper.'
                : 'Fills are simulated against a $1,000 virtual balance. Prices come from the same live feeds as live mode — only the money is virtual.'}
            </p>
            {live && !walletConnected && (
              <p className="text-xs text-neg flex items-center gap-1.5 mt-2.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                No wallet connected. The bot will refuse to start in live mode.
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 panel-2 px-4 py-3 shrink-0">
            <div className="text-right">
              <p className="text-xs font-semibold text-white">Live trading</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {walletConnected ? `${settings.walletType} · ${settings.solBalance.toFixed(3)} SOL` : 'Connect a wallet first'}
              </p>
            </div>
            <Toggle
              checked={live}
              disabled={!walletConnected}
              label="Enable live trading"
              onChange={(v) => walletConnected && updateSettings({ paperTrading: !v })}
            />
          </div>
        </div>

        {/* dry run */}
        <div className="mt-5 pt-4 border-t border-line">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              type="button"
              onClick={() => dryRunLiveTrade()}
              disabled={isDryRunning || !walletConnected}
              className="btn btn-secondary shrink-0"
              title={
                walletConnected
                  ? 'Builds the real swap for your address and simulates it on the RPC'
                  : 'Connect a wallet first'
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

      {/* ------------------------------------------------ scanner + risk */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="panel p-5">
          <SectionTitle icon={<Radar className="w-4 h-4 text-slate-500" />}>Scanner filters</SectionTitle>

          <div className="space-y-4">
            <Field label="Source">
              <select
                className="field"
                value={settings.launchPlatform}
                onChange={(e) => updateSettings({ launchPlatform: e.target.value as LaunchPlatform })}
              >
                <option value="all">All sources — Pump.fun stream and new DEX pools</option>
                <option value="pumpfun">Pump.fun launches only</option>
                <option value="dexscreener">DEX pools only — Raydium, Uniswap, Aerodrome…</option>
              </select>
            </Field>

            <Field label="Chain" hint="Live execution is Solana only. Other chains are always paper-traded.">
              <select
                className="field"
                value={settings.targetChain}
                onChange={(e) => updateSettings({ targetChain: e.target.value as ChainOption })}
              >
                <option value="all">All chains</option>
                <option value="solana">Solana</option>
                <option value="ethereum">Ethereum</option>
                <option value="base">Base</option>
                <option value="bsc">BNB Chain</option>
                <option value="arbitrum">Arbitrum</option>
              </select>
            </Field>

            <Field
              label={`Minimum bonding curve — ${settings.minBondingCurvePercent}%`}
              hint="0% buys at creation. Higher values wait for the curve to fill: less rug risk, worse entry."
            >
              <input
                type="range"
                min={0}
                max={95}
                step={5}
                value={settings.minBondingCurvePercent}
                onChange={(e) => updateSettings({ minBondingCurvePercent: Number(e.target.value) })}
                className="w-full accent-signal cursor-pointer"
                aria-label="Minimum bonding curve percent"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Min liquidity (USD)">
                <input
                  type="number"
                  min={0}
                  step={100}
                  className="field font-mono"
                  value={settings.minLiquidityUsd}
                  onChange={(e) => updateSettings({ minLiquidityUsd: Math.max(0, Number(e.target.value)) })}
                />
              </Field>
              <Field label="Max token age (min)">
                <input
                  type="number"
                  min={0}
                  className="field font-mono"
                  value={settings.maxTokenAgeMinutes}
                  onChange={(e) => updateSettings({ maxTokenAgeMinutes: Math.max(0, Number(e.target.value)) })}
                />
              </Field>
            </div>

            <Field
              label="Solana RPC endpoint"
              hint="The public endpoint is rate-limited. Use Helius or QuickNode for live trading."
            >
              <div className="relative">
                <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  className="field pl-9 font-mono text-xs"
                  value={settings.solanaRpcUrl}
                  placeholder="https://api.mainnet-beta.solana.com"
                  onChange={(e) => updateSettings({ solanaRpcUrl: e.target.value })}
                />
              </div>
            </Field>
          </div>
        </section>

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

            <div className="pt-1">
              <SwitchRow
                title="Automatic exits"
                description="Close a position as soon as take-profit, stop-loss or the trailing stop is hit."
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
      </div>

      {/* ------------------------------------------------ AI gate */}
      <section className="panel p-5">
        <SectionTitle icon={<Brain className="w-4 h-4 text-signal" />}>AI trade gate</SectionTitle>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-6 gap-y-1">
          <SwitchRow
            title="Review every buy"
            description="The model scores liquidity, order flow and momentum, then returns buy or skip with a confidence figure."
            checked={settings.aiGateEnabled}
            onChange={(v) => updateSettings({ aiGateEnabled: v })}
          />
          <SwitchRow
            title="Let the model set exits"
            description="Use the take-profit and stop-loss it suggests per token instead of your fixed values."
            checked={settings.aiAdjustTargets}
            onChange={(v) => updateSettings({ aiAdjustTargets: v })}
          />
          <div className="py-3">
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
            <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
              Buys below this score are skipped and logged with the reason.
            </p>
          </div>
        </div>

        <p className="text-[11px] text-slate-500 mt-3 pt-3 border-t border-line">
          Needs <code className="text-slate-300">ANTHROPIC_API_KEY</code> on the server, or an external model connected over
          MCP. Without either, the gate falls back to the built-in rule-based scorer.
        </p>
      </section>

      {/* ------------------------------------------------ MCP */}
      <BotMcpPanel />
    </div>
  );
};
