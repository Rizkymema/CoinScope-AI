'use client';

import React from 'react';
import { Layers, Inbox, TrendingUp, TrendingDown, ExternalLink, Loader2, Brain, Pill } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useBotStore } from '@/store/useBotStore';
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
    <div className="lg:col-span-2 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-bold text-white flex items-center gap-2">
          <Layers className="w-4 h-4 text-slate-500" />
          Open positions
          <span className="text-slate-500 font-normal">({positions.length})</span>
        </h3>
        <span className="text-xs text-slate-500">
          {settings.autoSell
            ? `Auto TP +${settings.takeProfitPercent}% · SL −${settings.stopLossPercent}%${
                settings.trailingStopPercent ? ` · trail ${settings.trailingStopPercent}%` : ''
              }`
            : 'Auto-sell off'}
        </span>
      </div>

      {positions.length === 0 ? (
        <div className="panel flex flex-col items-center justify-center text-center px-6 py-14">
          <Inbox className="w-7 h-7 text-slate-600 mb-3" />
          <p className="text-white font-semibold text-[13px]">No open positions</p>
          <p className="text-[13px] text-slate-400 mt-1 max-w-sm leading-relaxed">
            {isActive
              ? 'The bot is watching the launch stream. Positions appear here once a token clears your filters and the AI gate.'
              : 'Start the bot, or buy a token manually from the New Launches feed or the AI chat.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {positions.map((pos) => {
            const profit = pos.pnlUsd >= 0;
            const range = pos.tpPriceUsd - pos.slPriceUsd;
            const progress = range > 0 ? Math.max(0, Math.min(100, ((pos.currentPriceUsd - pos.slPriceUsd) / range) * 100)) : 0;
            const busy = pendingTradeIds.includes(pos.id);
            const stale = !pos.lastPriceUpdateAt || Date.now() - pos.lastPriceUpdateAt > 60_000;

            return (
              <article key={pos.id} className="panel-interactive p-4">
                <div className="flex flex-col xl:flex-row xl:items-center gap-4">
                  {/* token */}
                  <div className="flex items-center gap-3 min-w-0 xl:w-60 shrink-0">
                    <CoinAvatar imageUrl={pos.coin.imageUrl} symbol={pos.coin.symbol} chainId={pos.coin.chainId} size="md" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-white text-[13px] truncate">{pos.coin.symbol}</span>
                        <ChainBadge chainId={pos.coin.chainId} />
                        <span className={pos.isLive ? 'chip chip-neg' : 'chip chip-warn'}>{pos.isLive ? 'LIVE' : 'PAPER'}</span>
                        {pos.coin.isPumpFun && (
                          <span className="chip chip-info" title="Pump.fun launch">
                            <Pill className="w-3 h-3" />
                            {pos.coin.graduated ? 'Graduated' : `${pos.coin.bondingCurve ?? 0}%`}
                          </span>
                        )}
                        {pos.aiDecision && (
                          <span className="chip chip-accent" title={pos.aiDecision.reason}>
                            <Brain className="w-3 h-3" />
                            {pos.aiDecision.confidence}%
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">
                        {pos.coin.name} · {timeAgo(pos.boughtAt)}
                        {stale ? ' · stale price' : ''}
                      </p>
                    </div>
                  </div>

                  {/* numbers */}
                  <dl className="grid grid-cols-3 gap-4 flex-1 min-w-0">
                    <div className="min-w-0">
                      <dt className="text-[11px] text-slate-500">Entry → now</dt>
                      <dd className="mt-0.5 text-[13px] font-mono text-white font-semibold truncate">
                        {formatPrice(pos.currentPriceUsd)}
                      </dd>
                      <dd className="text-[11px] font-mono text-slate-500 truncate">from {formatPrice(pos.buyPriceUsd)}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[11px] text-slate-500">Value / cost</dt>
                      <dd className="mt-0.5 text-[13px] font-mono text-white font-semibold truncate">
                        ${(pos.tokensBought * pos.currentPriceUsd).toFixed(2)}
                      </dd>
                      <dd className="text-[11px] font-mono text-slate-500 truncate">${pos.amountUsd.toFixed(2)} in</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[11px] text-slate-500">P&amp;L</dt>
                      <dd
                        className={`mt-0.5 inline-flex items-center gap-1 text-[13px] font-mono font-bold ${
                          profit ? 'text-pos' : 'text-neg'
                        }`}
                      >
                        {profit ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                        {profit ? '+' : '−'}
                        {Math.abs(pos.pnlPercent).toFixed(1)}%
                      </dd>
                      <dd className={`text-[11px] font-mono ${profit ? 'text-pos/70' : 'text-neg/70'}`}>
                        {profit ? '+' : '−'}${Math.abs(pos.pnlUsd).toFixed(2)}
                      </dd>
                    </div>
                  </dl>

                  {/* actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {pos.buyTxSignature && (
                      <a
                        href={WalletService.explorerUrl(pos.buyTxSignature)}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-sm btn-ghost"
                        title="View buy transaction on Solscan"
                      >
                        Tx
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {pos.coin.url && (
                      <a
                        href={pos.coin.url}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-sm btn-ghost"
                        title="Open chart on DexScreener"
                      >
                        Chart
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => closePosition(pos.id, 'MANUAL_SELL', 50)}
                      disabled={busy}
                      className="btn btn-sm btn-secondary"
                    >
                      Sell 50%
                    </button>
                    <button
                      type="button"
                      onClick={() => closePosition(pos.id, 'MANUAL_SELL', 100)}
                      disabled={busy}
                      className="btn btn-sm btn-danger"
                    >
                      {busy && <Loader2 className="w-3 h-3 animate-spin" />}
                      Sell all
                    </button>
                  </div>
                </div>

                {/* stop-loss → take-profit range */}
                <div className="mt-3.5 pt-3 border-t border-line flex items-center gap-3 text-[11px] font-mono">
                  <span className="text-neg shrink-0">SL {formatPrice(pos.slPriceUsd)}</span>
                  <div className="flex-1 h-1 rounded-full bg-ink-800 overflow-hidden" role="presentation">
                    <div
                      className={`h-full rounded-full transition-[width] duration-200 ${profit ? 'bg-pos' : 'bg-neg'}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="text-pos shrink-0">TP {formatPrice(pos.tpPriceUsd)}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
