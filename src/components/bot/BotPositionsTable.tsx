'use client';

import React from 'react';
import { Layers, Zap, TrendingUp, TrendingDown, ArrowUpRight, ExternalLink, Loader2, Brain } from 'lucide-react';
import { useBotStore } from '@/store/useBotStore';
import { useShallow } from 'zustand/react/shallow';
import { CoinAvatar, ChainBadge } from '../CoinAvatar';
import { formatPrice, timeAgo } from '@/lib/formatters';
import { WalletService } from '@/services/wallet.service';

export const BotPositionsTable: React.FC = () => {
  const { positions, settings, isActive, pendingTradeIds, closePosition } = useBotStore(
    useShallow((s) => ({
      positions: s.positions,
      settings: s.settings,
      isActive: s.isActive,
      pendingTradeIds: s.pendingTradeIds,
      closePosition: s.closePosition,
    }))
  );

  return (
    <div className="lg:col-span-2 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold text-white flex items-center gap-2">
          <Layers className="w-5 h-5 text-signal-soft" />
          Open Positions ({positions.length})
        </h3>
        <span className="text-xs text-slate-400">
          {settings.autoSell ? `Auto TP +${settings.takeProfitPercent}% / SL -${settings.stopLossPercent}%${settings.trailingStopPercent ? ` / trail ${settings.trailingStopPercent}%` : ''}` : 'Auto-sell OFF'}
        </span>
      </div>

      {positions.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 bg-ink-900/60 border border-white/8 rounded-2xl text-center">
          <div className="p-4 rounded-full bg-white/5 mb-3">
            <Zap className="w-8 h-8 text-slate-500" />
          </div>
          <h4 className="text-white font-bold text-base mb-1">No open positions</h4>
          <p className="text-slate-400 text-sm max-w-sm">
            {isActive
              ? 'The bot is scanning the Pump.fun stream and new DEX pools. Positions appear here as soon as a launch passes your filters (and the AI gate).'
              : 'Start the bot, or snipe a coin manually from the New Coins feed / AI chat.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {positions.map((pos) => {
            const isProfit = pos.pnlUsd >= 0;
            const range = pos.tpPriceUsd - pos.slPriceUsd;
            const progress = range > 0 ? ((pos.currentPriceUsd - pos.slPriceUsd) / range) * 100 : 0;
            const clamped = Math.max(0, Math.min(100, progress));
            const busy = pendingTradeIds.includes(pos.id);
            const stale = !pos.lastPriceUpdateAt || Date.now() - pos.lastPriceUpdateAt > 60_000;

            return (
              <div key={pos.id} className={`bg-ink-900/80 border rounded-2xl p-5 transition-all duration-300 shadow-lg ${pos.isLive ? 'border-rose-500/30 hover:border-rose-400/50' : 'border-white/10 hover:border-white/20'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <CoinAvatar imageUrl={pos.coin.imageUrl} symbol={pos.coin.symbol} chainId={pos.coin.chainId} size="lg" showChain={true} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-white text-base">{pos.coin.symbol}</span>
                        <ChainBadge chainId={pos.coin.chainId} />
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${pos.isLive ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}`}>
                          {pos.isLive ? 'LIVE' : 'PAPER'}
                        </span>
                        {pos.coin.isPumpFun && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                            💊 {pos.coin.graduated ? 'Graduated' : `Curve ${pos.coin.bondingCurve ?? 0}%`}
                          </span>
                        )}
                        {pos.aiDecision && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-500/15 text-teal-300 border border-teal-500/30 flex items-center gap-1" title={pos.aiDecision.reason}>
                            <Brain className="w-3 h-3" /> {pos.aiDecision.confidence}%
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400 truncate block">
                        {pos.coin.name} · opened {timeAgo(pos.boughtAt)}
                        {stale ? ' · price stale' : pos.priceSource ? ` · ${pos.priceSource}` : ''}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 text-right sm:flex sm:items-center sm:gap-6">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Entry / Now</div>
                      <div className="text-xs font-mono text-slate-300 font-medium mt-0.5">{formatPrice(pos.buyPriceUsd)}</div>
                      <div className="text-xs font-mono text-white font-bold">{formatPrice(pos.currentPriceUsd)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Value / Cost</div>
                      <div className="text-xs font-mono text-white font-bold mt-0.5">${(pos.tokensBought * pos.currentPriceUsd).toFixed(2)}</div>
                      <div className="text-[11px] font-mono text-slate-400">${pos.amountUsd.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">PnL</div>
                      <div className={`inline-flex items-center gap-1 text-sm font-bold font-mono px-2 py-0.5 rounded-lg mt-0.5 ${isProfit ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                        {isProfit ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                        {isProfit ? '+' : ''}
                        {pos.pnlPercent.toFixed(1)}% (${pos.pnlUsd.toFixed(2)})
                      </div>
                    </div>

                    <div className="col-span-3 sm:col-span-1 flex items-center justify-end gap-2 flex-wrap">
                      {pos.buyTxSignature && (
                        <a href={WalletService.explorerUrl(pos.buyTxSignature)} target="_blank" rel="noreferrer" className="px-2.5 py-1.5 bg-white/5 hover:bg-white/15 text-slate-300 border border-white/10 rounded-xl text-xs font-bold flex items-center gap-1" title="View buy transaction on Solscan">
                          Tx <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {pos.coin.pumpFunUrl && (
                        <a href={pos.coin.pumpFunUrl} target="_blank" rel="noreferrer" className="px-2.5 py-1.5 bg-purple-500/15 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 rounded-xl text-xs font-bold flex items-center gap-1">
                          💊 <ArrowUpRight className="w-3 h-3" />
                        </a>
                      )}
                      {pos.coin.url && (
                        <a href={pos.coin.url} target="_blank" rel="noreferrer" className="px-2.5 py-1.5 bg-white/5 hover:bg-white/15 text-slate-300 border border-white/10 rounded-xl text-xs font-bold flex items-center gap-1" title="DexScreener">
                          DEX <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      <button
                        onClick={() => closePosition(pos.id, 'MANUAL_SELL', 50)}
                        disabled={busy}
                        className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
                      >
                        Sell 50%
                      </button>
                      <button
                        onClick={() => closePosition(pos.id, 'MANUAL_SELL', 100)}
                        disabled={busy}
                        className="px-3 py-1.5 bg-red-500/15 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded-xl text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-1"
                      >
                        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                        Sell all
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-400">
                  <span className="text-red-400 font-mono">SL {formatPrice(pos.slPriceUsd)}</span>
                  <div className="flex-1 mx-4 bg-slate-800 rounded-full h-1.5 overflow-hidden relative">
                    <div className={`h-full transition-all duration-500 ${isProfit ? 'bg-emerald-400' : 'bg-red-400'}`} style={{ width: `${clamped}%` }} />
                  </div>
                  <span className="text-emerald-400 font-mono">TP {formatPrice(pos.tpPriceUsd)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
