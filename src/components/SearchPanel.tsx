'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Search, Loader2, TrendingUp, TrendingDown, X } from 'lucide-react';
import { CoinService } from '@/services/coin.service';
import { CoinData } from '@/types/coin';
import { useCoinStore } from '@/store/useCoinStore';
import { CoinAvatar, ChainBadge, formatPrice, formatNumber } from './CoinAvatar';

export const SearchPanel: React.FC = () => {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<CoinData[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selectCoinDirect = useCoinStore((s) => s.selectCoinDirect);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!debounced) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    let active = true;
    setIsSearching(true);
    CoinService.searchCoins(debounced).then((res) => {
      if (!active) return;
      setResults(res);
      setIsSearching(false);
      setIsOpen(true);
    });
    return () => {
      active = false;
    };
  }, [debounced]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!isOpen) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setIsOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  const select = (coin: CoinData) => {
    selectCoinDirect(coin);
    setQuery(coin.symbol);
    setIsOpen(false);
  };

  return (
    <div ref={rootRef} className="relative w-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder="Search name, symbol or contract address"
          aria-label="Search tokens"
          className="field pl-9 pr-9 h-9"
        />
        {isSearching ? (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-signal animate-spin" />
        ) : (
          query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setIsOpen(false);
              }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-500 hover:text-white transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )
        )}
      </div>

      {isOpen && (
        <div className="absolute top-full mt-1.5 w-full panel overflow-hidden z-50">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-slate-500">No tokens found for “{debounced}”.</p>
          ) : (
            <ul className="max-h-[360px] overflow-y-auto" role="listbox">
              {results.map((coin) => {
                const up = coin.priceChange24h >= 0;
                return (
                  <li key={coin.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => select(coin)}
                      className="row w-full text-left px-3 py-2.5 flex items-center justify-between gap-3"
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <CoinAvatar imageUrl={coin.imageUrl} symbol={coin.symbol} chainId={coin.chainId} size="sm" />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="font-semibold text-white text-[13px] truncate">{coin.symbol}</span>
                            <ChainBadge chainId={coin.chainId} />
                          </span>
                          <span className="block text-[11px] text-slate-500 truncate mt-0.5">
                            {coin.name}
                            {coin.dexId ? ` · ${coin.dexId}` : ''}
                          </span>
                        </span>
                      </span>

                      <span className="text-right shrink-0">
                        <span className="block font-mono font-semibold text-white text-[13px]">
                          {formatPrice(coin.priceUsd)}
                        </span>
                        <span className={`flex items-center justify-end gap-1 text-[11px] font-mono ${up ? 'text-pos' : 'text-neg'}`}>
                          {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {up ? '+' : '−'}
                          {Math.abs(coin.priceChange24h).toFixed(1)}% · {formatNumber(coin.fundamentals.volume24h)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
