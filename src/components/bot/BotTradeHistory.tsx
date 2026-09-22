'use client';

import React from 'react';
import { History, ExternalLink } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useBotStore } from '@/store/useBotStore';
import { ChainBadge } from '../CoinAvatar';
import { formatPrice } from '@/lib/formatters';
import { WalletService } from '@/services/wallet.service';

const EXIT_LABEL: Record<string, string> = {
  TP_HIT: 'Take profit',
  SL_HIT: 'Stop loss',
  TRAILING_STOP: 'Trailing stop',
  MANUAL_SELL: 'Manual',
  AI_SELL: 'AI',
};

export const BotTradeHistory: React.FC = () => {
  const { history, stats } = useBotStore(useShallow((s) => ({ history: s.history, stats: s.getStats() })));

  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-5 py-4 border-b border-line">
        <h3 className="text-[15px] font-bold text-white flex items-center gap-2">
          <History className="w-4 h-4 text-slate-500" />
          Closed trades <span className="text-slate-500 font-normal">({history.length})</span>
        </h3>
        {history.length > 0 && (
          <div className="flex items-center gap-4 text-xs">
            <span className="text-slate-500">
              Win rate <span className="text-slate-200 font-semibold font-mono">{stats.winRate.toFixed(0)}%</span>
            </span>
            <span className="text-slate-500">
              Realised{' '}
              <span className={`font-semibold font-mono ${stats.totalProfitUsd >= 0 ? 'text-pos' : 'text-neg'}`}>
                {stats.totalProfitUsd >= 0 ? '+' : '−'}${Math.abs(stats.totalProfitUsd).toFixed(2)}
              </span>
            </span>
          </div>
        )}
      </header>

      {history.length === 0 ? (
        <p className="text-center py-16 text-[13px] text-slate-500">
          No closed trades yet. Positions appear here with realised P&amp;L once they are sold.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="thead border-b border-line">
                <th className="py-2.5 px-5 font-semibold">Token</th>
                <th className="py-2.5 px-3 font-semibold">Chain</th>
                <th className="py-2.5 px-3 font-semibold text-right">Invested</th>
                <th className="py-2.5 px-3 font-semibold text-right">Entry</th>
                <th className="py-2.5 px-3 font-semibold text-right">Exit</th>
                <th className="py-2.5 px-3 font-semibold text-right">P&amp;L</th>
                <th className="py-2.5 px-3 font-semibold">Reason</th>
                <th className="py-2.5 px-5 font-semibold">Mode</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => {
                const win = item.pnlUsd >= 0;
                return (
                  <tr key={item.id} className="row">
                    <td className="py-3 px-5">
                      <span className="font-semibold text-white">{item.coinSymbol}</span>
                      <span className="text-slate-500 ml-1.5 text-xs">{item.coinName}</span>
                    </td>
                    <td className="py-3 px-3">
                      <ChainBadge chainId={item.chainId} />
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-slate-300">${item.amountUsd.toFixed(2)}</td>
                    <td className="py-3 px-3 text-right font-mono text-slate-500">{formatPrice(item.buyPriceUsd)}</td>
                    <td className="py-3 px-3 text-right font-mono text-slate-300">{formatPrice(item.sellPriceUsd)}</td>
                    <td className={`py-3 px-3 text-right font-mono font-bold ${win ? 'text-pos' : 'text-neg'}`}>
                      {win ? '+' : '−'}
                      {Math.abs(item.pnlPercent).toFixed(1)}%
                      <span className="block text-[11px] font-normal opacity-70">
                        {win ? '+' : '−'}${Math.abs(item.pnlUsd).toFixed(2)}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-400 text-xs">{EXIT_LABEL[item.exitReason] ?? item.exitReason}</td>
                    <td className="py-3 px-5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={item.isLive ? 'chip chip-neg' : 'chip chip-warn'}>
                          {item.isLive ? 'LIVE' : 'PAPER'}
                        </span>
                        {item.sellTxSignature && (
                          <a
                            href={WalletService.explorerUrl(item.sellTxSignature)}
                            target="_blank"
                            rel="noreferrer"
                            title="Sell transaction on Solscan"
                            className="text-slate-500 hover:text-white transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
