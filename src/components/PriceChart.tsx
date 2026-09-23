'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, Radio } from 'lucide-react';
import type { IChartApi, ISeriesApi, IPriceLine, Time } from 'lightweight-charts';

import { CoinData } from '@/types/coin';
import { BotPosition } from '@/types/bot';
import { Candle, ChartService, TIMEFRAMES, TimeframeId, timeframeOf } from '@/services/chart.service';

/**
 * Candlestick chart with a volume pane.
 *
 * Direction is encoded twice: colour plus body fill (up candles are hollow, down
 * candles solid). The green/red pair sits in the deuteranopia risk band, so the
 * hollow/filled convention keeps the chart readable without relying on hue.
 *
 * Volume lives in its own pane rather than sharing the price axis - a second scale on
 * one plot makes two unrelated magnitudes look comparable.
 */

const UP = '#34d399';
const DOWN = '#f87171';
const ACCENT = '#00d2ff';
const SURFACE = '#0a0e1c';
const GRID = 'rgba(255,255,255,0.04)';
const TEXT_DIM = '#64748b';

/** Memecoin prices run to many leading zeros; render them compactly but exactly. */
function formatPrice(v: number): string {
  if (!Number.isFinite(v) || v === 0) return '0';
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(4);
  if (v >= 0.001) return v.toFixed(6);
  // Same leading-zero shorthand the rest of the app uses: 0.0{5}1234
  const m = v.toFixed(15).match(/^0\.(0+)(\d{1,4})/);
  return m ? `0.0{${m[1].length}}${m[2]}` : v.toExponential(2);
}

