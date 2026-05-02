'use client';

import React, { useEffect, useState } from 'react';
import { CoinData } from '@/types/coin';
import { CoinService } from '@/services/coin.service';
import { useCoinStore } from '@/store/useCoinStore';
import { CoinAvatar, ChainBadge, formatNumber, formatPrice, timeAgo } from './CoinAvatar';
import { TrendingUp, TrendingDown, Volume2, Zap, Flame, Clock, BarChart3, Target, History, ExternalLink, Users } from 'lucide-react';
import { FilterType } from './FilterTabs';

interface TrendingCoinsGridProps {
  activeFilter?: FilterType;
}

export const TrendingCoinsGrid: React.FC<TrendingCoinsGridProps> = ({ activeFilter = 'trending' }) => {
  const [coins, setCoins] = useState<CoinData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const selectCoinDirect = useCoinStore(s => s.selectCoinDirect);

  useEffect(() => {
    let mounted = true;
    const fetchTop = async () => {
      const data = await CoinService.getTopCoins();
      if (mounted) {
        setCoins(data);
        setIsLoading(false);
      }
    };
    
    fetchTop();
    const intervalId = setInterval(fetchTop, 10000); // Update every 10s for real-time
    
    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, []);

  // Sort/filter coins based on the active filter
  const getFilteredCoins = () => {
    if (coins.length === 0) return [];
    
    const sorted = [...coins];
    
    switch (activeFilter) {
      case 'movers':
        return sorted.sort((a, b) => Math.abs(b.priceChange24h) - Math.abs(a.priceChange24h));
      case 'trending':
        return sorted.sort((a, b) => (b.fundamentals.volume24h) - (a.fundamentals.volume24h));
      case 'mayhem':
        return sorted.sort((a, b) => Math.abs(b.priceChange24h) - Math.abs(a.priceChange24h))
          .filter(c => Math.abs(c.priceChange24h) > 2);
      case 'live':
        return sorted.sort((a, b) => b.fundamentals.volume24h - a.fundamentals.volume24h);
      case 'new':
        return sorted.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      case 'market-cap':
        return sorted.sort((a, b) => b.fundamentals.marketCap - a.fundamentals.marketCap);
      case 'agents':
        return sorted.filter(c => c.priceChange24h > 0);
      case 'oldest':
        return sorted.sort((a, b) => b.fundamentals.marketCap - a.fundamentals.marketCap);
      default:
        return sorted;
    }
  };

  const filterLabels: Record<string, { title: string; subtitle: string; icon: React.ReactNode }> = {
    movers: { title: '🚀 Top Movers', subtitle: 'Biggest price changes in the last 24h', icon: <TrendingUp className="w-6 h-6 text-emerald-500" /> },
    trending: { title: '🔥 Trending Now', subtitle: 'Most active coins across all DEX', icon: <Flame className="w-6 h-6 text-orange-500" /> },
    mayhem: { title: '⚡ Market Mayhem', subtitle: 'High volatility assets right now', icon: <Zap className="w-6 h-6 text-yellow-500" /> },
    live: { title: '🟢 Live Activity', subtitle: 'Highest volume coins in real-time', icon: <Clock className="w-6 h-6 text-cyan-500" /> },
    new: { title: '✨ Newest Tokens', subtitle: 'Recently discovered low-cap gems', icon: <Zap className="w-6 h-6 text-purple-500" /> },
    'market-cap': { title: '📊 By Market Cap', subtitle: 'Largest coins by fully diluted valuation', icon: <BarChart3 className="w-6 h-6 text-blue-500" /> },
    agents: { title: '🤖 AI Agents', subtitle: 'Coins with bullish AI signals', icon: <Target className="w-6 h-6 text-indigo-500" /> },
    oldest: { title: '🏛️ Established', subtitle: 'Veteran coins with proven track records', icon: <History className="w-6 h-6 text-slate-400" /> },
  };

  const currentLabel = filterLabels[activeFilter] || filterLabels.trending;
  const filteredCoins = getFilteredCoins();

  if (isLoading) {
    return (
      <div>
        <div className="mb-6">
          <div className="h-7 w-48 bg-slate-800 rounded animate-pulse mb-2"></div>
          <div className="h-4 w-64 bg-slate-800/50 rounded animate-pulse"></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1,2,3,4,5,6,7,8].map(i => (
            <div key={i} className="bg-slate-900/80 backdrop-blur-sm border border-slate-800/50 rounded-2xl h-64 animate-pulse">
              <div className="p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-800"></div>
                  <div className="space-y-1.5 flex-1">
                    <div className="h-4 w-16 bg-slate-800 rounded"></div>
                    <div className="h-3 w-24 bg-slate-800/50 rounded"></div>
                  </div>
                </div>
                <div className="h-6 w-28 bg-slate-800 rounded mt-4"></div>
                <div className="grid grid-cols-2 gap-2 mt-4">
                  <div className="h-10 bg-slate-800/50 rounded"></div>
                  <div className="h-10 bg-slate-800/50 rounded"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2 mb-2">
          {currentLabel.title}
        </h2>
        <p className="text-slate-400">{currentLabel.subtitle}</p>
      </div>

      {filteredCoins.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500">
          <Zap className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">No coins match this filter right now</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredCoins.map((coin, index) => (
            <div
              key={coin.id}
              onClick={() => selectCoinDirect(coin)}
              className="group relative overflow-hidden bg-slate-900/80 backdrop-blur-sm border border-slate-800/50 rounded-2xl hover:border-indigo-500/50 transition-all duration-300 cursor-pointer hover:shadow-xl hover:shadow-indigo-500/10 hover:-translate-y-1"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              {/* Glow effect on hover */}
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/5 via-transparent to-purple-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

              {/* Live pulse indicator */}
              <div className="absolute top-3 right-3 flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </div>

              {/* Content */}
              <div className="relative p-5 h-full flex flex-col justify-between">
                {/* Header - Avatar, Symbol & Chain */}
                <div className="flex items-center gap-3 mb-4">
                  <CoinAvatar
                    imageUrl={coin.imageUrl}
                    symbol={coin.symbol}
                    chainId={coin.chainId}
                    size="lg"
                    showChain={true}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-white truncate text-sm">{coin.symbol}</h3>
                      <ChainBadge chainId={coin.chainId} />
                    </div>
                    <p className="text-xs text-slate-500 truncate mt-0.5">{coin.name}</p>
                  </div>
                </div>

                {/* Price */}
                <div className="mb-4">
                  <p className="text-xl font-bold text-white font-mono">
                    {formatPrice(coin.priceUsd)}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    {/* 5m change */}
                    {coin.priceChange5m !== undefined && coin.priceChange5m !== 0 && (
                      <span className={`flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        coin.priceChange5m >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                      }`}>
                        5m: {coin.priceChange5m >= 0 ? '+' : ''}{coin.priceChange5m.toFixed(1)}%
                      </span>
                    )}
                    {/* 24h change */}
                    <span className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded ${
                      coin.priceChange24h >= 0
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-red-500/15 text-red-400'
                    }`}>
                      {coin.priceChange24h >= 0 ? (
                        <TrendingUp className="w-3 h-3" />
                      ) : (
                        <TrendingDown className="w-3 h-3" />
                      )}
                      {Math.abs(coin.priceChange24h).toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-2 mb-4 pt-3 border-t border-slate-800/50">
                  <div className="bg-slate-800/30 rounded-lg p-2">
                    <p className="text-slate-500 text-[10px] mb-0.5 flex items-center gap-1 uppercase tracking-wider">
                      <Volume2 className="w-2.5 h-2.5" />
                      Vol 24h
                    </p>
                    <p className="text-xs font-semibold text-slate-200 font-mono">
                      {formatNumber(coin.fundamentals.volume24h)}
                    </p>
                  </div>
                  <div className="bg-slate-800/30 rounded-lg p-2">
                    <p className="text-slate-500 text-[10px] mb-0.5 flex items-center gap-1 uppercase tracking-wider">
                      <BarChart3 className="w-2.5 h-2.5" />
                      MCap
                    </p>
                    <p className="text-xs font-semibold text-slate-200 font-mono">
                      {formatNumber(coin.fundamentals.marketCap)}
                    </p>
                  </div>
                </div>

                {/* Txns row */}
                {coin.txns24h && (
                  <div className="flex items-center gap-3 mb-3 text-[10px]">
                    <div className="flex items-center gap-1">
                      <Users className="w-3 h-3 text-slate-500" />
                      <span className="text-emerald-400 font-medium">{coin.txns24h.buys} buys</span>
                      <span className="text-slate-600">/</span>
                      <span className="text-red-400 font-medium">{coin.txns24h.sells} sells</span>
                    </div>
                  </div>
                )}

                {/* Action Button */}
                <button className="w-full bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-semibold py-2.5 rounded-xl transition-all duration-200 text-sm flex items-center justify-center gap-2 group-hover:shadow-lg group-hover:shadow-indigo-500/20">
                  <Target className="w-3.5 h-3.5" />
                  Analyze
                </button>

                {/* External link */}
                {coin.url && (
                  <a
                    href={coin.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="mt-2 flex items-center justify-center gap-1 text-[10px] text-slate-500 hover:text-indigo-400 transition-colors"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    View on DexScreener
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
