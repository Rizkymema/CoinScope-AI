'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { CoinData } from '@/types/coin';
import { CoinService } from '@/services/coin.service';
import { useCoinStore } from '@/store/useCoinStore';
import { useBotStore } from '@/store/useBotStore';
import { wsService } from '@/services/websocket.service';
import { useShallow } from 'zustand/react/shallow';
import { CoinAvatar, ChainBadge, formatPrice, formatNumber, timeAgo } from './CoinAvatar';
import { Zap, TrendingUp, TrendingDown, Clock, RefreshCw, Rocket, Radio, Loader2 } from 'lucide-react';

const POLL_MS = 5000;
type SourceFilter = 'all' | 'pumpfun' | 'dex';

const NewCoinsLiveFeedComponent: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [countdown, setCountdown] = useState(POLL_MS / 1000);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [, forceTick] = useState(0);
  const seenRef = useRef<Set<string>>(new Set());

  const selectCoinDirect = useCoinStore((s) => s.selectCoinDirect);
  const { isBotActive, recentCoins, ingestCoins, manualSnipeCoin, isWsConnected, pendingTradeIds, positions, settings } = useBotStore(
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
      const data = await CoinService.getNewCoins();
      ingestCoins(data, 'feed');
    } catch {
      // keep whatever we already have
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      setCountdown(POLL_MS / 1000);
    }
  };

  useEffect(() => {
    // The feed always listens to the Pump.fun creation stream, even when the bot is paused.
    wsService.connect();
    wsService.subscribeNewTokens();
    fetchNewCoins();
    const poll = setInterval(fetchNewCoins, POLL_MS);
    const tick = setInterval(() => {
      setCountdown((c) => (c > 1 ? c - 1 : POLL_MS / 1000));
      forceTick((t) => t + 1); // refresh "x s ago" labels
    }, 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Highlight coins that appeared since the previous render for ~10s.
  useEffect(() => {
    const fresh: string[] = [];
    recentCoins.forEach((c) => {
      if (!seenRef.current.has(c.id)) {
        seenRef.current.add(c.id);
        if (seenRef.current.size > 1) fresh.push(c.id);
      }
    });
    if (fresh.length === 0) return;
    setNewIds((prev) => new Set([...Array.from(prev), ...fresh]));
    const timer = setTimeout(() => {
      setNewIds((prev) => {
        const next = new Set(prev);
        fresh.forEach((id) => next.delete(id));
        return next;
      });
    }, 10_000);
    return () => clearTimeout(timer);
  }, [recentCoins]);

  const coins = useMemo(() => {
    let list = recentCoins;
    if (sourceFilter === 'pumpfun') list = list.filter((c) => c.isPumpFun);
    if (sourceFilter === 'dex') list = list.filter((c) => !c.isPumpFun || c.graduated);
    return list.slice(0, 40);
  }, [recentCoins, sourceFilter]);

  const handleQuickSnipe = (e: React.MouseEvent, coin: CoinData) => {
    e.stopPropagation();
    manualSnipeCoin(coin, undefined, 'feed quick snipe');
  };

  if (isLoading && recentCoins.length === 0) {
    return (
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="h-7 w-52 bg-slate-800 rounded-lg animate-pulse"></div>
            <div className="h-4 w-72 bg-slate-800/50 rounded-lg animate-pulse mt-2"></div>
          </div>
        </div>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="bg-slate-900/80 border border-slate-800/50 rounded-xl h-16 animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            <Rocket className="w-5 h-5 text-amber-400" />
            New Coins Live Feed
          </h2>
          <p className="text-slate-400 text-sm mt-1 flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 ${isWsConnected ? 'text-emerald-400' : 'text-slate-500'}`}>
              <Radio className={`w-3 h-3 ${isWsConnected ? 'animate-pulse' : ''}`} />
              {isWsConnected ? 'Pump.fun stream live' : 'Stream connecting…'}
            </span>
            <span>· new DEX pools every {POLL_MS / 1000}s</span>
            {isBotActive && <span className="text-emerald-400">· ⚡ bot sniping ({settings.paperTrading ? 'paper' : 'LIVE'})</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-ink-900 border border-white/10 rounded-xl p-1 text-xs">
            {(['all', 'pumpfun', 'dex'] as SourceFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setSourceFilter(f)}
                className={`px-3 py-1 rounded-lg font-semibold transition-all ${sourceFilter === f ? 'bg-white/15 text-white shadow' : 'text-slate-400 hover:text-white'}`}
              >
                {f === 'all' ? 'All' : f === 'pumpfun' ? '💊 Pump.fun' : '🦅 DEX'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 bg-ink-850/80 border border-white/8 rounded-xl px-3 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-mono text-slate-400">{countdown}s</span>
          </div>
          <button onClick={fetchNewCoins} disabled={isRefreshing} className="p-2 hover:bg-ink-800 rounded-xl transition-all border border-white/10 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 text-slate-400 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="hidden md:grid grid-cols-[2.4fr_1fr_0.8fr_0.8fr_1fr_1fr_0.7fr_0.8fr] gap-4 px-4 py-2 text-[10px] text-slate-500 uppercase tracking-wider font-medium border-b border-white/8 mb-1">
        <span>Token</span>
        <span className="text-right">Price</span>
        <span className="text-right">5m</span>
        <span className="text-right">24h</span>
        <span className="text-right">MCap</span>
        <span className="text-right">Liquidity</span>
        <span className="text-right">Age</span>
        <span className="text-right">Snipe</span>
      </div>

      <div className="space-y-1">
        {coins.map((coin, index) => {
          const isNew = newIds.has(coin.id);
          const held = positions.some((p) => p.coin.id === coin.id);
          const busy = pendingTradeIds.includes(coin.id);
          return (
            <div
              key={coin.id}
              onClick={() => selectCoinDirect(coin)}
              className={`group grid grid-cols-1 md:grid-cols-[2.4fr_1fr_0.8fr_0.8fr_1fr_1fr_0.7fr_0.8fr] gap-2 md:gap-4 items-center px-4 py-3 rounded-xl cursor-pointer transition-all duration-300 hover:bg-white/[0.03] border border-transparent hover:border-white/10 ${
                isNew ? 'bg-emerald-500/5 border-emerald-500/20 animate-pulse-once' : ''
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xs text-slate-600 font-mono w-5 text-right shrink-0">{index + 1}</span>
                <CoinAvatar imageUrl={coin.imageUrl} symbol={coin.symbol} chainId={coin.chainId} size="md" showChain={true} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-white text-sm">{coin.symbol}</span>
                    <ChainBadge chainId={coin.chainId} />
                    {coin.isPumpFun && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                        💊 {coin.graduated ? 'Graduated' : `${coin.bondingCurve ?? 0}%`}
                      </span>
                    )}
                    {coin.source === 'pumpportal' && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">STREAM</span>
                    )}
                    {isNew && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse">NEW</span>}
                    {held && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">HOLDING</span>}
                  </div>
                  <span className="text-[11px] text-slate-500 truncate block">{coin.name}</span>
                </div>
              </div>

              <div className="text-right">
                <span className="text-sm font-semibold text-white font-mono">{formatPrice(coin.priceUsd)}</span>
              </div>

              <div className="text-right">
                {coin.priceChange5m !== undefined && coin.priceChange5m !== 0 ? (
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold ${coin.priceChange5m >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {coin.priceChange5m >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {Math.abs(coin.priceChange5m).toFixed(1)}%
                  </span>
                ) : (
                  <span className="text-xs text-slate-600">—</span>
                )}
              </div>

              <div className="text-right">
                {coin.priceChange24h ? (
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold ${coin.priceChange24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {coin.priceChange24h >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {Math.abs(coin.priceChange24h).toFixed(1)}%
                  </span>
                ) : (
                  <span className="text-xs text-slate-600">—</span>
                )}
              </div>

              <div className="text-right">
                <span className="text-xs font-medium text-slate-300 font-mono">{formatNumber(coin.fundamentals.marketCap)}</span>
              </div>
              <div className="text-right">
                <span className="text-xs font-medium text-slate-300 font-mono">{formatNumber(coin.fundamentals.tvl)}</span>
              </div>

              <div className="text-right flex items-center justify-end gap-1">
                {coin.createdAt ? (
                  <span className="text-[10px] text-slate-500 flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {timeAgo(coin.createdAt)}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-600">—</span>
                )}
              </div>

              <div className="text-right flex justify-end">
                <button
                  onClick={(e) => handleQuickSnipe(e, coin)}
                  disabled={busy}
                  className="px-2.5 py-1 bg-amber-400/10 hover:bg-amber-400/20 text-amber-400 border border-amber-400/30 hover:border-amber-400/50 rounded-lg text-xs font-bold transition-all flex items-center gap-1 disabled:opacity-50"
                  title={`Buy $${settings.buyAmountUsd} of ${coin.symbol} (${settings.paperTrading ? 'paper' : 'LIVE'})`}
                >
                  {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3 fill-current" />}
                  Snipe
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {coins.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500">
          <Zap className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">Waiting for new launches… the Pump.fun stream usually delivers a new mint every few seconds.</p>
        </div>
      )}
    </div>
  );
};

export const NewCoinsLiveFeed = React.memo(NewCoinsLiveFeedComponent);
