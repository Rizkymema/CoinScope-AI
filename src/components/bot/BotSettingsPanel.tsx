'use client';

import React from 'react';
import { Flame, Server, DollarSign, ShieldAlert, Brain, Wallet, AlertTriangle, FlaskConical, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useBotStore } from '@/store/useBotStore';
import { ChainOption, LaunchPlatform } from '@/types/bot';

const inputCls =
  'w-full bg-ink-950 border border-white/10 focus:border-signal rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none transition-all';
const labelCls = 'block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2';

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; color?: string }> = ({ checked, onChange, color = 'peer-checked:bg-emerald-500' }) => (
  <label className="relative inline-flex items-center cursor-pointer shrink-0">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
    <div
      className={`w-12 h-6 bg-slate-700 rounded-full peer after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full ${color}`}
    />
  </label>
);

export const BotSettingsPanel: React.FC = () => {
  const { settings, updateSettings, dryRunLiveTrade, lastDryRun, isDryRunning } = useBotStore();
  const walletConnected = settings.phantomWalletConnected;

  return (
    <div className="space-y-8">
      {/* EXECUTION MODE */}
      <div
        className={`rounded-3xl border p-6 md:p-8 backdrop-blur-xl flex flex-col md:flex-row md:items-center justify-between gap-6 ${
          settings.paperTrading ? 'bg-ink-900/80 border-white/10' : 'bg-gradient-to-r from-rose-950/40 to-amber-950/30 border-rose-500/40'
        }`}
      >
        <div className="space-y-1">
          <h3 className="font-display text-lg font-bold text-white flex items-center gap-2">
            <Wallet className="w-5 h-5 text-amber-400" />
            Execution Mode: {settings.paperTrading ? '🧪 Paper Trading' : '🔴 LIVE (real funds)'}
          </h3>
          <p className="text-sm text-slate-400 max-w-2xl">
            {settings.paperTrading
              ? 'Simulated fills with a $1,000 virtual balance. Prices are real (Pump.fun stream + DexScreener), only the money is virtual.'
              : 'Every buy/sell is a real Solana swap signed by your wallet (Jupiter routing incl. Pump.fun bonding curves, PumpPortal as fallback). EVM chains stay paper-only.'}
          </p>
          {!walletConnected && !settings.paperTrading && (
            <p className="text-xs text-rose-300 flex items-center gap-1.5 mt-2">
              <AlertTriangle className="w-3.5 h-3.5" /> No wallet connected - the bot will refuse to start in live mode.
            </p>
          )}

          {/* DRY RUN */}
          <div className="mt-4 pt-4 border-t border-white/10 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <button
                onClick={() => dryRunLiveTrade()}
                disabled={isDryRunning || !walletConnected}
                className="px-4 py-2.5 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-2 bg-teal-500/15 hover:bg-teal-500/30 text-teal-200 border-teal-500/40 disabled:opacity-50"
                title={walletConnected ? 'Builds the real swap for your wallet address and simulates it on the RPC. Nothing is signed.' : 'Connect a wallet first'}
              >
                {isDryRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
                Test live pipeline (dry run, ${settings.buyAmountUsd})
              </button>
              <span className="text-[11px] text-slate-500">
                Builds a real Jupiter / PumpPortal swap for your address and simulates it on the RPC. No signature, no funds moved.
              </span>
            </div>
            {lastDryRun && (
              <div className={`rounded-xl border p-3 text-xs font-mono ${lastDryRun.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200' : 'bg-rose-500/10 border-rose-500/30 text-rose-200'}`}>
                <div className="flex items-start gap-2">
                  {lastDryRun.success ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                  <div className="space-y-1 min-w-0">
                    <div className="break-words">{lastDryRun.symbol}: {lastDryRun.message}</div>
                    {lastDryRun.attempts.map((a, i) => (
                      <div key={i} className="text-[10px] opacity-80 break-words">
                        {a.ok ? '✓' : '✗'} {a.route}: {a.detail}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 bg-ink-950/80 border border-white/10 p-4 rounded-xl shrink-0">
          <div className="text-right">
            <div className="text-xs font-bold text-white uppercase tracking-wider">Live trading</div>
            <div className="text-[11px] text-slate-400">{walletConnected ? `${settings.walletType} ${settings.solBalance.toFixed(3)} SOL` : 'Connect a wallet first'}</div>
          </div>
          <Toggle
            checked={!settings.paperTrading}
            onChange={(live) => {
              if (live && !walletConnected) return;
              updateSettings({ paperTrading: !live });
            }}
            color="peer-checked:bg-rose-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 bg-ink-900/80 border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-xl">
        {/* SCANNER & LAUNCHPAD */}
        <div className="space-y-6">
          <h3 className="font-display text-lg font-bold text-white flex items-center gap-2 border-b border-white/10 pb-3">
            <Flame className="w-5 h-5 text-amber-400" />
            Scanner & Launchpad Filters
          </h3>

          <div>
            <label className={labelCls}>Target Launchpad</label>
            <select
              value={settings.launchPlatform}
              onChange={(e) => updateSettings({ launchPlatform: e.target.value as LaunchPlatform })}
              className="w-full bg-ink-950 border border-purple-500/40 focus:border-purple-400 rounded-xl px-4 py-3 text-purple-300 text-sm font-semibold focus:outline-none transition-all"
            >
              <option value="all">🌐 All sources (Pump.fun stream + new DEX pools)</option>
              <option value="pumpfun">💊 Pump.fun launches only (Solana)</option>
              <option value="dexscreener">🦅 DEX pools only (Raydium, Uniswap, Aerodrome, ...)</option>
            </select>
          </div>

          <div>
            <label className={labelCls}>Target Chain</label>
            <select value={settings.targetChain} onChange={(e) => updateSettings({ targetChain: e.target.value as ChainOption })} className={inputCls}>
              <option value="all">All chains (live execution: Solana only)</option>
              <option value="solana">Solana only</option>
              <option value="ethereum">Ethereum only (paper)</option>
              <option value="base">Base only (paper)</option>
              <option value="bsc">BNB Chain only (paper)</option>
              <option value="arbitrum">Arbitrum only (paper)</option>
            </select>
          </div>

          <div>
            <label className={labelCls}>Pump.fun min bonding-curve progress (%)</label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="0"
                max="95"
                step="5"
                value={settings.minBondingCurvePercent}
                onChange={(e) => updateSettings({ minBondingCurvePercent: Number(e.target.value) })}
                className="flex-1 accent-purple-400 cursor-pointer"
              />
              <span className="font-mono text-purple-300 font-bold text-sm w-12 text-right">{settings.minBondingCurvePercent}%</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">0% = snipe at creation. Higher values wait for the curve to fill (less rug risk, worse entry).</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Min liquidity ($)</label>
              <input type="number" step="100" min="0" value={settings.minLiquidityUsd} onChange={(e) => updateSettings({ minLiquidityUsd: Math.max(0, Number(e.target.value)) })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Max token age (min)</label>
              <input type="number" min="0" value={settings.maxTokenAgeMinutes} onChange={(e) => updateSettings({ maxTokenAgeMinutes: Math.max(0, Number(e.target.value)) })} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Solana RPC endpoint</label>
            <div className="relative">
              <Server className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={settings.solanaRpcUrl}
                onChange={(e) => updateSettings({ solanaRpcUrl: e.target.value })}
                placeholder="https://api.mainnet-beta.solana.com"
                className={`${inputCls} pl-9 text-xs`}
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">Public RPC is rate-limited. Use Helius / QuickNode for reliable live execution.</p>
          </div>
        </div>

        {/* RISK MANAGEMENT */}
        <div className="space-y-6">
          <h3 className="font-display text-lg font-bold text-white flex items-center gap-2 border-b border-white/10 pb-3">
            <ShieldAlert className="w-5 h-5 text-emerald-400" />
            Position Sizing & Risk
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Buy size per trade (USD)</label>
              <div className="relative">
                <DollarSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="number" min="1" value={settings.buyAmountUsd} onChange={(e) => updateSettings({ buyAmountUsd: Math.max(1, Number(e.target.value)) })} className={`${inputCls} pl-9`} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Max open positions</label>
              <input type="number" min="1" max="50" value={settings.maxPositions} onChange={(e) => updateSettings({ maxPositions: Math.max(1, Number(e.target.value)) })} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Take profit (+%)</label>
              <input
                type="number"
                min="5"
                value={settings.takeProfitPercent}
                onChange={(e) => updateSettings({ takeProfitPercent: Math.max(1, Number(e.target.value)) })}
                className={`${inputCls} border-emerald-500/30 text-emerald-400 font-bold`}
              />
            </div>
            <div>
              <label className={labelCls}>Stop loss (-%)</label>
              <input
                type="number"
                min="5"
                max="95"
                value={settings.stopLossPercent}
                onChange={(e) => updateSettings({ stopLossPercent: Math.min(95, Math.max(1, Number(e.target.value))) })}
                className={`${inputCls} border-red-500/30 text-red-400 font-bold`}
              />
            </div>
            <div>
              <label className={labelCls}>Trailing stop (%)</label>
              <input
                type="number"
                min="0"
                max="90"
                value={settings.trailingStopPercent}
                onChange={(e) => updateSettings({ trailingStopPercent: Math.min(90, Math.max(0, Number(e.target.value))) })}
                className={`${inputCls} border-amber-500/30 text-amber-300`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Slippage (%)</label>
              <input type="number" min="0.5" max="50" step="0.5" value={settings.slippagePercent} onChange={(e) => updateSettings({ slippagePercent: Math.max(0.5, Number(e.target.value)) })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Priority fee (SOL)</label>
              <input type="number" min="0" max="0.1" step="0.0001" value={settings.priorityFeeSol} onChange={(e) => updateSettings({ priorityFeeSol: Math.max(0, Number(e.target.value)) })} className={inputCls} />
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-ink-950 border border-white/10 rounded-xl">
            <div>
              <span className="font-semibold text-white text-sm block">Auto take-profit / stop-loss</span>
              <span className="text-xs text-slate-400">Close positions automatically when TP, SL or the trailing stop is hit.</span>
            </div>
            <Toggle checked={settings.autoSell} onChange={(v) => updateSettings({ autoSell: v })} />
          </div>

          <div className="flex items-center justify-between p-4 bg-ink-950 border border-white/10 rounded-xl">
            <div>
              <span className="font-semibold text-white text-sm block">Sound alerts</span>
              <span className="text-xs text-slate-400">Chime on buys and TP / SL hits.</span>
            </div>
            <Toggle checked={settings.soundAlerts} onChange={(v) => updateSettings({ soundAlerts: v })} />
          </div>
        </div>
      </div>

      {/* AI GATE */}
      <div className="bg-ink-900/80 border border-signal/30 rounded-3xl p-6 md:p-8 backdrop-blur-xl space-y-6">
        <h3 className="font-display text-lg font-bold text-white flex items-center gap-2 border-b border-white/10 pb-3">
          <Brain className="w-5 h-5 text-signal-soft" />
          AI Trade Gate (Claude)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="flex items-center justify-between p-4 bg-ink-950 border border-white/10 rounded-xl">
            <div>
              <span className="font-semibold text-white text-sm block">Ask AI before every buy</span>
              <span className="text-xs text-slate-400">Claude reviews liquidity, flow and momentum and returns BUY / SKIP with confidence.</span>
            </div>
            <Toggle checked={settings.aiGateEnabled} onChange={(v) => updateSettings({ aiGateEnabled: v })} color="peer-checked:bg-teal-500" />
          </div>
          <div>
            <label className={labelCls}>Min AI confidence (%)</label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={settings.aiMinConfidence}
                onChange={(e) => updateSettings({ aiMinConfidence: Number(e.target.value) })}
                className="flex-1 accent-teal-400 cursor-pointer"
              />
              <span className="font-mono text-teal-300 font-bold text-sm w-12 text-right">{settings.aiMinConfidence}%</span>
            </div>
          </div>
          <div className="flex items-center justify-between p-4 bg-ink-950 border border-white/10 rounded-xl">
            <div>
              <span className="font-semibold text-white text-sm block">Let AI set TP / SL</span>
              <span className="text-xs text-slate-400">Use the AI-suggested targets per token instead of the fixed values.</span>
            </div>
            <Toggle checked={settings.aiAdjustTargets} onChange={(v) => updateSettings({ aiAdjustTargets: v })} color="peer-checked:bg-teal-500" />
          </div>
        </div>
        <p className="text-[11px] text-slate-500">
          Requires <code className="text-slate-300">ANTHROPIC_API_KEY</code> on the server. Without it the gate falls back to the built-in rule-based scorer.
        </p>
      </div>
    </div>
  );
};
