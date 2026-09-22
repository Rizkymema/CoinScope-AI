'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Zap, ExternalLink, Loader2, Inbox } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { CoinData } from '@/types/coin';
import { CoinService } from '@/services/coin.service';
import { useCoinStore } from '@/store/useCoinStore';
import { useBotStore } from '@/store/useBotStore';
import { CoinAvatar, ChainBadge, formatNumber, formatPrice, timeAgo } from './CoinAvatar';
import { FilterType } from './FilterTabs';

/** Honest one-line description of what each filter actually sorts by. */
const FILTER_NOTE: Record<FilterType, string> = {
  movers: 'Sorted by absolute 24h price change.',
  trending: 'Sorted by 24h trading volume.',
  mayhem: '24h move above 2%, largest first.',
  live: 'Highest volume right now.',
  new: 'Most recent pool creation first.',
  'market-cap': 'Largest market cap first.',
  agents: 'Tokens up over the last 24h.',
  oldest: 'Largest market cap first.',
};

function sortCoins(coins: CoinData[], filter: FilterType): CoinData[] {
  const list = [...coins];
  switch (filter) {
    case 'movers':
      return list.sort((a, b) => Math.abs(b.priceChange24h) - Math.abs(a.priceChange24h));
    case 'mayhem':
      return list.filter((c) => Math.abs(c.priceChange24h) > 2).sort((a, b) => Math.abs(b.priceChange24h) - Math.abs(a.priceChange24h));
    case 'new':
      return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    case 'market-cap':
    case 'oldest':
      return list.sort((a, b) => b.fundamentals.marketCap - a.fundamentals.marketCap);
    case 'agents':
      return list.filter((c) => c.priceChange24h > 0).sort((a, b) => b.priceChange24h - a.priceChange24h);
    case 'trending':
    case 'live':
    default:
      return list.sort((a, b) => b.fundamentals.volume24h - a.fundamentals.volume24h);
  }
}

const Change: React.FC<{ value?: number; small?: boolean }> = ({ value, small }) => {
  if (value === undefined || value === null || value === 0) return <span className="text-slate-600">—</span>;
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-1 font-mono font-semibold ${up ? 'text-pos' : 'text-neg'}`}>
      {!small && (up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />)}
      {up ? '+' : '−'}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
};

const TrendingCoinsGridComponent: React.FC<{ activeFilter?: FilterType }> = ({ activeFilter = 'trending' }) => {
  const [coins, setCoins] = useState<CoinData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const selectCoinDirect = useCoinStore((s) => s.selectCoinDirect);
  const selectedId = useCoinStore((s) => s.selectedCoin?.id);
  const { manualSnipeCoin, pendingTradeIds, buyAmountUsd, paperTrading } = useBotStore(
    useShallow((s) => ({
      manualSnipeCoin: s.manualSnipeCoin,
      pendingTradeIds: s.pendingTradeIds,
      buyAmountUsd: s.settings.buyAmountUsd,
      paperTrading: s.settings.paperTrading,
    }))
  );

  useEffect(() => {
    let mounted = true;
    const fetchTop = async () => {
      const data = await CoinService.getTopCoins({ limit: 140 });
      if (!mounted) return;
      setCoins(data);
      setIsLoading(false);
    };
    fetchTop();
    const id = setInterval(fetchTop, 10_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const rows = useMemo(() => sortCoins(coins, activeFilter).slice(0, 60), [coins, activeFilter]);

  if (isLoading) {
    return (
      <div className="panel overflow-hidden">
        <div className="h-11 border-b border-line bg-ink-850/40" />
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-14 border-b border-line last:border-b-0 flex items-center gap-3 px-4">
            <div className="w-7 h-7 rounded-full bg-ink-850 animate-pulse" />
            <div className="h-3 w-24 rounded bg-ink-850 animate-pulse" />
            <div className="ml-auto h-3 w-16 rounded bg-ink-850 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <section className="space-y-2">
      <p className="text-[11px] text-slate-500">{FILTER_NOTE[activeFilter]}</p>

      <div className="panel overflow-hidden">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <Inbox className="w-7 h-7 text-slate-600 mb-3" />
            <p className="text-[13px] font-semibold text-slate-300">Nothing matches this filter</p>
            <p className="text-xs text-slate-500 mt-1">Try another tab above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] min-w-[900px]">
              <thead>
                <tr className="thead border-b border-line bg-ink-850/40">
                  <th className="py-2.5 pl-4 pr-2 font-semibold w-10 text-right">#</th>
                  <th className="py-2.5 px-3 font-semibold w-[30%]">Token</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Price</th>
                  <th className="py-2.5 px-3 font-semibold text-right">5m</th>
                  <th className="py-2.5 px-3 font-semibold text-right">24h</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Volume 24h</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Market cap</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Buys / sells</th>
                  <th className="py-2.5 pl-3 pr-4 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((coin, i) => {
                  const busy = pendingTradeIds.includes(coin.id);
                  const active = selectedId === coin.id;
                  return (
                    <tr
                      key={coin.id}
                      onClick={() => selectCoinDirect(coin)}
                      aria-selected={active}
                      className={`row cursor-pointer ${active ? 'bg-signal/[0.06]' : ''}`}
                    >
                      <td className="py-2.5 pl-4 pr-2 text-right font-mono text-[11px] text-slate-600">{i + 1}</td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <CoinAvatar imageUrl={coin.imageUrl} symbol={coin.symbol} chainId={coin.chainId} size="sm" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-white truncate">{coin.symbol}</span>
                              <ChainBadge chainId={coin.chainId} />
                            </div>
                            <p className="text-[11px] text-slate-500 truncate mt-0.5">
                              {coin.name}
                              {coin.createdAt ? ` · ${timeAgo(coin.createdAt)}` : ''}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-white font-semibold whitespace-nowrap">
                        {formatPrice(coin.priceUsd)}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <Change value={coin.priceChange5m} small />
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <Change value={coin.priceChange24h} />
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-300 whitespace-nowrap">
                        {formatNumber(coin.fundamentals.volume24h)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-300 whitespace-nowrap">
                        {formatNumber(coin.fundamentals.marketCap)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-[11px] whitespace-nowrap">
                        {coin.txns24h ? (
                          <>
                            <span className="text-pos">{coin.txns24h.buys}</span>
                            <span className="text-slate-600"> / </span>
                            <span className="text-neg">{coin.txns24h.sells}</span>
                          </>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pl-3 pr-4">
                        <div className="flex items-center justify-end gap-1.5">
                          {coin.url && (
                            <a
                              href={coin.url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Open ${coin.symbol} chart on DexScreener`}
                              className="p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-white/5 transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              manualSnipeCoin(coin, undefined, 'market');
                            }}
                            title={`Buy $${buyAmountUsd} of ${coin.symbol} (${paperTrading ? 'paper' : 'live'})`}
                            className="btn btn-sm btn-secondary"
                          >
                            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                            Buy
                          </button>
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
    </section>
  );
};

export const TrendingCoinsGrid = React.memo(TrendingCoinsGridComponent);
