'use client';

import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Check,
  ExternalLink,
  Loader2,
  Plus,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useCoinStore } from '@/store/useCoinStore';
import { useBotStore } from '@/store/useBotStore';
import { CoinAvatar, ChainBadge, formatPrice, formatNumber } from './CoinAvatar';

const CATEGORY_CHIP: Record<string, string> = {
  Buy: 'chip chip-pos',
  Watchlist: 'chip chip-warn',
  Hold: 'chip chip-accent',
  Avoid: 'chip chip-neg',
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="min-w-0">
    <dt className="text-[11px] text-slate-500">{label}</dt>
    <dd className="text-[13px] font-mono font-semibold text-slate-200 truncate">{value}</dd>
  </div>
);

export const CoinScoreCard: React.FC = () => {
  const { aiAnalysis, isAiLoading, aiError, aiSource, fetchAIAnalysis, selectedCoin } = useCoinStore();
  const { manualSnipeCoin, settings, addTargetSymbol, removeTargetSymbol } = useBotStore();

  const watched = selectedCoin
    ? settings.whitelistedSymbols.some((s) => s.toUpperCase() === selectedCoin.symbol.toUpperCase())
    : false;

  if (!selectedCoin && !isAiLoading) return null;

  if (isAiLoading) {
    return (
      <div className="panel p-5 flex items-center gap-3">
        <Loader2 className="w-4 h-4 text-signal animate-spin shrink-0" />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-white">Scoring {selectedCoin?.symbol ?? 'token'}</p>
          <p className="text-xs text-slate-500 mt-0.5">Reading liquidity, order flow and momentum.</p>
        </div>
      </div>
    );
  }

  if (aiError) {
    return (
      <div className="panel p-5 border-neg/30">
        <p className="text-[13px] font-semibold text-white flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-neg shrink-0" />
          Analysis failed
        </p>
        <p className="text-xs text-slate-400 mt-1.5">{aiError}</p>
        <button
          type="button"
          onClick={() => selectedCoin && fetchAIAnalysis(selectedCoin)}
          className="btn btn-sm btn-secondary mt-3"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!aiAnalysis || !selectedCoin) return null;

  const score = aiAnalysis.score;
  const scoreTone = score >= 70 ? 'text-pos' : score >= 40 ? 'text-warn' : 'text-neg';
  const up = selectedCoin.priceChange24h >= 0;

  const breakdown = [
    { label: 'Fundamental', value: aiAnalysis.breakdown.fundamental, icon: TrendingUp },
    { label: 'Technical', value: aiAnalysis.breakdown.technical, icon: BarChart3 },
    { label: 'Sentiment', value: aiAnalysis.breakdown.sentiment, icon: Target },
    { label: 'Risk', value: aiAnalysis.breakdown.risk, icon: AlertTriangle },
  ];

  return (
    <article className="panel overflow-hidden">
      {/* ---------------------------------------------------------- header */}
      <header className="p-5 border-b border-line">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <CoinAvatar
              imageUrl={selectedCoin.imageUrl}
              symbol={selectedCoin.symbol}
              chainId={selectedCoin.chainId}
              size="lg"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[15px] font-bold text-white truncate">{selectedCoin.symbol}</h2>
                <ChainBadge chainId={selectedCoin.chainId} />
                <span className={CATEGORY_CHIP[aiAnalysis.category] ?? 'chip'}>{aiAnalysis.category}</span>
              </div>
              <p className="text-xs text-slate-500 truncate mt-0.5">{selectedCoin.name}</p>
              <div className="flex items-baseline gap-2.5 mt-2">
                <span className="text-xl font-bold text-white font-mono">{formatPrice(selectedCoin.priceUsd)}</span>
                <span className={`inline-flex items-center gap-1 text-[13px] font-mono font-semibold ${up ? 'text-pos' : 'text-neg'}`}>
                  {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                  {up ? '+' : '−'}
                  {Math.abs(selectedCoin.priceChange24h).toFixed(2)}%
                </span>
              </div>
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className={`text-3xl font-extrabold font-mono leading-none ${scoreTone}`}>{score}</div>
            <div className="text-[11px] text-slate-500 mt-1">
              score · {aiSource === 'ai' ? 'model' : 'rules'}
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-line">
          <Stat label="Market cap" value={formatNumber(selectedCoin.fundamentals.marketCap)} />
          <Stat label="Volume 24h" value={formatNumber(selectedCoin.fundamentals.volume24h)} />
          <Stat label="Liquidity" value={formatNumber(selectedCoin.fundamentals.tvl || 0)} />
        </dl>

        <div className="flex flex-col sm:flex-row items-stretch gap-2 mt-4">
          <button type="button" onClick={() => manualSnipeCoin(selectedCoin)} className="btn btn-primary flex-1">
            <Zap className="w-4 h-4" />
            Buy {selectedCoin.symbol} · ${settings.buyAmountUsd}
            <span className="font-normal opacity-70">{settings.paperTrading ? '(paper)' : '(live)'}</span>
          </button>
          <button
            type="button"
            onClick={() => (watched ? removeTargetSymbol(selectedCoin.symbol) : addTargetSymbol(selectedCoin.symbol))}
            className={`btn ${watched ? 'btn-secondary text-pos' : 'btn-secondary'}`}
          >
            {watched ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {watched ? 'On watchlist' : 'Watch'}
          </button>
          {selectedCoin.url && (
            <a href={selectedCoin.url} target="_blank" rel="noreferrer" className="btn btn-ghost">
              Chart
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </header>

      {/* ---------------------------------------------------------- body */}
      <div className="p-5 space-y-4">
        <p className="text-[13px] text-slate-300 leading-relaxed">{aiAnalysis.analysis}</p>

        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {breakdown.map(({ label, value, icon: Icon }) => (
            <div key={label} className="panel-2 p-3">
              <dt className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <Icon className="w-3 h-3 text-slate-500" />
                {label}
              </dt>
              <dd className="mt-1.5">
                <div className="h-1 rounded-full bg-ink-800 overflow-hidden" role="presentation">
                  <div
                    className={`h-full rounded-full ${value >= 70 ? 'bg-pos' : value >= 40 ? 'bg-warn' : 'bg-neg'}`}
                    style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
                  />
                </div>
                <span className="block mt-1.5 text-[15px] font-bold font-mono text-white">
                  {value}
                  <span className="text-[11px] text-slate-500 font-normal">/100</span>
                </span>
              </dd>
            </div>
          ))}
        </dl>

        {aiAnalysis.risk_protocol.flags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-3 border-t border-line">
            <span className="text-[11px] text-slate-500 mr-1">Risk flags</span>
            {aiAnalysis.risk_protocol.flags.map((flag, i) => (
              <span key={i} className="chip chip-neg">
                {flag}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
};
