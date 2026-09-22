'use client';

import React from 'react';
import { AlertOctagon, Droplets, Scale, Clock, ArrowLeftRight } from 'lucide-react';
import { useCoinStore } from '@/store/useCoinStore';

type Tone = 'pos' | 'neg' | 'warn' | 'neutral';

const TONE_TEXT: Record<Tone, string> = {
  pos: 'text-pos',
  neg: 'text-neg',
  warn: 'text-warn',
  neutral: 'text-slate-400',
};

/**
 * Facts derived from the token's own market data.
 * Nothing here is invented: every line states a measured number and what it implies.
 */
export const InsightsPanel: React.FC = () => {
  const { aiAnalysis, isAiLoading, selectedCoin } = useCoinStore();

  if (isAiLoading || !selectedCoin || !aiAnalysis) return null;

  const mcap = selectedCoin.fundamentals.marketCap || 0;
  const liq = selectedCoin.fundamentals.tvl || 0;
  const vol = selectedCoin.fundamentals.volume24h || 0;
  const buys = selectedCoin.txns24h?.buys ?? 0;
  const sells = selectedCoin.txns24h?.sells ?? 0;
  const ageMin = selectedCoin.createdAt ? (Date.now() - selectedCoin.createdAt) / 60_000 : null;

  const rows: { icon: React.ElementType; label: string; value: string; note: string; tone: Tone }[] = [];

  if (liq > 0 && mcap > 0) {
    const ratio = (liq / mcap) * 100;
    rows.push({
      icon: Droplets,
      label: 'Liquidity vs market cap',
      value: `${ratio.toFixed(1)}%`,
      note: ratio >= 15 ? 'Deep enough to exit a small position.' : ratio >= 3 ? 'Thin. Exits will move the price.' : 'Very thin relative to valuation.',
      tone: ratio >= 15 ? 'pos' : ratio >= 3 ? 'warn' : 'neg',
    });
  }

  if (vol > 0 && mcap > 0) {
    const turnover = vol / mcap;
    rows.push({
      icon: Scale,
      label: 'Volume turnover 24h',
      value: `${turnover.toFixed(2)}×`,
      note: turnover > 0.5 ? 'Actively traded against its size.' : turnover > 0.05 ? 'Moderate activity.' : 'Barely traded.',
      tone: turnover > 0.5 ? 'pos' : turnover > 0.05 ? 'neutral' : 'warn',
    });
  }

  if (buys + sells > 0) {
    const share = (buys / (buys + sells)) * 100;
    rows.push({
      icon: ArrowLeftRight,
      label: 'Buy share of trades',
      value: `${share.toFixed(0)}%`,
      note: `${buys.toLocaleString()} buys against ${sells.toLocaleString()} sells in 24h.`,
      tone: share >= 65 ? 'pos' : share >= 45 ? 'neutral' : 'neg',
    });
  }

  if (ageMin !== null) {
    const label = ageMin < 60 ? `${Math.round(ageMin)}m` : ageMin < 1440 ? `${Math.round(ageMin / 60)}h` : `${Math.round(ageMin / 1440)}d`;
    rows.push({
      icon: Clock,
      label: 'Age since pool creation',
      value: label,
      note: ageMin < 15 ? 'Minutes old. Rug risk is highest here.' : ageMin < 1440 ? 'Still within the first day.' : 'Survived past the first day.',
      tone: ageMin < 15 ? 'neg' : ageMin < 1440 ? 'warn' : 'pos',
    });
  }

  const flags = aiAnalysis.risk_protocol.flags;

  if (rows.length === 0 && flags.length === 0) return null;

  return (
    <aside className="panel overflow-hidden">
      <header className="px-5 py-3.5 border-b border-line flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-bold text-white">Signals</h3>
        <span className="text-[11px] text-slate-500">Derived from live market data</span>
      </header>

      <dl className="divide-y divide-[rgba(255,255,255,0.06)]">
        {rows.map(({ icon: Icon, label, value, note, tone }) => (
          <div key={label} className="px-5 py-3">
            <div className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-2 text-[13px] text-slate-300 min-w-0">
                <Icon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span className="truncate">{label}</span>
              </dt>
              <dd className={`font-mono font-bold text-[13px] shrink-0 ${TONE_TEXT[tone]}`}>{value}</dd>
            </div>
            <p className="text-[11px] text-slate-500 mt-1 ml-5.5 leading-relaxed">{note}</p>
          </div>
        ))}
      </dl>

      {flags.length > 0 && (
        <div className="px-5 py-3.5 border-t border-line">
          <p className="flex items-center gap-2 text-[11px] font-semibold text-neg mb-2">
            <AlertOctagon className="w-3.5 h-3.5" />
            Risk flags — {aiAnalysis.risk_protocol.level.toLowerCase()} risk
          </p>
          <ul className="space-y-1">
            {flags.map((flag, i) => (
              <li key={i} className="text-xs text-slate-400 leading-relaxed">
                {flag}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
};
