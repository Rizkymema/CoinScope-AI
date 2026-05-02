'use client';

import React, { useState, useEffect } from 'react';
import { Search, Loader2, TrendingUp, TrendingDown, ExternalLink } from 'lucide-react';
import { CoinService } from '@/services/coin.service';
import { CoinData } from '@/types/coin';
import { useCoinStore } from '@/store/useCoinStore';
import { CoinAvatar, ChainBadge, formatPrice } from './CoinAvatar';

export const SearchPanel: React.FC = () => {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<CoinData[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const selectCoinDirect = useCoinStore(s => s.selectCoinDirect);

  // Debounce logic
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Search effect
  useEffect(() => {
    if (!debouncedQuery) {
      setResults([]);
      return;
    }
    
    let active = true;
    setIsSearching(true);
    
    CoinService.searchCoins(debouncedQuery).then(res => {
      if (active) {
        setResults(res);
        setIsSearching(false);
        setIsOpen(true);
      }
    });

    return () => { active = false; };
  }, [debouncedQuery]);

  const handleSelect = (coin: CoinData) => {
    selectCoinDirect(coin);
    setQuery(coin.name);
    setIsOpen(false);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = () => setIsOpen(false);
    if (isOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div className="relative w-full max-w-2xl mx-auto" onClick={e => e.stopPropagation()}>
      <div className="relative flex items-center group">
        <Search className="absolute left-5 w-5 h-5 text-slate-400 group-focus-within:text-indigo-400 transition-colors" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query && setIsOpen(true)}
          placeholder="Search tokens by name, symbol, or contract address..."
          className="w-full bg-slate-900/80 backdrop-blur-sm border border-slate-700/50 rounded-2xl pl-14 pr-14 py-4 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-lg shadow-black/20 text-sm"
          id="search-input"
        />
        {isSearching && (
          <Loader2 className="absolute right-5 w-5 h-5 text-indigo-400 animate-spin" />
        )}
      </div>

      {/* Autocomplete Dropdown */}
      {isOpen && results.length > 0 && (
        <div className="absolute top-full mt-2 w-full bg-slate-900/95 backdrop-blur-xl border border-slate-800/50 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden z-50">
          <div className="p-2 border-b border-slate-800/50">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-medium px-2">
              {results.length} results found
            </span>
          </div>
          <ul className="max-h-[400px] overflow-y-auto py-1">
            {results.map((coin) => (
              <li key={coin.id}>
                <button
                  onClick={() => handleSelect(coin)}
                  className="w-full text-left px-4 py-3 hover:bg-slate-800/50 flex items-center justify-between transition-all focus:outline-none focus:bg-slate-800/50 group"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <CoinAvatar
                      imageUrl={coin.imageUrl}
                      symbol={coin.symbol}
                      chainId={coin.chainId}
                      size="sm"
                      showChain={true}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white text-sm">{coin.name}</span>
                        <ChainBadge chainId={coin.chainId} />
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-slate-500">{coin.symbol}</span>
                        {coin.dexId && (
                          <span className="text-[10px] text-slate-600">on {coin.dexId}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="text-right flex items-center gap-3 shrink-0">
                    <div>
                      <span className="font-semibold text-white text-sm font-mono block">
                        {formatPrice(coin.priceUsd)}
                      </span>
                      <span className={`flex items-center justify-end gap-1 text-xs font-medium ${
                        coin.priceChange24h >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {coin.priceChange24h >= 0 ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        {Math.abs(coin.priceChange24h).toFixed(2)}%
                      </span>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-600 group-hover:text-indigo-400 transition-colors" />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
