'use client';

import React, { useEffect, useState, useRef } from 'react';
import { CoinData } from '@/types/coin';
import { CoinService } from '@/services/coin.service';
import { useCoinStore } from '@/store/useCoinStore';
import { CoinAvatar, ChainBadge, formatPrice, formatNumber, timeAgo } from './CoinAvatar';
import { Zap, TrendingUp, TrendingDown, Clock, RefreshCw, Rocket } from 'lucide-react';

export const NewCoinsLiveFeed: React.FC = () => {
  const [coins, setCoins] = useState<CoinData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [countdown, setCountdown] = useState(5);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const selectCoinDirect = useCoinStore(s => s.selectCoinDirect);
  const prevCoinsRef = useRef<Set<string>>(new Set());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  const fetchNewCoins = async () => {
    setIsRefreshing(true);
    try {
      const data = await CoinService.getLatestProfiles();
      
      // Track which coins are "new" (appeared since last fetch)
      const currentIds = new Set(data.map(c => c.id));
      if (prevCoinsRef.current.size > 0) {
        const fresh = new Set<string>();
        data.forEach(c => {
          if (!prevCoinsRef.current.has(c.id)) {
            fresh.add(c.id);
          }
        });
        setNewIds(fresh);
        // Clear "new" highlights after 10s
        if (fresh.size > 0) {
          setTimeout(() => setNewIds(new Set()), 10000);
        }
      }
      prevCoinsRef.current = currentIds;
      
      setCoins(data.slice(0, 20));
      setIsLoading(false);
    } catch {
      setIsLoading(false);
    }
    setIsRefreshing(false);
    setCountdown(5);
  };

  useEffect(() => {
    fetchNewCoins();
    const intervalId = setInterval(fetchNewCoins, 5000);
    return () => clearInterval(intervalId);
  }, []);

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => (prev > 0 ? prev - 1 : 5));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (isLoading) {
    return (
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="h-7 w-52 bg-slate-800 rounded-lg animate-pulse"></div>
            <div className="h-4 w-72 bg-slate-800/50 rounded-lg animate-pulse mt-2"></div>
          </div>
        </div>
        <div className="space-y-2">
          {[1,2,3,4,5,6,7,8].map(i => (
            <div key={i} className="bg-slate-900/80 border border-slate-800/50 rounded-xl h-16 animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            <Rocket className="w-5 h-5 text-amber-400" />
            New Coins Live
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Latest tokens with verified profiles — auto-refreshes every 5s
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-ink-850/80 border border-white/8 rounded-xl px-3 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-mono text-slate-400">
              {countdown}s
            </span>
          </div>
          <button
            onClick={fetchNewCoins}
            disabled={isRefreshing}
            className="p-2 hover:bg-ink-800 rounded-xl transition-all border border-white/10 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-slate-400 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="hidden md:grid grid-cols-[2.5fr_1fr_1fr_1fr_1fr_0.5fr] gap-4 px-4 py-2 text-[10px] text-slate-500 uppercase tracking-wider font-medium border-b border-white/8 mb-1">
        <span>Token</span>
        <span className="text-right">Price</span>
        <span className="text-right">5m</span>
        <span className="text-right">24h</span>
        <span className="text-right">Volume</span>
        <span className="text-right">Age</span>
      </div>

      <div className="space-y-1">
        {coins.map((coin, index) => {
          const isNew = newIds.has(coin.id);
          return (
            <div
              key={coin.id}
              onClick={() => selectCoinDirect(coin)}
              className={`group grid grid-cols-1 md:grid-cols-[2.5fr_1fr_1fr_1fr_1fr_0.5fr] gap-2 md:gap-4 items-center px-4 py-3 rounded-xl cursor-pointer transition-all duration-300 hover:bg-white/[0.03] border border-transparent hover:border-white/10 ${
                isNew ? 'bg-emerald-500/5 border-emerald-500/20 animate-pulse-once' : ''
              }`}
              style={{ animationDelay: `${index * 30}ms` }}
            >
              {/* Token info */}
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xs text-slate-600 font-mono w-5 text-right shrink-0">
                  {index + 1}
                </span>
                <CoinAvatar
                  imageUrl={coin.imageUrl}
                  symbol={coin.symbol}
                  chainId={coin.chainId}
                  size="md"
                  showChain={true}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-sm">{coin.symbol}</span>
                    <ChainBadge chainId={coin.chainId} />
                    {isNew && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse">
                        NEW
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-500 truncate block">{coin.name}</span>
                </div>
              </div>

              {/* Price */}
              <div className="text-right">
                <span className="text-sm font-semibold text-white font-mono">
                  {formatPrice(coin.priceUsd)}
                </span>
              </div>

              {/* 5m change */}
              <div className="text-right">
                {coin.priceChange5m !== undefined && coin.priceChange5m !== 0 ? (
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold ${
                    coin.priceChange5m >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {coin.priceChange5m >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {Math.abs(coin.priceChange5m).toFixed(1)}%
                  </span>
                ) : (
                  <span className="text-xs text-slate-600">—</span>
                )}
              </div>

              {/* 24h change */}
              <div className="text-right">
                <span className={`inline-flex items-center gap-1 text-xs font-semibold ${
                  coin.priceChange24h >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {coin.priceChange24h >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {Math.abs(coin.priceChange24h).toFixed(1)}%
                </span>
              </div>

              {/* Volume */}
              <div className="text-right">
                <span className="text-xs font-medium text-slate-300 font-mono">
                  {formatNumber(coin.fundamentals.volume24h)}
                </span>
              </div>

              {/* Age / Link */}
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
            </div>
          );
        })}
      </div>

      {coins.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500">
          <Zap className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">No new coins detected yet. Waiting for data...</p>
        </div>
      )}
    </div>
  );
};
