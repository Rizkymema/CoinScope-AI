'use client';

import React, { useEffect, useState } from 'react';
import { CoinData } from '@/types/coin';
import { CoinService } from '@/services/coin.service';
import { useCoinStore } from '@/store/useCoinStore';
import { CoinAvatar, formatPrice } from './CoinAvatar';

export const LiveMarketTicker: React.FC = () => {
  const [coins, setCoins] = useState<CoinData[]>([]);
  const selectCoinDirect = useCoinStore((s) => s.selectCoinDirect);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const data = await CoinService.getTopCoins({ limit: 24 });
      if (mounted) setCoins(data);
    };
    load();
    const id = setInterval(load, 12_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  if (coins.length === 0) return null;

  return (
    <div className="w-full bg-ink-900 border-b border-line overflow-hidden" aria-label="Market ticker">
      <div className="ticker-wrapper">
        <div className="ticker-content">
          {[...coins, ...coins].map((coin, i) => {
            const up = coin.priceChange24h >= 0;
            return (
              <button
                key={`${coin.id}-${i}`}
                type="button"
                tabIndex={i < coins.length ? 0 : -1}
                aria-hidden={i >= coins.length}
                onClick={() => selectCoinDirect(coin)}
                className="inline-flex items-center gap-1.5 px-3 py-2 shrink-0 hover:bg-white/[0.03] transition-colors"
              >
                <CoinAvatar imageUrl={coin.imageUrl} symbol={coin.symbol} size="xs" showChain={false} />
                <span className="text-[11px] font-semibold text-slate-200">{coin.symbol}</span>
                <span className="text-[11px] font-mono text-slate-400">{formatPrice(coin.priceUsd)}</span>
                <span className={`text-[11px] font-mono font-semibold ${up ? 'text-pos' : 'text-neg'}`}>
                  {up ? '+' : '−'}
                  {Math.abs(coin.priceChange24h).toFixed(1)}%
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
