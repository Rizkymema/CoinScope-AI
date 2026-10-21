'use client';

import React, { useMemo } from 'react';
import { LineChart } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useBotStore } from '@/store/useBotStore';

const W = 600;
const H = 120;

/** Cumulative realized P&L of the current mode (paper or live), one point per closed trade. */
export const PnlCurve: React.FC = () => {
  const { history, live } = useBotStore(useShallow((s) => ({ history: s.history, live: !s.settings.paperTrading })));

  const trades = useMemo(() => history.filter((h) => h.isLive === live).sort((a, b) => a.soldAt - b.soldAt), [history, live]);
  const points = useMemo(() => {
    let sum = 0;
    return [0, ...trades.map((t) => (sum += t.pnlUsd))];
  }, [trades]);

  const total = points[points.length - 1];
  const wins = trades.filter((t) => t.pnlUsd > 0).length;
  const best = trades.reduce((m, t) => Math.max(m, t.pnlUsd), 0);
  const worst = trades.reduce((m, t) => Math.min(m, t.pnlUsd), 0);

  const lo = Math.min(0, ...points);
  const hi = Math.max(0, ...points);
  const span = hi - lo || 1;
  const y = (v: number) => 6 + (H - 12) * (1 - (v - lo) / span);
  const x = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * W : 0);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const up = total >= 0;
  const color = up ? 'var(--pos)' : 'var(--neg)';

  return (
    <section className="panel p-4">
      <header className="flex items-center gap-2 flex-wrap">
        <LineChart className="w-4 h-4 text-slate-500" />
        <h3 className="text-[13px] font-bold text-white">Realized P&amp;L</h3>
        <span className={live ? 'chip chip-neg' : 'chip chip-warn'}>{live ? 'Live' : 'Paper'}</span>
        <span className={`ml-auto text-[15px] font-mono font-bold ${up ? 'text-pos' : 'text-neg'}`}>
          {up ? '+' : '−'}${Math.abs(total).toFixed(2)}
        </span>
      </header>

      {trades.length === 0 ? (
        <p className="text-[13px] text-slate-500 py-8 text-center">The curve starts with the first closed {live ? 'live' : 'paper'} trade.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full mt-3" style={{ height: H }} role="img" aria-label={`Cumulative realized P&L over ${trades.length} trades: ${up ? '+' : '-'}$${Math.abs(total).toFixed(2)}`}>
            <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            <polygon points={`0,${y(0)} ${line} ${x(points.length - 1)},${y(0)}`} fill={color} opacity="0.08" />
            <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <dl className="grid grid-cols-4 gap-2 mt-3 text-[11px]">
            <div>
              <dt className="text-slate-500">Trades</dt>
              <dd className="font-mono text-white font-semibold">{trades.length}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Win rate</dt>
              <dd className="font-mono text-white font-semibold">{((wins / trades.length) * 100).toFixed(0)}%</dd>
            </div>
            <div>
              <dt className="text-slate-500">Best</dt>
              <dd className="font-mono text-pos font-semibold">+${best.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Worst</dt>
              <dd className="font-mono text-neg font-semibold">−${Math.abs(worst).toFixed(2)}</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
};
