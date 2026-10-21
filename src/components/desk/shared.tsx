'use client';

import React, { useEffect, useState } from 'react';
import type { Candle } from '@/services/chart.service';

/** Current time, refreshed every `intervalMs` (countdowns and elapsed timers). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export const seconds = (ms: number) => `${Math.max(0, Math.round(ms / 1000))}s`;

export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Turns 10 s price samples into candles of `bucketSec` seconds (volume unknown, so 0). */
export function samplesToCandles(samples: { t: number; price: number }[], bucketSec = 60): Candle[] {
  const out: Candle[] = [];
  for (const s of samples) {
    const time = Math.floor(s.t / 1000 / bucketSec) * bucketSec;
    const last = out[out.length - 1];
    if (last && last.time === time) {
      last.high = Math.max(last.high, s.price);
      last.low = Math.min(last.low, s.price);
      last.close = s.price;
    } else {
      out.push({ time, open: last ? last.close : s.price, high: s.price, low: s.price, close: s.price, volume: 0 });
    }
  }
  return out;
}

/**
 * Moves the newest candle to the live price (or opens the next one), so the chart ticks with the
 * position between candle refreshes. A price far from the series (another quote unit) is ignored.
 */
export function withLivePrice(candles: Candle[], price: number | undefined, bucketSec: number): Candle[] {
  if (!candles.length || !price || !(price > 0)) return candles;
  const last = candles[candles.length - 1];
  if (price > last.close * 2 || price < last.close / 2) return candles;
  const bucket = Math.floor(Date.now() / 1000 / bucketSec) * bucketSec;
  if (bucket > last.time) {
    return [...candles, { time: bucket, open: last.close, high: Math.max(last.close, price), low: Math.min(last.close, price), close: price, volume: 0 }];
  }
  return [...candles.slice(0, -1), { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price }];
}

/** Small line chart of recent marks with the entry as a dashed baseline. */
export const Sparkline: React.FC<{ points: number[]; baseline?: number; up: boolean; height?: number; className?: string }> = ({
  points,
  baseline,
  up,
  height = 36,
  className = '',
}) => {
  const width = 160;
  if (points.length < 2) {
    return <div className={`text-[11px] text-slate-600 grid place-items-center ${className}`} style={{ height }}>Collecting ticks…</div>;
  }
  const values = baseline && baseline > 0 ? [...points, baseline] : points;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || hi * 0.01 || 1;
  const y = (v: number) => 2 + (height - 4) * (1 - (v - lo) / span);
  const x = (i: number) => (i / (points.length - 1)) * width;
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const color = up ? 'var(--pos)' : 'var(--neg)';
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={`w-full ${className}`} style={{ height }} aria-hidden="true">
      {baseline && baseline > 0 && (
        <line x1="0" x2={width} y1={y(baseline)} y2={y(baseline)} stroke="var(--text-faint)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      )}
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r="2" fill={color} />
    </svg>
  );
};

/**
 * Price that briefly tints green or red when it changes (one 600 ms flash per change, no loop).
 * `direction` comes from the caller, which knows the previous mark.
 */
export const TickingPrice: React.FC<{ value: string; direction: 'up' | 'down' | null; className?: string }> = ({ value, direction, className = '' }) => (
  <span key={value} className={`rounded px-1 -mx-1 ${direction === 'up' ? 'tick-up' : direction === 'down' ? 'tick-down' : ''} ${className}`}>
    {value}
  </span>
);
