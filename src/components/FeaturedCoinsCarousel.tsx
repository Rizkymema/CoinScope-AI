'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Megaphone, TrendingUp, TrendingDown } from 'lucide-react';
import { CoinData } from '@/types/coin';
import { CoinService } from '@/services/coin.service';
import { useCoinStore } from '@/store/useCoinStore';
import { CoinAvatar, ChainBadge, formatPrice, formatNumber } from './CoinAvatar';

/**
 * Horizontal strip of boosted tokens.
 * Deliberately not an auto-rotating carousel: content that moves on its own while
 * you are reading it is hostile, and duplicating entries to fill the row is dishonest.
 */
export const FeaturedCoinsCarousel: React.FC = () => {
  const [coins, setCoins] = useState<CoinData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const selectCoinDirect = useCoinStore((s) => s.selectCoinDirect);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      let data = await CoinService.getBoostedTokens();
      if (data.length === 0) data = await CoinService.getTopCoins({ limit: 15 });
      if (!mounted) return;
      setCoins(data.slice(0, 15));
      setIsLoading(false);
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const scrollBy = (dir: -1 | 1) => {
    scroller.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });
  };

  if (isLoading) {
    return (
      <div className="flex gap-2.5 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="panel h-[104px] w-[220px] shrink-0 animate-pulse" />
        ))}
      </div>
    );
  }

  if (coins.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <Megaphone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <h2 className="text-[13px] font-bold text-white">Boosted</h2>
          <span className="text-[11px] text-slate-500 truncate">Paid promotion on DexScreener, not an endorsement</span>
        </div>
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label="Scroll left"
            className="p-1.5 rounded-md border border-line text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label="Scroll right"
            className="p-1.5 rounded-md border border-line text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={scroller}
        className="flex gap-2.5 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-1"
        role="list"
        aria-label="Boosted tokens"
      >
        {coins.map((coin) => {
          const up = coin.priceChange24h >= 0;
          return (
            <button
              key={coin.id}
              type="button"
              role="listitem"
              onClick={() => selectCoinDirect(coin)}
              className="panel-interactive shrink-0 w-[220px] p-3.5 text-left snap-start"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <CoinAvatar imageUrl={coin.imageUrl} symbol={coin.symbol} chainId={coin.chainId} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-white text-[13px] truncate">{coin.symbol}</span>
                    <ChainBadge chainId={coin.chainId} />
                  </div>
                  <p className="text-[11px] text-slate-500 truncate mt-0.5">{coin.name}</p>
                </div>
              </div>

              <div className="flex items-baseline justify-between gap-2 mt-3">
                <span className="font-mono font-bold text-white text-[15px] truncate">{formatPrice(coin.priceUsd)}</span>
                <span className={`inline-flex items-center gap-1 text-xs font-mono font-semibold shrink-0 ${up ? 'text-pos' : 'text-neg'}`}>
                  {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {up ? '+' : '−'}
                  {Math.abs(coin.priceChange24h).toFixed(1)}%
                </span>
              </div>

              <p className="text-[11px] text-slate-500 mt-1.5 font-mono">
                Vol {formatNumber(coin.fundamentals.volume24h)}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
};
