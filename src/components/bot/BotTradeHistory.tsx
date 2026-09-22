'use client';

import React from 'react';
import { History, ExternalLink } from 'lucide-react';
import { WalletService } from '@/services/wallet.service';
import { useBotStore } from '@/store/useBotStore';
import { ChainBadge } from '../CoinAvatar';
import { formatPrice } from '@/lib/formatters';

export const BotTradeHistory: React.FC = () => {
  const { history } = useBotStore();

  return (
    <div className="bg-ink-900/80 border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-xl space-y-4">
      <h3 className="font-display text-lg font-bold text-white flex items-center gap-2">
        <History className="w-5 h-5 text-signal-soft" />
        Completed Auto-Trade Log ({history.length})
      </h3>

      {history.length === 0 ? (
        <div className="text-center py-16 text-slate-500 text-sm">
          No completed trades yet. Closed positions will appear here with realized PnL details.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 uppercase tracking-wider text-[10px]">
                <th className="py-3 px-4">Token</th>
                <th className="py-3 px-4">Chain</th>
                <th className="py-3 px-4">Invested</th>
                <th className="py-3 px-4">Buy Price</th>
                <th className="py-3 px-4">Exit Price</th>
                <th className="py-3 px-4">Realized PnL</th>
                <th className="py-3 px-4">Exit Reason</th>
                <th className="py-3 px-4">Mode</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {history.map((item) => {
                const isWin = item.pnlUsd >= 0;
                return (
                  <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3.5 px-4 font-bold text-white">
                      ${item.coinSymbol}{' '}
                      <span className="text-slate-400 font-normal font-sans">({item.coinName})</span>
                    </td>
                    <td className="py-3.5 px-4">
                      <ChainBadge chainId={item.chainId} />
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-300">${item.amountUsd.toFixed(2)}</td>
                    <td className="py-3.5 px-4 font-mono text-slate-400">{formatPrice(item.buyPriceUsd)}</td>
                    <td className="py-3.5 px-4 font-mono text-white">{formatPrice(item.sellPriceUsd)}</td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`font-mono font-bold px-2 py-0.5 rounded ${
                          isWin
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        {isWin ? '+' : ''}
                        {item.pnlPercent.toFixed(1)}% (${item.pnlUsd.toFixed(2)})
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-white/5 text-slate-300">
                        {item.exitReason.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${item.isLive ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/15 text-amber-300'}`}>
                          {item.isLive ? 'LIVE' : 'PAPER'}
                        </span>
                        {item.sellTxSignature && (
                          <a href={WalletService.explorerUrl(item.sellTxSignature)} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-white" title="Sell tx on Solscan">
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