function formatCompact(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

interface PriceChartProps {
  coin: CoinData;
  /** When present, entry / take-profit / stop-loss levels are drawn on the price scale. */
  position?: BotPosition | null;
  height?: number;
}

export const PriceChart: React.FC<PriceChartProps> = ({ coin, position, height = 340 }) => {
  const holder = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);

  const [timeframe, setTimeframe] = useState<TimeframeId>('5m');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [source, setSource] = useState<'pool' | 'stream' | 'none'>('none');
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<Candle | null>(null);
  // The chart is created asynchronously, so data that arrives first must wait for it.
  const [chartReady, setChartReady] = useState(false);

  /* ------------------------------------------------------------- create chart */
  useEffect(() => {
    let disposed = false;
    let cleanupResize: (() => void) | undefined;

    (async () => {
      const lc = await import('lightweight-charts');
      if (disposed || !holder.current) return;

      const chart = lc.createChart(holder.current, {
        layout: {
          background: { type: lc.ColorType.Solid, color: SURFACE },
          textColor: TEXT_DIM,
          fontSize: 11,
          fontFamily: 'Manrope, system-ui, sans-serif',
          panes: { separatorColor: 'rgba(255,255,255,0.06)', separatorHoverColor: 'rgba(255,255,255,0.12)' },
        },
        grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
        rightPriceScale: { borderColor: 'rgba(255,255,255,0.06)', scaleMargins: { top: 0.12, bottom: 0.1 } },
        timeScale: { borderColor: 'rgba(255,255,255,0.06)', timeVisible: true, secondsVisible: false, rightOffset: 4 },
        crosshair: {
          mode: lc.CrosshairMode.Normal,
          vertLine: { color: 'rgba(255,255,255,0.25)', width: 1, style: lc.LineStyle.Dashed, labelBackgroundColor: '#141b30' },
          horzLine: { color: 'rgba(255,255,255,0.25)', width: 1, style: lc.LineStyle.Dashed, labelBackgroundColor: '#141b30' },
        },
        localization: { priceFormatter: formatPrice },
        autoSize: false,
        handleScale: { axisPressedMouseMove: { time: true, price: false } },
      });

      const candleSeries = chart.addSeries(lc.CandlestickSeries, {
        // Hollow up / filled down: direction survives colour blindness and greyscale print.
        upColor: 'rgba(0,0,0,0)',
        downColor: DOWN,
        borderUpColor: UP,
        borderDownColor: DOWN,
        wickUpColor: UP,
        wickDownColor: DOWN,
        borderVisible: true,
        priceFormat: { type: 'custom', formatter: formatPrice, minMove: 1e-12 },
      });

      const volumeSeries = chart.addSeries(
        lc.HistogramSeries,
        { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
        1
      );
      chart.panes()[1]?.setHeight(Math.round(height * 0.22));

      chart.subscribeCrosshairMove((param) => {
        const point = param.seriesData.get(candleSeries) as any;
        if (!point || param.time === undefined) {
          setHover(null);
          return;
        }
        const vol = param.seriesData.get(volumeSeries) as any;
        setHover({
          time: Number(param.time),
          open: point.open,
          high: point.high,
          low: point.low,
          close: point.close,
          volume: vol?.value ?? 0,
        });
      });

      chartRef.current = chart;
      candleRef.current = candleSeries;
      volumeRef.current = volumeSeries;
      setChartReady(true);

      const resize = () => {
        if (holder.current) chart.applyOptions({ width: holder.current.clientWidth, height });
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(holder.current);
      cleanupResize = () => ro.disconnect();
    })();

    return () => {
      disposed = true;
      setChartReady(false);
      cleanupResize?.();
      linesRef.current = [];
      chartRef.current?.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
    };
  }, [height]);

  /* ------------------------------------------------------------- load candles */
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval>;

    const load = async () => {
      const res = await ChartService.getCandlesForCoin(coin, timeframe);
      if (!active) return;
      setCandles(res.candles);
      setSource(res.source);
      setLoading(false);
    };

    setLoading(true);
    setCandles([]);
    load();
    timer = setInterval(load, 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [coin.id, coin.chainId, coin.mint, timeframe]);

  /* ------------------------------------------------------------- push data */
  useEffect(() => {
    const candleSeries = candleRef.current;
    const volumeSeries = volumeRef.current;
    if (!candleSeries || !volumeSeries) return;

    candleSeries.setData(
      candles.map((c) => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close }))
    );
    volumeSeries.setData(
      candles.map((c) => ({
        time: c.time as Time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(52,211,153,0.35)' : 'rgba(248,113,113,0.35)',
      }))
    );
    if (candles.length > 0) chartRef.current?.timeScale().fitContent();
  }, [candles, chartReady]);

  /* ------------------------------------------------------------- position levels */
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;

    linesRef.current.forEach((l) => series.removePriceLine(l));
    linesRef.current = [];
    if (!position) return;

    const add = (price: number, color: string, title: string, dashed: boolean) => {
      if (!Number.isFinite(price) || price <= 0) return;
      import('lightweight-charts').then((lc) => {
        if (!candleRef.current) return;
        linesRef.current.push(
          candleRef.current.createPriceLine({
            price,
            color,
            lineWidth: 1,
            lineStyle: dashed ? lc.LineStyle.Dashed : lc.LineStyle.Solid,
            lineVisible: true,
            axisLabelVisible: true,
            title,
            axisLabelColor: color,
            axisLabelTextColor: SURFACE,
          })
        );
      });
    };

    add(position.buyPriceUsd, ACCENT, 'Entry', false);
    add(position.tpPriceUsd, UP, 'TP', true);
    add(position.slPriceUsd, DOWN, 'SL', true);
  }, [position?.id, position?.buyPriceUsd, position?.tpPriceUsd, position?.slPriceUsd, chartReady, candles.length]);

  /* ------------------------------------------------------------- header stats */
  const shown = hover ?? candles[candles.length - 1] ?? null;
  const change = useMemo(() => {
    if (!shown) return null;
    if (shown.open === 0) return null;
    return ((shown.close - shown.open) / shown.open) * 100;
  }, [shown]);

  const tfSeconds = timeframeOf(timeframe).seconds;
  const hasData = candles.length > 1;

  return (
    <section className="panel overflow-hidden">
      {/* toolbar */}
      <header className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-line">
        <div className="tabbar" role="tablist" aria-label="Chart timeframe">
          {TIMEFRAMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={timeframe === t.id}
              data-active={timeframe === t.id}
              onClick={() => setTimeframe(t.id)}
              className="tab px-2.5"
            >
              {t.label}
            </button>
          ))}
        </div>

        <span className="chip" title={source === 'stream' ? 'Built live from the trade stream' : 'Pool candles from GeckoTerminal'}>
          {source === 'stream' ? <Radio className="w-3 h-3 text-pos" /> : null}
          {source === 'pool' ? 'Pool data' : source === 'stream' ? 'Live stream' : 'No data'}
        </span>

        {/* OHLC readout: values live in text tokens, the swatch carries direction */}
        {shown && (
          <dl className="flex items-center gap-3 text-[11px] font-mono ml-auto flex-wrap">
            {(
              [
                ['O', shown.open],
                ['H', shown.high],
                ['L', shown.low],
                ['C', shown.close],
              ] as [string, number][]
            ).map(([label, value]) => (
              <div key={label} className="flex items-center gap-1">
                <dt className="text-slate-600">{label}</dt>
                <dd className="text-slate-200">{formatPrice(value)}</dd>
              </div>
            ))}
            <div className="flex items-center gap-1">
              <dt className="text-slate-600">Vol</dt>
              <dd className="text-slate-200">{formatCompact(shown.volume)}</dd>
            </div>
            {change !== null && (
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="w-2 h-2 rounded-[2px] shrink-0"
                  style={
                    change >= 0
                      ? { border: `1.5px solid ${UP}`, background: 'transparent' }
                      : { background: DOWN }
                  }
                />
                <dd className={change >= 0 ? 'text-pos font-semibold' : 'text-neg font-semibold'}>
                  {change >= 0 ? '+' : '−'}
                  {Math.abs(change).toFixed(2)}%
                </dd>
              </div>
            )}
          </dl>
        )}
      </header>

      {/* plot */}
      <div className="relative">
        <div ref={holder} style={{ height }} className={hasData ? '' : 'opacity-30'} />

        {(loading || !hasData) && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            {loading ? (
              <span className="flex items-center gap-2 text-[13px] text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin text-signal" />
                Loading candles…
              </span>
            ) : (
              <div className="text-center px-6">
                <AlertCircle className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                <p className="text-[13px] font-semibold text-slate-300">No chart history yet</p>
                <p className="text-xs text-slate-500 mt-1 max-w-xs leading-relaxed">
                  {coin.isPumpFun && !coin.graduated
                    ? 'This token is still on its bonding curve and is not indexed by a chart provider. Candles build up live from the trade stream once it starts trading.'
                    : 'No indexed pool for this token yet. Try a longer timeframe or open it on DexScreener.'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* legend: direction is named, not only coloured */}
      <footer className="flex items-center gap-4 px-4 py-2 border-t border-line text-[11px] text-slate-500 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="w-2.5 h-2.5 rounded-[2px]" style={{ border: `1.5px solid ${UP}` }} />
          Up (hollow)
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="w-2.5 h-2.5 rounded-[2px]" style={{ background: DOWN }} />
          Down (filled)
        </span>
        {position && (
          <>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="w-3 h-px" style={{ background: ACCENT }} />
              Entry
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="w-3 h-px" style={{ backgroundImage: `linear-gradient(90deg, ${UP} 50%, transparent 50%)`, backgroundSize: '4px 1px' }} />
              Take profit
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="w-3 h-px" style={{ backgroundImage: `linear-gradient(90deg, ${DOWN} 50%, transparent 50%)`, backgroundSize: '4px 1px' }} />
              Stop loss
            </span>
          </>
        )}
        <span className="ml-auto">
          {candles.length} candles · {tfSeconds >= 3600 ? `${tfSeconds / 3600}h` : `${tfSeconds / 60}m`} each
        </span>
      </footer>
    </section>
  );
};
