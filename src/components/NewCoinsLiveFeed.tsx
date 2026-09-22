'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Zap, Clock, RefreshCw, Radio, Loader2, Pill, Waves, Inbox } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { CoinService } from '@/services/coin.service';
import { useCoinStore } from '@/store/useCoinStore';
import { useBotStore } from '@/store/useBotStore';
import { wsService } from '@/services/websocket.service';
import { CoinAvatar, ChainBadge, formatPrice, formatNumber, timeAgo } from './CoinAvatar';

const POLL_MS = 5000;
type SourceFilter = 'all' | 'pumpfun' | 'dex';

const Change: React.FC<{ value?: number }> = ({ value }) => {
  if (value === undefined || value === null || value === 0) return <span className="text-slate-600">—</span>;
  const up = value >= 0;
  return (
    <span className={`font-mono font-semibold ${up ? 'text-pos' : 'text-neg'}`}>
      {up ? '+' : '−'}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
};

const NewCoinsLiveFeedComponent: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [, tick] = useState(0);
  const seenRef = useRef<Set<string>>(new Set());

  const selectCoinDirect = useCoinStore((s) => s.selectCoinDirect);
  const { isBotActive, recentCoins, ingestCoins, manualSnipeCoin, isWsConnected, pendingTradeIds, positions, settings } =
    useBotStore(
      useShallow((s) => ({
        isBotActive: s.isActive,
        recentCoins: s.recentCoins,
        ingestCoins: s.ingestCoins,
        manualSnipeCoin: s.manualSnipeCoin,
        isWsConnected: s.isWsConnected,
        pendingTradeIds: s.pendingTradeIds,
        positions: s.positions,
        settings: s.settings,
      }))
    );

  const fetchNewCoins = async () => {
    setIsRefreshing(true);
    try {
      ingestCoins(await CoinService.getNewCoins(), 'feed');
    } catch {
      /* keep the current list */
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    // The feed listens to the launch stream even when the bot is paused.
    wsService.connect();
    wsService.subscribeNewTokens();
    fetchNewCoins();
    const poll = setInterval(fetchNewCoins, POLL_MS);
    const clock = setInterval(() => tick((t) => t + 1), 5000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flash rows that arrived since the last render.
  useEffect(() => {
    const fresh: string[] = [];
    recentCoins.forEach((c) => {
      if (!seenRef.current.has(c.id)) {
        seenRef.current.add(c.id);
        if (seenRef.current.size > 1) fresh.push(c.id);
      }
    });
    if (fresh.length === 0) return;
    setFreshIds((prev) => new Set([...Array.from(prev), ...fresh]));
    const timer = setTimeout(() => {
      setFreshIds((prev) => {
        const next = new Set(prev);
        fresh.forEach((id) => next.delete(id));
        return next;
      });
    }, 8000);
    return () => clearTimeout(timer);
  }, [recentCoins]);

  const coins = useMemo(() => {
    let list = recentCoins;
    if (sourceFilter === 'pumpfun') list = list.filter((c) => c.isPumpFun);
    if (sourceFilter === 'dex') list = list.filter((c) => !c.isPumpFun || c.graduated);
    return list.slice(0, 40);
  }, [recentCoins, sourceFilter]);

  if (isLoading && recentCoins.length === 0) {
    return (
      <div className="panel overflow-hidden">
        <div className="h-11 border-b border-line bg-ink-850/40" />
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-14 border-b border-line last:border-b-0 flex items-center gap-3 px-4">
            <div className="w-7 h-7 rounded-full bg-ink-850 animate-pulse" />
            <div className="h-3 w-28 rounded bg-ink-850 animate-pulse" />
            <div className="ml-auto h-3 w-20 rounded bg-ink-850 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  const filters: { id: SourceFilter; label: string; icon: typeof Pill | null }[] = [
    { id: 'all', label: 'All', icon: null },
    { id: 'pumpfun', label: 'Pump.fun', icon: Pill },
    { id: 'dex', label: 'DEX pools', icon: Waves },
  ];

  return (
    <section className="space-y-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="tabbar">
          {filters.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => setSourceFilter(id)} data-active={sourceFilter === id} className="tab">
              {Icon && <Icon className="w-3.5 h-3.5" />}
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <Radio className={`w-3.5 h-3.5 ${isWsConnected ? 'text-pos' : 'text-slate-600'}`} />
            {isWsConnected ? 'Stream live' : 'Connecting…'}
            {isBotActive && <span className="text-slate-600">· bot {settings.paperTrading ? 'paper' : 'live'}</span>}
          </span>
          <button
            type="button"
            onClick={fetchNewCoins}
            disabled={isRefreshing}
            aria-label="Refresh feed"
            className="btn btn-sm btn-secondary"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* table */}
      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px] min-w-[880px]">
            <thead>
              <tr className="thead border-b border-line bg-ink-850/40">
                <th className="py-2.5 pl-4 pr-3 font-semibold w-[38%]">Token</th>
                <th className="py-2.5 px-3 font-semibold text-right">Price</th>
                <th className="py-2.5 px-3 font-semibold text-right">5m</th>
                <th className="py-2.5 px-3 font-semibold text-right">24h</th>
                <th className="py-2.5 px-3 font-semibold text-right">Market cap</th>
                <th className="py-2.5 px-3 font-semibold text-right">Liquidity</th>
                <th className="py-2.5 px-3 font-semibold text-right">Age</th>
                <th className="py-2.5 pl-3 pr-4 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {coins.map((coin) => {
                const held = positions.some((p) => p.coin.id === coin.id);
                const busy = pendingTradeIds.includes(coin.id);
                return (
                  <tr
                    key={coin.id}
                    onClick={() => selectCoinDirect(coin)}
                    className={`row cursor-pointer ${freshIds.has(coin.id) ? 'animate-pulse-once' : ''}`}
                  >
                    <td className="py-2.5 pl-4 pr-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <CoinAvatar imageUrl={coin.imageUrl} symbol={coin.symbol} chainId={coin.chainId} size="sm" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-white truncate">{coin.symbol}</span>
                            <ChainBadge chainId={coin.chainId} />
                            {coin.isPumpFun && (
                              <span className="chip chip-info" title="Pump.fun launch">
                                <Pill className="w-3 h-3" />
                                {coin.graduated ? 'Graduated' : `${coin.bondingCurve ?? 0}%`}
                              </span>
                            )}
                            {held && <span className="chip chip-pos">Holding</span>}
                          </div>
                          <p className="text-[11px] text-slate-500 truncate mt-0.5">{coin.name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-white font-semibold whitespace-nowrap">
                      {formatPrice(coin.priceUsd)}
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <Change value={coin.priceChange5m} />
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <Change value={coin.priceChange24h} />
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-300 whitespace-nowrap">
                      {formatNumber(coin.fundamentals.marketCap)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-300 whitespace-nowrap">
                      {formatNumber(coin.fundamentals.tvl)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-[11px] text-slate-500 whitespace-nowrap">
                      {coin.createdAt ? (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {timeAgo(coin.createdAt)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2.5 pl-3 pr-4 text-right">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          manualSnipeCoin(coin, undefined, 'feed');
                        }}
                        title={`Buy $${settings.buyAmountUsd} of ${coin.symbol} (${settings.paperTrading ? 'paper' : 'live'})`}
                        className="btn btn-sm btn-secondary"
                      >
                        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                        Buy
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {coins.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <Inbox className="w-7 h-7 text-slate-600 mb-3" />
            <p className="text-[13px] font-semibold text-slate-300">Waiting for launches</p>
            <p className="text-xs text-slate-500 mt-1">The Pump.fun stream usually delivers a new mint every few seconds.</p>
          </div>
        )}
      </div>
    </section>
  );
};

export const NewCoinsLiveFeed = React.memo(NewCoinsLiveFeedComponent);
