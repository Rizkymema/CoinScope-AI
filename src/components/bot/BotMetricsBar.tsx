'use client';

import React from 'react';
import { Wallet, RotateCcw, TrendingUp, TrendingDown, Layers, Globe, Sparkles } from 'lucide-react';
import { useBotStore } from '@/store/useBotStore';

export const BotMetricsBar: React.FC = () => {
  const { settings, walletBalance, positions, resetWallet, getStats } = useBotStore();
  const stats = getStats();
  const isPnlPositive = stats.totalProfitUsd >= 0;

  return (
    <div className="mt-8 pt-6 border-t border-white/10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      {/* Virtual / Real Wallet Balance */}
      <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-4">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span className="flex items-center gap-1.5 font-medium">
            <Wallet className="w-3.5 h-3.5 text-amber-400" />
            {settings.phantomWalletConnected ? 'Phantom Balance' : 'Demo Balance'}
          </span>
          {!settings.phantomWalletConnected && (
            <button
              onClick={resetWallet}
              title="Reset demo wallet balance to $1,000"
              className="hover:text-amber-400 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="text-xl font-extrabold text-white font-mono">
          {settings.phantomWalletConnected
            ? `${settings.solBalance.toFixed(3)} SOL`
            : `$${walletBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">
          {settings.phantomWalletConnected
            ? '⚡ Phantom Live Wallet Active'
            : settings.paperTrading
            ? '🧪 Paper Trading Mode'
            : 'Live Execution'}
        </div>
      </div>

      {/* Total Net Profit */}
      <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-4">
        <div className="text-xs text-slate-400 mb-1 font-medium flex items-center gap-1.5">
          {isPnlPositive ? (
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <TrendingDown className="w-3.5 h-3.5 text-red-400" />
          )}
          Total Net PnL
        </div>
        <div
          className={`text-xl font-extrabold font-mono ${
            isPnlPositive ? 'text-emerald-400' : 'text-red-400'
          }`}
        >
          {isPnlPositive ? '+' : ''}
          ${stats.totalProfitUsd.toFixed(2)}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">
          Realized & Unrealized PnL
        </div>
      </div>

      {/* Active Positions */}
      <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-4">
        <div className="text-xs text-slate-400 mb-1 font-medium flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-signal-soft" />
          Active Positions
        </div>
        <div className="text-xl font-extrabold text-white font-mono">
          {positions.length} / {settings.maxPositions}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">Open Trade Holdings</div>
      </div>

      {/* Target Launchpad */}
      <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-4">
        <div className="text-xs text-slate-400 mb-1 font-medium flex items-center gap-1.5">
          <Globe className="w-3.5 h-3.5 text-purple-400" />
          Target Platform
        </div>
        <div className="text-xl font-extrabold text-white uppercase font-mono">
          {settings.launchPlatform === 'pumpfun'
            ? '💊 Pump.fun'
            : settings.launchPlatform === 'dexscreener'
            ? '🦅 DEX Only'
            : 'All Launchpads'}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">
          Snipe Size: ${settings.buyAmountUsd} / trade
        </div>
      </div>

      {/* Win Rate */}
      <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-4 col-span-2 sm:col-span-1">
        <div className="text-xs text-slate-400 mb-1 font-medium flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          Win Rate
        </div>
        <div className="text-xl font-extrabold text-white font-mono">
          {stats.winRate.toFixed(1)}%
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">
          {stats.winningTrades} W / {stats.losingTrades} L ({stats.totalTrades} total)
        </div>
      </div>
    </div>
  );
};
