'use client';

import React, { useEffect, useState } from 'react';
import { CoinData } from '@/types/coin';
import { CoinService } from '@/services/coin.service';
import { useCoinStore } from '@/store/useCoinStore';
import { useBotStore } from '@/store/useBotStore';
import { CoinAvatar, ChainBadge, formatNumber, formatPrice } from './CoinAvatar';
import { TrendingUp, TrendingDown, Volume2, Zap, Flame, Clock, BarChart3, Target, History, ExternalLink, Users } from 'lucide-react';
import { FilterType } from './FilterTabs';

interface TrendingCoinsGridProps {
  activeFilter?: FilterType;
}

const TrendingCoinsGridComponent: React.FC<TrendingCoinsGridProps> = ({ activeFilter = 'trending' }) => {
  const [coins, setCoins] = useState<CoinData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const selectCoinDirect = useCoinStore(s => s.selectCoinDirect);
  const manualSnipeCoin = useBotStore(s => s.manualSnipeCoin);

  useEffect(() => {
    let mounted = true;
    const fetchTop = async () => {
      const data = await CoinService.getTopCoins({ limit: 140 });
      if (mounted) {
        setCoins(data);
        setIsLoading(false);
      }
    };

    fetchTop();
    const intervalId = setInterval(fetchTop, 10000);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, []);

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

  const filterLabels: Record<string, { title: string; subtitle: string }> = {
    movers: { title: 'Top Movers', subtitle: 'Biggest price changes in the last 24h' },
    trending: { title: 'Trending Now', subtitle: 'Most active coins across all DEX' },
    mayhem: { title: 'Market Mayhem', subtitle: 'High volatility assets right now' },
    live: { title: 'Live Activity', subtitle: 'Highest volume coins in real-time' },
    new: { title: 'Newest Tokens', subtitle: 'Recently discovered low-cap gems' },
    'market-cap': { title: 'By Market Cap', subtitle: 'Largest coins by fully diluted valuation' },
    agents: { title: 'AI Agents', subtitle: 'Coins with bullish AI signals' },
    oldest: { title: 'Established', subtitle: 'Veteran coins with proven track records' },
  };

  const filterIcons: Record<string, React.ReactNode> = {
    movers: <TrendingUp className="w-5 h-5 text-emerald-400" />,
    trending: <Flame className="w-5 h-5 text-amber-400" />,
    mayhem: <Zap className="w-5 h-5 text-yellow-400" />,
    live: <Clock className="w-5 h-5 text-cyan-400" />,
    new: <Zap className="w-5 h-5 text-signal-soft" />,
    'market-cap': <BarChart3 className="w-5 h-5 text-sky-400" />,
    agents: <Target className="w-5 h-5 text-signal" />,
    oldest: <History className="w-5 h-5 text-slate-400" />,
  };

  const currentLabel = filterLabels[activeFilter] || filterLabels.trending;
  const filteredCoins = getFilteredCoins();

  if (isLoading) {
    return (
      <div>
        <div className="mb-6">
          <div className="h-7 w-48 bg-ink-800 rounded-lg animate-pulse mb-2"></div>
          <div className="h-4 w-64 bg-ink-800/50 rounded-lg animate-pulse"></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1,2,3,4,5,6,7,8].map(i => (
            <div key={i} className="surface rounded-2xl h-64 animate-pulse">
              <div className="p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-ink-800"></div>
                  <div className="space-y-1.5 flex-1">
                    <div className="h-4 w-16 bg-ink-800 rounded"></div>
                    <div className="h-3 w-24 bg-ink-800/50 rounded"></div>
                  </div>
                </div>
                <div className="h-6 w-28 bg-ink-800 rounded mt-4"></div>
                <div className="grid grid-cols-2 gap-2 mt-4">
                  <div className="h-10 bg-ink-800/50 rounded"></div>
                  <div className="h-10 bg-ink-800/50 rounded"></div>
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
        <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2.5 mb-2">
          {filterIcons[activeFilter]}
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
              className="group relative overflow-hidden surface surface-hover rounded-2xl transition-all duration-300 cursor-pointer hover:-translate-y-1"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="absolute top-3 right-3 flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </div>

              <div className="relative p-5 h-full flex flex-col justify-between">
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

                <div className="mb-4">
                  <p className="text-xl font-bold text-white font-mono">
                    {formatPrice(coin.priceUsd)}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    {coin.priceChange5m !== undefined && coin.priceChange5m !== 0 && (
                      <span className={`flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-md ${
                        coin.priceChange5m >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                      }`}>
                        5m: {coin.priceChange5m >= 0 ? '+' : ''}{coin.priceChange5m.toFixed(1)}%
                      </span>
                    )}
                    <span className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-md ${
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

                <div className="grid grid-cols-2 gap-2 mb-4 pt-3 border-t border-white/5">
                  <div className="bg-white/[0.03] rounded-lg p-2">
                    <p className="text-slate-500 text-[10px] mb-0.5 flex items-center gap-1 uppercase tracking-wider">
                      <Volume2 className="w-2.5 h-2.5" />
                      Vol 24h
                    </p>
                    <p className="text-xs font-semibold text-slate-200 font-mono">
                      {formatNumber(coin.fundamentals.volume24h)}
                    </p>
                  </div>
                  <div className="bg-white/[0.03] rounded-lg p-2">
                    <p className="text-slate-500 text-[10px] mb-0.5 flex items-center gap-1 uppercase tracking-wider">
                      <BarChart3 className="w-2.5 h-2.5" />
                      MCap
                    </p>
                    <p className="text-xs font-semibold text-slate-200 font-mono">
                      {formatNumber(coin.fundamentals.marketCap)}
                    </p>
                  </div>
                </div>

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

                <div className="grid grid-cols-2 gap-2">
                  <button className="bg-signal hover:bg-signal-soft text-ink-950 font-bold py-2.5 rounded-xl transition-all duration-200 text-xs flex items-center justify-center gap-1.5">
                    <Target className="w-3.5 h-3.5" />
                    Analyze
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      manualSnipeCoin(coin);
                    }}
                    className="bg-amber-400/15 hover:bg-amber-400/25 text-amber-400 border border-amber-400/30 hover:border-amber-400/50 font-extrabold py-2.5 rounded-xl transition-all duration-200 text-xs flex items-center justify-center gap-1.5 active:scale-95"
                    title={`Buy $${coin.symbol} with Bot`}
                  >
                    <Zap className="w-3.5 h-3.5 fill-current" />
                    Snipe Bot
                  </button>
                </div>

                {coin.url && (
                  <a
                    href={coin.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="mt-2 flex items-center justify-center gap-1 text-[10px] text-slate-500 hover:text-signal-soft transition-colors"
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

export const TrendingCoinsGrid = React.memo(TrendingCoinsGridComponent);
