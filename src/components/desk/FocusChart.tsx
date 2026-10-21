'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CandlestickChart, ExternalLink, Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useBotStore } from '@/store/useBotStore';
import { useScannerStore } from '@/store/useScannerStore';
import { BotPosition } from '@/types/bot';
import { CoinData } from '@/types/coin';
import { cachedCandles, ScanSignal } from '@/services/scanner.service';
import { LaunchWatcher } from '@/services/launch.service';
import { Candle, ChartService } from '@/services/chart.service';
import { formatPrice } from '@/lib/formatters';
import { PriceChart, ChartLevel, ChartMarker } from '../PriceChart';
import { CoinAvatar } from '../CoinAvatar';
import { samplesToCandles, TickingPrice, withLivePrice } from './shared';

/** What the chart follows: an open position or a signal (`pos:<id>` / `sig:<mint>`). */
export type FocusKey = string;

interface FocusOption {
  key: FocusKey;
  coin: CoinData;
  mint: string;
  label: string;
  tone: 'pos' | 'neg' | 'accent' | 'warn' | 'plain';
  position?: BotPosition;
  signal?: ScanSignal;
}

const mintOf = (c: CoinData) => c.mint || (c.id.includes(':') ? c.id.split(':')[1] : c.id);
/** A position's chart refetches pool candles at most this often; the live price moves the last candle in between. */
const FETCH_EVERY_MS = 60_000;
const LOCAL_EVERY_MS = 10_000;

/**
 * Everything worth a chart right now, most important first: open positions, the candidate under
 * review, Ready signals, then the best Watching one when nothing else is going on.
 */
export function useFocusOptions(): FocusOption[] {
  const positions = useBotStore((s) => s.positions);
  const { signals, launches, review } = useScannerStore(useShallow((s) => ({ signals: s.signals, launches: s.launches, review: s.review })));
  return useMemo(() => {
    const out: FocusOption[] = [];
    const seen = new Set<string>();
    positions.forEach((p) => {
      const mint = p.mint || mintOf(p.coin);
      seen.add(mint);
      out.push({ key: `pos:${p.id}`, coin: p.coin, mint, label: p.isLive ? 'Live position' : 'Paper position', tone: p.pnlUsd >= 0 ? 'pos' : 'neg', position: p });
    });
    const addSignal = (s: ScanSignal, label: string, tone: FocusOption['tone']) => {
      if (seen.has(s.id)) return;
      seen.add(s.id);
      out.push({ key: `sig:${s.id}`, coin: s.coin, mint: s.id, label, tone, signal: s });
    };
    if (review && (review.phase !== 'done' || Date.now() - (review.endedAt || 0) < 10 * 60_000)) {
      addSignal(review.signal, review.phase === 'review' ? 'Under review' : review.phase === 'entry' ? 'Buying' : review.outcome === 'bought' ? 'Bought' : 'Reviewed', 'accent');
    }
    const ready = [...signals, ...launches].filter((s) => s.status === 'ready').sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0));
    ready.slice(0, 3).forEach((s) => addSignal(s, 'Ready', 'pos'));
    if (out.length === 0) {
      const watch = [...signals, ...launches].filter((s) => s.status === 'watch').sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0));
      watch.slice(0, 2).forEach((s) => addSignal(s, 'Watching', 'warn'));
    }
    return out;
  }, [positions, signals, launches, review]);
}

const toneChip: Record<FocusOption['tone'], string> = {
  pos: 'chip chip-pos',
  neg: 'chip chip-neg',
  accent: 'chip chip-accent',
  warn: 'chip chip-warn',
  plain: 'chip',
};

