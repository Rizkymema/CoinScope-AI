'use client';

import React, { useState, useEffect } from 'react';
import { CoinData } from '@/types/coin';
import { CoinService } from '@/services/coin.service';
import { useCoinStore } from '@/store/useCoinStore';
import { CoinAvatar, ChainBadge, formatPrice } from './CoinAvatar';
import { ChevronLeft, ChevronRight, Sparkles, TrendingUp, TrendingDown } from 'lucide-react';

export const FeaturedCoinsCarousel: React.FC = () => {
  const [coins, setCoins] = useState<CoinData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const selectCoinDirect = useCoinStore(s => s.selectCoinDirect);

  useEffect(() => {
    let mounted = true;
    const fetchBoosted = async () => {
      let data = await CoinService.getBoostedTokens();
      if (data.length === 0) {
        data = await CoinService.getTopCoins();
      }
      if (mounted) {
        setCoins(data.slice(0, 15));
        setIsLoading(false);
      }
    };

    fetchBoosted();
    const intervalId = setInterval(fetchBoosted, 30000);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (coins.length === 0) return;
    const autoSlide = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % Math.max(1, coins.length - 4));
    }, 5000);
    return () => clearInterval(autoSlide);
  }, [coins.length]);

  if (isLoading || coins.length === 0) {
    return (
      <div className="w-full mb-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="h-7 w-48 bg-ink-800 rounded-lg animate-pulse"></div>
            <div className="h-4 w-32 bg-ink-800/50 rounded-lg animate-pulse mt-2"></div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="surface rounded-2xl p-4 animate-pulse">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-ink-800"></div>
                <div className="flex-1">
                  <div className="h-4 w-16 bg-ink-800 rounded mb-1"></div>
                  <div className="h-3 w-12 bg-ink-800/50 rounded"></div>
                </div>
              </div>
              <div className="h-5 w-24 bg-ink-800 rounded mb-2"></div>
              <div className="h-5 w-16 bg-ink-800/50 rounded"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const next = () => {
    setCurrentIndex(prev => Math.min(prev + 1, coins.length - 5));
  };

  const prev = () => {
    setCurrentIndex(prev => Math.max(prev - 1, 0));
  };

  const visibleCount = 5;
  const visibleCoins = coins.slice(currentIndex, currentIndex + visibleCount);
  while (visibleCoins.length < visibleCount && coins.length > 0) {
    visibleCoins.push(coins[visibleCoins.length % coins.length]);
  }

  return (
    <div className="w-full mb-12">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            Featured & Boosted
          </h2>
          <p className="text-slate-400 text-sm mt-1">Promoted tokens with verified profiles</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-1 mr-2">
            {Array.from({ length: Math.max(1, coins.length - visibleCount + 1) }).slice(0, 10).map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentIndex(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  currentIndex === i ? 'bg-amber-400 w-4' : 'bg-slate-700 hover:bg-slate-600 w-1.5'
                }`}
              />
            ))}
          </div>
          <button
            onClick={prev}
            disabled={currentIndex === 0}
            className="p-2 hover:bg-ink-800 rounded-xl transition-all border border-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-5 h-5 text-slate-300" />
          </button>
          <button
            onClick={next}
            disabled={currentIndex >= coins.length - visibleCount}
            className="p-2 hover:bg-ink-800 rounded-xl transition-all border border-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-5 h-5 text-slate-300" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 overflow-hidden">
        {visibleCoins.map((coin, idx) => (
          <div
            key={`${coin.id}-${idx}`}
            onClick={() => selectCoinDirect(coin)}
            className="group relative surface rounded-2xl p-4 hover:border-amber-400/30 transition-all duration-300 cursor-pointer hover:-translate-y-1"
          >
            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <CoinAvatar
                  imageUrl={coin.imageUrl}
                  symbol={coin.symbol}
                  chainId={coin.chainId}
                  size="lg"
                  showChain={true}
                />
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-white text-sm truncate">{coin.symbol}</h3>
                  <p className="text-[10px] text-slate-500 truncate">{coin.name}</p>
                  <ChainBadge chainId={coin.chainId} className="mt-1" />
                </div>
              </div>

              <div className="mb-3">
                <p className="text-white font-bold font-mono text-lg">
                  {formatPrice(coin.priceUsd)}
                </p>
              </div>

              <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold ${
                coin.priceChange24h >= 0
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-red-500/10 text-red-400'
              }`}>
                {coin.priceChange24h >= 0 ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                {coin.priceChange24h >= 0 ? '+' : ''}{coin.priceChange24h.toFixed(2)}%
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
