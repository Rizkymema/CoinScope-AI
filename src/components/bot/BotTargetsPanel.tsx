'use client';

import React, { useState } from 'react';
import { Target, Plus, Search, Trash2, Zap, Check } from 'lucide-react';
import { useBotStore } from '@/store/useBotStore';

const SUGGESTIONS = ['BONK', 'WIF', 'POPCAT', 'PEPE', 'PUMP', 'TRUMP', 'MEW', 'FARTCOIN'];

export const BotTargetsPanel: React.FC = () => {
  const { settings, updateSettings, addTargetSymbol, removeTargetSymbol, manualSnipeCoin, findCoin, log } = useBotStore();
  const [input, setInput] = useState('');

  const add = () => {
    const v = input.trim();
    if (!v) return;
    addTargetSymbol(v);
    setInput('');
  };

  const buyNow = (symbol: string) => {
    const coin = findCoin(symbol);
    if (!coin) {
      log(
        'warning',
        `${symbol} is not in the live scanner yet. It will be bought automatically once it appears, or search for it under Market to buy now.`
      );
      return;
    }
    manualSnipeCoin(coin, undefined, 'watchlist');
  };

  return (
    <div className="space-y-4">
      {/* mode */}
      <section className="panel p-5 flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-white flex items-center gap-2">
            <Target className="w-4 h-4 text-slate-500" />
            Watchlist
          </h3>
          <p className="text-[13px] text-slate-400 mt-1.5 max-w-xl leading-relaxed">
            Name the tokens you care about. Turn on watchlist-only mode and the bot ignores every launch that is not on this
            list.
          </p>
        </div>

        <div className="flex items-center gap-3 panel-2 px-4 py-3 shrink-0">
          <div className="text-right">
            <p className="text-xs font-semibold text-white">Watchlist only</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {settings.targetOnlyMode ? 'Buying listed tokens only' : 'Buying every qualifying launch'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.targetOnlyMode}
            aria-label="Watchlist only mode"
            onClick={() => updateSettings({ targetOnlyMode: !settings.targetOnlyMode })}
            className={`relative w-9 h-5 rounded-full shrink-0 transition-colors duration-150 ${
              settings.targetOnlyMode ? 'bg-signal' : 'bg-ink-700'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-150 ${
                settings.targetOnlyMode ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </section>

      {/* add */}
      <section className="panel p-5 space-y-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="Token symbol or contract address"
              aria-label="Token symbol or contract address"
              className="field pl-9 font-mono"
            />
          </div>
          <button type="button" onClick={add} disabled={!input.trim()} className="btn btn-primary shrink-0">
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-slate-500 mr-1">Quick add</span>
          {SUGGESTIONS.map((symbol) => {
            const added = settings.whitelistedSymbols.some((s) => s.toUpperCase() === symbol);
            return (
              <button
                key={symbol}
                type="button"
                onClick={() => (added ? removeTargetSymbol(symbol) : addTargetSymbol(symbol))}
                className={added ? 'chip chip-pos' : 'chip hover:border-line-strong transition-colors'}
              >
                {added ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                {symbol}
              </button>
            );
          })}
        </div>
      </section>

      {/* list */}
      <section className="panel p-5">
        <div className="flex items-center justify-between gap-3 pb-3 mb-4 border-b border-line">
          <h4 className="text-[13px] font-bold text-white">
            Tracked tokens <span className="text-slate-500 font-normal">({settings.whitelistedSymbols.length})</span>
          </h4>
          <span className="text-[11px] text-slate-500">Buy size ${settings.buyAmountUsd}</span>
        </div>

        {settings.whitelistedSymbols.length === 0 ? (
          <div className="text-center py-12">
            <Target className="w-7 h-7 text-slate-600 mx-auto mb-3" />
            <p className="text-[13px] font-semibold text-slate-300">Nothing tracked yet</p>
            <p className="text-xs text-slate-500 mt-1">Add a symbol above or pick one of the quick-add chips.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {settings.whitelistedSymbols.map((symbol) => (
              <li key={symbol} className="panel-2 p-3 flex items-center gap-3">
                <span className="grid place-items-center w-9 h-9 rounded-lg bg-ink-800 text-slate-300 text-[11px] font-bold shrink-0">
                  {symbol.replace(/^\$/, '').slice(0, 3).toUpperCase()}
                </span>
                <span className="font-semibold text-white text-[13px] truncate min-w-0 flex-1 font-mono">{symbol}</span>
                <button type="button" onClick={() => buyNow(symbol)} className="btn btn-sm btn-secondary shrink-0">
                  <Zap className="w-3 h-3" />
                  Buy
                </button>
                <button
                  type="button"
                  onClick={() => removeTargetSymbol(symbol)}
                  aria-label={`Remove ${symbol}`}
                  className="p-1.5 rounded-md text-slate-500 hover:text-neg hover:bg-neg/10 transition-colors shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
