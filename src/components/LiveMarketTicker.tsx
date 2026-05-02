'use client';

import React, { useEffect, useState } from 'react';
import { CoinData } from '@/types/coin';
import { CoinService } from '@/services/coin.service';
import { CoinAvatar, formatPrice } from './CoinAvatar';
import { TrendingUp, TrendingDown } from 'lucide-react';

export const LiveMarketTicker: React.FC = () => {
  const [coins, setCoins] = useState<CoinData[]>([]);

  useEffect(() => {
    const fetchTicker = async () => {
      const data = await CoinService.getTopCoins();
      setCoins(data);
    };
    fetchTicker();
    const interval = setInterval(fetchTicker, 12000);
    return () => clearInterval(interval);
  }, []);

  if (coins.length === 0) return null;

  // Double the coins array for seamless infinite scroll
  const tickerCoins = [...coins, ...coins];

  return (
    <div className="w-full bg-slate-900/50 border-b border-slate-800/30 overflow-hidden">
      <div className="ticker-wrapper">
        <div className="ticker-content">
          {tickerCoins.map((coin, idx) => (
            <div
              key={`${coin.id}-${idx}`}
              className="inline-flex items-center gap-2 px-4 py-2 shrink-0"
            >
              <CoinAvatar
                imageUrl={coin.imageUrl}
                symbol={coin.symbol}
                size="xs"
                showChain={false}
              />
              <span className="text-xs font-semibold text-white">{coin.symbol}</span>
              <span className="text-xs font-mono text-slate-300">
                {formatPrice(coin.priceUsd)}
              </span>
              <span className={`flex items-center gap-0.5 text-[10px] font-semibold ${
                coin.priceChange24h >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}>
                {coin.priceChange24h >= 0 ? (
                  <TrendingUp className="w-2.5 h-2.5" />
                ) : (
                  <TrendingDown className="w-2.5 h-2.5" />
                )}
                {Math.abs(coin.priceChange24h).toFixed(1)}%
              </span>
              <span className="text-slate-800 ml-2">|</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
