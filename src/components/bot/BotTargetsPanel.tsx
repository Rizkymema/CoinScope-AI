'use client';

import React, { useState } from 'react';
import { Target, Plus, Search, Check, ShieldCheck, Trash2, Zap } from 'lucide-react';
import { useBotStore } from '@/store/useBotStore';

export const BotTargetsPanel: React.FC = () => {
  const { settings, updateSettings, addTargetSymbol, removeTargetSymbol, manualSnipeCoin, findCoin, log } = useBotStore();
  const [customCoinInput, setCustomCoinInput] = useState('');

  return (
    <div className="bg-ink-900/80 border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-xl space-y-8 animate-fade-up">
      {/* HEADER & TARGET MODE TOGGLE BANNER */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 bg-gradient-to-r from-amber-500/10 via-purple-500/10 to-emerald-500/10 border border-amber-500/30 rounded-2xl p-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Target className="w-6 h-6 text-amber-400" />
            <h3 className="font-display text-xl font-bold text-white">
              Pilih & Kelola Coin Target Bot
            </h3>
          </div>
          <p className="text-slate-300 text-sm max-w-xl">
            Tentukan coin spesifik yang ingin Anda beli dengan Bot. Anda bisa membeli secara instan atau mengaktifkan <strong>Mode Target Khusus</strong> agar bot hanya mengeksekusi daftar coin yang Anda pilih.
          </p>
        </div>

        {/* Target Only Mode Switch */}
        <div className="flex items-center gap-4 bg-ink-950/80 border border-white/10 p-4 rounded-xl shrink-0">
          <div className="text-right">
            <div className="text-xs font-bold text-white uppercase tracking-wider">
              Mode Target Khusus
            </div>
            <div className="text-[11px] text-slate-400">
              {settings.targetOnlyMode ? '🎯 Beli Coin Pilihan Saja' : '🌐 Snipe Semua Coin Baru'}
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.targetOnlyMode}
              onChange={(e) => updateSettings({ targetOnlyMode: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-12 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-400"></div>
          </label>
        </div>
      </div>

      {/* INPUT FORM: ADD CUSTOM COIN TARGET */}
      <div className="space-y-4">
        <h4 className="font-bold text-white text-base flex items-center gap-2">
          <Plus className="w-5 h-5 text-amber-400" />
          Tambah Simbol Coin / Token Address ke Target
        </h4>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={customCoinInput}
              onChange={(e) => setCustomCoinInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customCoinInput.trim()) {
                  addTargetSymbol(customCoinInput);
                  setCustomCoinInput('');
                }
              }}
              placeholder="Ketik simbol token (cth: BONK, WIF, POPCAT, PEPE) atau Contract Address..."
              className="w-full bg-ink-950 border border-white/15 focus:border-amber-400 rounded-xl pl-10 pr-4 py-3 text-white text-sm focus:outline-none transition-all placeholder:text-slate-500 font-mono"
            />
          </div>
          <button
            onClick={() => {
              if (customCoinInput.trim()) {
                addTargetSymbol(customCoinInput);
                setCustomCoinInput('');
              }
            }}
            className="px-6 py-3 bg-amber-400 hover:bg-amber-500 text-ink-950 font-bold rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-400/20 active:scale-95"
          >
            <Plus className="w-4 h-4" />
            Tambah ke Target Bot
          </button>
        </div>

        {/* QUICK PRESETS */}
        <div className="flex items-center gap-2 flex-wrap pt-2">
          <span className="text-xs text-slate-400 font-medium">Rekomendasi Cepat:</span>
          {['BONK', 'WIF', 'POPCAT', 'PEPE', 'PUMP', 'TRUMP', 'MEW', 'SOL'].map((symbol) => {
            const isAdded = settings.whitelistedSymbols.some((s) => s.toUpperCase() === symbol);
            return (
              <button
                key={symbol}
                onClick={() => (isAdded ? removeTargetSymbol(symbol) : addTargetSymbol(symbol))}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  isAdded
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10'
                }`}
              >
                {isAdded ? <Check className="w-3 h-3 text-emerald-400" /> : <Plus className="w-3 h-3" />}
                ${symbol}
              </button>
            );
          })}
        </div>
      </div>

      {/* ACTIVE TARGET COINS LIST */}
      <div className="space-y-4 pt-4 border-t border-white/10">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-white text-base flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            Daftar Coin Pilihan Anda ({settings.whitelistedSymbols.length})
          </h4>
          <span className="text-xs text-slate-400">
            Ukuran Snipe: <strong>${settings.buyAmountUsd}</strong> / transaksi
          </span>
        </div>

        {settings.whitelistedSymbols.length === 0 ? (
          <div className="text-center py-12 bg-black/40 border border-white/8 rounded-2xl">
            <Target className="w-10 h-10 text-slate-600 mx-auto mb-2" />
            <p className="text-slate-300 text-sm font-semibold">Belum Ada Coin Target Yang Dipilih</p>
            <p className="text-slate-500 text-xs mt-1">
              Ketik simbol coin di atas atau klik salah satu rekomendasi cepat untuk mendaftarkan coin target Anda.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {settings.whitelistedSymbols.map((symbol) => (
              <div
                key={symbol}
                className="bg-ink-950/90 border border-amber-500/30 hover:border-amber-400 rounded-2xl p-4 transition-all duration-300 shadow-lg flex flex-col justify-between space-y-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-400/15 border border-amber-400/30 text-amber-400 font-extrabold flex items-center justify-center text-sm font-mono">
                      ${symbol.slice(0, 3)}
                    </div>
                    <div>
                      <div className="font-bold text-white text-base flex items-center gap-1">
                        ${symbol}
                      </div>
                      <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-500/15 px-2 py-0.5 rounded">
                        Target Active
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => removeTargetSymbol(symbol)}
                    className="p-1.5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-lg transition-colors"
                    title="Hapus dari Target"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="pt-2 border-t border-white/5 flex items-center gap-2">
                  <button
                    onClick={() => {
                      const coin = findCoin(symbol);
                      if (!coin) {
                        log('warning', `[TARGET] ${symbol} is not in the live scanner yet - it will be sniped automatically when it appears, or search it in Trending to buy now.`);
                        return;
                      }
                      manualSnipeCoin(coin, undefined, 'target list');
                    }}
                    className="w-full bg-gradient-to-r from-amber-400 to-emerald-400 hover:from-amber-500 hover:to-emerald-500 text-ink-950 font-extrabold py-2.5 rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow shadow-amber-400/20 active:scale-95"
                  >
                    <Zap className="w-3.5 h-3.5 fill-current" />
                    Beli Sekarang (${settings.buyAmountUsd})
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
