'use client';

import React from 'react';
import { RotateCcw } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useBotStore } from '@/store/useBotStore';

const Stat: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  tone?: 'default' | 'pos' | 'neg';
}> = ({ label, value, hint, action, tone = 'default' }) => (
  <div className="px-4 py-3.5 min-w-0">
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-slate-400 truncate">{label}</span>
      {action}
    </div>
    <div
      className={`mt-1 text-[19px] font-bold font-mono leading-tight truncate ${
        tone === 'pos' ? 'text-pos' : tone === 'neg' ? 'text-neg' : 'text-white'
      }`}
    >
      {value}
    </div>
    {hint && <div className="mt-0.5 text-[11px] text-slate-500 truncate">{hint}</div>}
  </div>
);

export const BotMetricsBar: React.FC = () => {
  const { settings, walletBalance, positions, resetWallet, getStats } = useBotStore(
    useShallow((s) => ({
      settings: s.settings,
      walletBalance: s.walletBalance,
      positions: s.positions,
      resetWallet: s.resetWallet,
      getStats: s.getStats,
    }))
  );

  const stats = getStats();
  const live = !settings.paperTrading;
  const pnlPositive = stats.totalProfitUsd >= 0;

  const platform =
    settings.launchPlatform === 'pumpfun' ? 'Pump.fun' : settings.launchPlatform === 'dexscreener' ? 'DEX pools' : 'All sources';

  return (
    <div className="panel mt-4 grid grid-cols-2 lg:grid-cols-5 divide-x divide-y lg:divide-y-0 divide-[rgba(255,255,255,0.06)]">
      <Stat
        label={live ? 'Wallet balance' : 'Paper balance'}
        value={live ? `${settings.solBalance.toFixed(3)} SOL` : `$${walletBalance.toFixed(2)}`}
        hint={live ? 'Live on-chain funds' : 'Simulated, real prices'}
        action={
          !live && (
            <button
              type="button"
              onClick={resetWallet}
              title="Reset paper balance to $1,000"
              aria-label="Reset paper balance"
              className="p-1 -mr-1 rounded-md text-slate-500 hover:text-white hover:bg-white/5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )
        }
      />
      <Stat
        label="Net P&L"
        value={`${pnlPositive ? '+' : '−'}$${Math.abs(stats.totalProfitUsd).toFixed(2)}`}
        hint="Realised + open"
        tone={pnlPositive ? 'pos' : 'neg'}
      />
      <Stat
        label="Open positions"
        value={`${positions.length} / ${settings.maxPositions}`}
        hint={settings.autoSell ? `TP +${settings.takeProfitPercent}% · SL −${settings.stopLossPercent}%` : 'Auto-sell off'}
      />
      <Stat label="Win rate" value={`${stats.winRate.toFixed(0)}%`} hint={`${stats.winningTrades}W · ${stats.losingTrades}L`} />
      <Stat
        label="Scanning"
        value={platform}
        hint={settings.targetChain === 'all' ? 'All chains' : `${settings.targetChain} only`}
      />
    </div>
  );
};
