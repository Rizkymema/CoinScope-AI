'use client';

import React from 'react';
import { useCoinStore } from '@/store/useCoinStore';
import { CoinAvatar, ChainBadge, formatPrice, formatNumber } from './CoinAvatar';
import { AlertCircle, Target, TrendingUp, TrendingDown, BarChart3, AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';

export const CoinScoreCard: React.FC = () => {
  const { aiAnalysis, isAiLoading, aiError, fetchAIAnalysis, selectedCoin } = useCoinStore();

  if (!selectedCoin && !isAiLoading) return null;

  if (isAiLoading) {
    return (
      <div className="p-6 surface rounded-2xl space-y-4">
        {selectedCoin && (
          <div className="flex items-center gap-4 pb-4 border-b border-white/8">
            <CoinAvatar
              imageUrl={selectedCoin.imageUrl}
              symbol={selectedCoin.symbol}
              chainId={selectedCoin.chainId}
              size="xl"
              showChain={true}
            />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white">{selectedCoin.symbol}</h2>
                <ChainBadge chainId={selectedCoin.chainId} />
              </div>
              <p className="text-sm text-slate-400">{selectedCoin.name}</p>
              <p className="text-lg font-bold text-white font-mono mt-1">
                {formatPrice(selectedCoin.priceUsd)}
              </p>
            </div>
          </div>
        )}
        <div className="flex items-center justify-center py-8 gap-3">
          <Loader2 className="w-6 h-6 text-signal animate-spin" />
          <span className="text-sm text-slate-400">Running AI analysis...</span>
        </div>
      </div>
    );
  }

  if (aiError) {
    return (
      <div className="p-6 bg-red-950/10 border border-red-900/30 rounded-2xl">
        <div className="flex items-center text-red-400 mb-2">
          <AlertCircle className="w-5 h-5 mr-2" />
          <h3 className="font-medium">Analysis Failed</h3>
        </div>
        <p className="text-sm text-red-400/80 mb-4">{aiError}</p>
        <button 
          onClick={() => selectedCoin && fetchAIAnalysis(selectedCoin.symbol)}
          className="px-4 py-2 bg-red-900/30 text-red-300 rounded-xl hover:bg-red-900/50 transition-colors text-sm font-medium"
        >
          Retry Analysis
        </button>
      </div>
    );
  }

  if (!aiAnalysis || !selectedCoin) return null;

  const scoreColor = aiAnalysis.score >= 70 ? 'text-emerald-400' : aiAnalysis.score >= 40 ? 'text-amber-400' : 'text-red-400';
  const scoreBg = aiAnalysis.score >= 70 ? 'from-emerald-500/20 to-emerald-500/5' : aiAnalysis.score >= 40 ? 'from-amber-500/20 to-amber-500/5' : 'from-red-500/20 to-red-500/5';
  const scoreRing = aiAnalysis.score >= 70 ? 'ring-emerald-500/30' : aiAnalysis.score >= 40 ? 'ring-amber-500/30' : 'ring-red-500/30';

  return (
    <div className="surface rounded-2xl overflow-hidden">
      <div className="p-6 border-b border-white/8 bg-gradient-to-r from-signal/5 to-transparent">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <CoinAvatar
              imageUrl={selectedCoin.imageUrl}
              symbol={selectedCoin.symbol}
              chainId={selectedCoin.chainId}
              size="xl"
              showChain={true}
            />
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-xl font-bold text-white">{selectedCoin.symbol}</h2>
                <ChainBadge chainId={selectedCoin.chainId} />
              </div>
              <p className="text-sm text-slate-400 mb-2">{selectedCoin.name}</p>
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold text-white font-mono">
                  {formatPrice(selectedCoin.priceUsd)}
                </span>
                <span className={`flex items-center gap-1 text-sm font-bold px-2 py-0.5 rounded-lg ${
                  selectedCoin.priceChange24h >= 0
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-red-500/15 text-red-400'
                }`}>
                  {selectedCoin.priceChange24h >= 0 ? (
                    <TrendingUp className="w-3.5 h-3.5" />
                  ) : (
                    <TrendingDown className="w-3.5 h-3.5" />
                  )}
                  {Math.abs(selectedCoin.priceChange24h).toFixed(2)}%
                </span>
              </div>
            </div>
          </div>

          {/* Score Circle */}
          <div className={`flex flex-col items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-b ${scoreBg} ring-2 ${scoreRing}`}>
            <div className={`text-3xl font-black ${scoreColor}`}>{aiAnalysis.score}</div>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Score</div>
          </div>
        </div>

        {/* Quick stats row */}
        <div className="flex items-center gap-4 mt-4 text-xs">
          <span className="text-slate-500">
            MCap: <span className="text-slate-300 font-medium">{formatNumber(selectedCoin.fundamentals.marketCap)}</span>
          </span>
          <span className="text-slate-500">
            Vol: <span className="text-slate-300 font-medium">{formatNumber(selectedCoin.fundamentals.volume24h)}</span>
          </span>
          <span className="text-slate-500">
            Liq: <span className="text-slate-300 font-medium">{formatNumber(selectedCoin.fundamentals.tvl || 0)}</span>
          </span>
          {selectedCoin.url && (
            <a
              href={selectedCoin.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-signal-soft hover:text-signal ml-auto"
            >
              <ExternalLink className="w-3 h-3" />
              DexScreener
            </a>
          )}
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Category Badge */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">AI Confidence Score</h3>
          <span className={`text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-lg border ${
            aiAnalysis.category === 'Buy' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
            aiAnalysis.category === 'Watchlist' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
            aiAnalysis.category === 'Hold' ? 'bg-sky-500/10 text-sky-400 border-sky-500/30' :
            'bg-red-500/10 text-red-400 border-red-500/30'
          }`}>
            {aiAnalysis.category}
          </span>
        </div>

        <div className="p-4 bg-signal/5 border border-signal/15 rounded-xl">
          <p className="text-sm text-teal-100/90 leading-relaxed">
            &quot;{aiAnalysis.analysis}&quot;
          </p>
        </div>

        {/* Breakdown Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Fundamental', value: aiAnalysis.breakdown.fundamental, icon: TrendingUp, color: 'text-emerald-400' },
            { label: 'Technical', value: aiAnalysis.breakdown.technical, icon: BarChart3, color: 'text-cyan-400' },
            { label: 'Sentiment', value: aiAnalysis.breakdown.sentiment, icon: Target, color: 'text-amber-400' },
            { label: 'Risk Model', value: aiAnalysis.breakdown.risk, icon: AlertTriangle, color: 'text-rose-400' },
          ].map((stat, i) => (
            <div key={i} className="p-3 bg-white/[0.03] rounded-xl border border-white/8">
              <div className="flex items-center text-slate-400 mb-2">
                <stat.icon className={`w-3.5 h-3.5 mr-1.5 ${stat.color}`} />
                <span className="text-[10px] font-semibold uppercase tracking-wider">{stat.label}</span>
              </div>
              <div className="w-full bg-slate-700/30 rounded-full h-1.5 mb-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all duration-1000 ${
                    stat.value >= 70 ? 'bg-emerald-500' : stat.value >= 40 ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${stat.value}%` }}
                ></div>
              </div>
              <div className="text-lg font-bold text-white">{stat.value}<span className="text-xs text-slate-500">/100</span></div>
            </div>
          ))}
        </div>

        {aiAnalysis.risk_protocol.flags.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-3 border-t border-white/8">
            <span className="text-[10px] text-slate-500 flex items-center h-6 uppercase tracking-wider font-medium">Risk Flags:</span>
            {aiAnalysis.risk_protocol.flags.map((flag, idx) => (
               <span key={idx} className="px-2.5 py-1 bg-red-950/20 text-red-400 text-xs rounded-lg border border-red-900/20 font-medium">
                 {flag}
               </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
