'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Zap, RefreshCw, Radio, Loader2, Pill, Waves, Inbox, Filter } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { CoinService } from '@/services/coin.service';
import { useCoinStore } from '@/store/useCoinStore';
import { useBotStore } from '@/store/useBotStore';
import { wsService } from '@/services/websocket.service';
import { CoinAvatar, ChainBadge, formatPrice, formatNumber, timeAgo } from './CoinAvatar';

const POLL_MS = 5000;
/** A brand-new mint with no money in it is noise, not a signal. */
const TRACTION_MIN_LIQUIDITY_USD = 150;

type SourceFilter = 'all' | 'pumpfun' | 'dex';
type SortKey = 'newest' | 'liquidity' | 'marketCap';

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

/** Bonding-curve progress: the clearest way to tell fresh mints apart. */
const Curve: React.FC<{ percent?: number; graduated?: boolean; isPumpFun?: boolean }> = ({ percent, graduated, isPumpFun }) => {
  if (!isPumpFun) return <span className="text-slate-600">—</span>;
  if (graduated) return <span className="chip chip-pos">Graduated</span>;
  const p = Math.max(0, Math.min(100, percent ?? 0));
  return (
    <span className="inline-flex items-center gap-2 w-full justify-end" title={`Bonding curve ${p}% filled`}>
      <span className="w-14 h-1 rounded-full bg-ink-800 overflow-hidden shrink-0">
        <span
          className={`block h-full rounded-full ${p >= 70 ? 'bg-pos' : p >= 25 ? 'bg-warn' : 'bg-signal'}`}
          style={{ width: `${Math.max(p, 2)}%` }}
        />
      </span>
      <span className="font-mono text-[11px] text-slate-400 w-8 text-right">{p}%</span>
    </span>
  );
};

const NewCoinsLiveFeedComponent: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [source, setSource] = useState<SourceFilter>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [tractionOnly, setTractionOnly] = useState(false);
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

  const { coins, hiddenCount } = useMemo(() => {
    let list = recentCoins;
    if (source === 'pumpfun') list = list.filter((c) => c.isPumpFun);
    if (source === 'dex') list = list.filter((c) => !c.isPumpFun || c.graduated);

    const beforeTraction = list.length;
    if (tractionOnly) list = list.filter((c) => (c.fundamentals.tvl || 0) >= TRACTION_MIN_LIQUIDITY_USD);

    const sorted = [...list].sort((a, b) => {
      if (sort === 'liquidity') return (b.fundamentals.tvl || 0) - (a.fundamentals.tvl || 0);
      if (sort === 'marketCap') return (b.fundamentals.marketCap || 0) - (a.fundamentals.marketCap || 0);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    return { coins: sorted.slice(0, 40), hiddenCount: tractionOnly ? beforeTraction - list.length : 0 };
  }, [recentCoins, source, sort, tractionOnly]);

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

  const sourceFilters: { id: SourceFilter; label: string; icon: typeof Pill | null }[] = [
    { id: 'all', label: 'All', icon: null },
    { id: 'pumpfun', label: 'Pump.fun', icon: Pill },
    { id: 'dex', label: 'DEX pools', icon: Waves },
  ];

  const sorts: { id: SortKey; label: string }[] = [
    { id: 'newest', label: 'Newest' },
    { id: 'liquidity', label: 'Liquidity' },
    { id: 'marketCap', label: 'Market cap' },
  ];

  return (
    <section className="space-y-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="tabbar">
          {sourceFilters.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => setSource(id)} data-active={source === id} className="tab">
              {Icon && <Icon className="w-3.5 h-3.5" />}
              {label}
            </button>
          ))}
        </div>

        <div className="tabbar">
          {sorts.map(({ id, label }) => (
            <button key={id} type="button" onClick={() => setSort(id)} data-active={sort === id} className="tab">
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setTractionOnly((v) => !v)}
          aria-pressed={tractionOnly}
          title={`Hide launches holding under $${TRACTION_MIN_LIQUIDITY_USD} of liquidity`}
          className={tractionOnly ? 'chip chip-accent h-[30px] px-2.5' : 'chip h-[30px] px-2.5 hover:border-line-strong'}
        >
          <Filter className="w-3 h-3" />
          With traction
          {tractionOnly && hiddenCount > 0 && <span className="opacity-70">· {hiddenCount} hidden</span>}
        </button>

        <div className="ml-auto flex items-center gap-3">
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
          <table className="w-full text-left text-[13px] min-w-[920px]">
            <thead>
              <tr className="thead border-b border-line bg-ink-850/40">
                <th className="py-2.5 pl-4 pr-3 font-semibold w-[32%]">Token</th>
                <th className="py-2.5 px-3 font-semibold text-right">Price</th>
                <th className="py-2.5 px-3 font-semibold text-right">Market cap</th>
                <th className="py-2.5 px-3 font-semibold text-right">Liquidity</th>
                <th className="py-2.5 px-3 font-semibold text-right w-[132px]">Curve</th>
                <th className="py-2.5 px-3 font-semibold text-right">24h</th>
                <th className="py-2.5 px-3 font-semibold text-right">Age</th>
                <th className="py-2.5 pl-3 pr-4 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {coins.map((coin) => {
                const held = positions.some((p) => p.coin.id === coin.id);
                const busy = pendingTradeIds.includes(coin.id);
                const liq = coin.fundamentals.tvl || 0;
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
                            {held && <span className="chip chip-pos">Holding</span>}
                          </div>
                          <p className="text-[11px] text-slate-500 truncate mt-0.5">{coin.name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-white font-semibold whitespace-nowrap">
                      {formatPrice(coin.priceUsd)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-300 whitespace-nowrap">
                      {formatNumber(coin.fundamentals.marketCap)}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono whitespace-nowrap ${
                        liq >= TRACTION_MIN_LIQUIDITY_USD ? 'text-slate-200' : 'text-slate-600'
                      }`}
                    >
                      {formatNumber(liq)}
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <Curve percent={coin.bondingCurve} graduated={coin.graduated} isPumpFun={coin.isPumpFun} />
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <Change value={coin.priceChange24h} />
                    </td>
                    <td className="py-2.5 px-3 text-right text-[11px] text-slate-500 whitespace-nowrap">
                      {coin.createdAt ? timeAgo(coin.createdAt) : '—'}
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
            <p className="text-[13px] font-semibold text-slate-300">
              {tractionOnly ? 'No launches with traction yet' : 'Waiting for launches'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {tractionOnly
                ? `Nothing currently holds more than $${TRACTION_MIN_LIQUIDITY_USD} of liquidity. Turn the filter off to see every mint.`
                : 'The Pump.fun stream usually delivers a new mint every few seconds.'}
            </p>
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-500">
        Most fresh mints open at the same bonding-curve price with a few dollars of liquidity. Curve progress and liquidity
        are what separate a real launch from noise.
      </p>
    </section>
  );
};

export const NewCoinsLiveFeed = React.memo(NewCoinsLiveFeedComponent);