/** Candles for the focused token from data the bot already holds, fetching pool candles only when it has none. */
function useFocusCandles(opt: FocusOption | null): { candles: Candle[]; label: string; bucket: number } | null {
  const [base, setBase] = useState<{ candles: Candle[]; label: string; bucket: number } | null>(null);
  const lastFetch = useRef(0);
  const mint = opt?.mint;
  const coin = opt?.coin;

  useEffect(() => {
    if (!mint || !coin) {
      setBase(null);
      return;
    }
    let active = true;
    lastFetch.current = 0;
    setBase(null);

    const load = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const samples = LaunchWatcher.samples(mint);
      if (samples.length >= 3) {
        setBase({ candles: samplesToCandles(samples, 60), label: 'Launch · 10 s samples, 1m', bucket: 60 });
        return;
      }
      const cached = cachedCandles(mint);
      if (cached && Date.now() - cached.at < 5 * 60_000) {
        setBase({ candles: cached.candles, label: 'Scanner candles · 5m', bucket: 300 });
        return;
      }
      if (Date.now() - lastFetch.current < FETCH_EVERY_MS) return;
      lastFetch.current = Date.now();
      const res = await ChartService.getCandlesForCoin(coin, '5m');
      if (!active) return;
      setBase({ candles: res.candles, label: res.source === 'stream' ? 'Live stream · 5m' : res.source === 'pool' ? 'Pool · 5m' : 'No chart data yet', bucket: 300 });
    };
    void load();
    const t = setInterval(() => void load(), LOCAL_EVERY_MS);
    return () => {
      active = false;
      clearInterval(t);
    };
    // The coin object changes on every price tick; the mint decides what to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint]);

  return base;
}

export const FocusChart: React.FC<{ focusKey: FocusKey | null; onFocus: (key: FocusKey) => void }> = ({ focusKey, onFocus }) => {
  const options = useFocusOptions();
  const history = useBotStore((s) => s.history);
  const opt = options.find((o) => o.key === focusKey) || options[0] || null;
  const base = useFocusCandles(opt);

  const livePrice = opt?.position ? opt.position.currentPriceUsd : opt?.signal?.priceUsd;
  const prevPrice = useRef<{ key: string; price: number } | null>(null);
  const direction = useMemo<'up' | 'down' | null>(() => {
    const prev = prevPrice.current;
    const dir = prev && opt && prev.key === opt.key && livePrice ? (livePrice > prev.price ? 'up' : livePrice < prev.price ? 'down' : null) : null;
    if (opt && livePrice) prevPrice.current = { key: opt.key, price: livePrice };
    return dir;
  }, [opt?.key, livePrice]);

  const external = useMemo(() => (base ? { candles: withLivePrice(base.candles, livePrice, base.bucket), label: base.label } : null), [base, livePrice]);

  const levels = useMemo<ChartLevel[]>(() => {
    const s = opt?.signal;
    if (!s || opt?.position) return [];
    const out: ChartLevel[] = [];
    if (s.entryLow) out.push({ price: s.entryLow, kind: 'zone', title: 'Zone' });
    if (s.entryHigh) out.push({ price: s.entryHigh, kind: 'zone', title: 'Zone' });
    if (s.stopPrice) out.push({ price: s.stopPrice, kind: 'sl', title: 'Stop' });
    if (s.targetPrice) out.push({ price: s.targetPrice, kind: 'tp', title: 'Target' });
    return out;
  }, [opt?.key, opt?.signal?.entryLow, opt?.signal?.entryHigh, opt?.signal?.stopPrice, opt?.signal?.targetPrice]);

  const markers = useMemo<ChartMarker[]>(() => {
    if (!opt) return [];
    const out: ChartMarker[] = [];
    if (opt.position) out.push({ time: opt.position.boughtAt, side: 'buy', text: 'Buy' });
    history
      .filter((h) => h.coinSymbol === opt.coin.symbol)
      .slice(0, 6)
      .forEach((h) => {
        out.push({ time: h.boughtAt, side: 'buy' });
        out.push({ time: h.soldAt, side: 'sell', text: `${h.pnlPercent >= 0 ? '+' : ''}${h.pnlPercent.toFixed(0)}%` });
      });
    return out;
  }, [opt?.key, opt?.position?.boughtAt, history]);

  if (!opt) {
    return (
      <section className="panel grid place-items-center text-center px-6 py-16 min-h-[420px]">
        <div>
          <CandlestickChart className="w-7 h-7 text-slate-600 mx-auto mb-3" />
          <p className="text-[13px] font-semibold text-white">Nothing to chart yet</p>
          <p className="text-[13px] text-slate-400 mt-1 max-w-sm leading-relaxed">
            The chart follows your open positions, the token Claude is reviewing and Ready signals. The first scan fills it within a minute.
          </p>
        </div>
      </section>
    );
  }

  const pos = opt.position;
  const zoneMid = opt.signal?.entryLow && opt.signal.entryHigh ? (opt.signal.entryLow + opt.signal.entryHigh) / 2 : 0;
  const changePct = pos ? pos.pnlPercent : zoneMid && livePrice ? (livePrice / zoneMid - 1) * 100 : null;

  return (
    <div className="space-y-2 min-w-0">
      <div className="panel px-4 py-3">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <CoinAvatar imageUrl={opt.coin.imageUrl} symbol={opt.coin.symbol} chainId={opt.coin.chainId} size="md" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[15px] font-bold text-white">${opt.coin.symbol}</span>
              <span className={toneChip[opt.tone]}>{opt.label}</span>
              {opt.signal?.score && <span className="chip">Score {opt.signal.score.total}</span>}
            </div>
            <p className="text-[11px] text-slate-500 truncate">{opt.signal?.reason || opt.coin.name}</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-[19px] font-mono font-bold text-white leading-none">
              <TickingPrice value={formatPrice(livePrice || 0)} direction={direction} />
            </p>
            {changePct !== null && (
              <p className={`text-[11px] font-mono font-semibold mt-1 ${changePct >= 0 ? 'text-pos' : 'text-neg'}`}>
                {changePct >= 0 ? '+' : '−'}
                {Math.abs(changePct).toFixed(2)}% {pos ? 'since entry' : 'vs entry zone'}
              </p>
            )}
          </div>
          {opt.coin.url && (
            <a href={opt.coin.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost" title="Open on DexScreener">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {options.length > 1 && (
          <div className="flex items-center gap-1.5 mt-3 overflow-x-auto -mx-1 px-1 pb-0.5" role="tablist" aria-label="Chart focus">
            {options.map((o) => (
              <button
                key={o.key}
                type="button"
                role="tab"
                aria-selected={o.key === opt.key}
                onClick={() => onFocus(o.key)}
                className={`btn btn-sm shrink-0 ${o.key === opt.key ? 'btn-secondary text-white' : 'btn-ghost text-slate-400'}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${o.tone === 'pos' ? 'bg-pos' : o.tone === 'neg' ? 'bg-neg' : o.tone === 'accent' ? 'bg-signal' : o.tone === 'warn' ? 'bg-warn' : 'bg-ink-600'}`} />
                ${o.coin.symbol}
                <span className="text-slate-500 font-normal">{o.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {external ? (
        <PriceChart key={opt.mint} coin={opt.coin} position={pos || null} levels={levels} markers={markers} external={external} height={360} />
      ) : (
        <section className="panel grid place-items-center" style={{ height: 446 }}>
          <span className="flex items-center gap-2 text-[13px] text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin text-signal" />
            Loading candles…
          </span>
        </section>
      )}
    </div>
  );
};
