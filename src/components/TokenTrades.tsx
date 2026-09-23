'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, ExternalLink, Inbox, Loader2 } from 'lucide-react';

import { CoinData } from '@/types/coin';
import { TokenTrade, TradesService } from '@/services/trades.service';
import { wsService } from '@/services/websocket.service';
import { useBotStore } from '@/store/useBotStore';

const MAX_ROWS = 80;
type SideFilter = 'all' | 'buy' | 'sell';

function shortAddr(a?: string): string {
  if (!a) return '—';
  return a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function usd(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1_000_000) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1e3).toFixed(1)}K`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

function tokens(v: number): string {
  if (!Number.isFinite(v) || v === 0) return '—';
  if (v >= 1_000_000) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(v >= 1 ? 2 : 4);
}

export const TokenTrades: React.FC<{ coin: CoinData; height?: number }> = ({ coin, height = 320 }) => {
  const [rows, setRows] = useState<TokenTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<SideFilter>('all');
  const [, tick] = useState(0);
  const solPrice = useBotStore((s) => s.solPriceUsd);
  const mint = useRef('');

  mint.current = coin.mint || (coin.id.includes(':') ? coin.id.split(':')[1] : '');

  /* history */
  useEffect(() => {
    let active = true;
    setLoading(true);
    setRows([]);
    TradesService.getRecentTrades(coin).then((t) => {
      if (!active) return;
      setRows(t);
      setLoading(false);
    });
    const refresh = setInterval(() => {
      TradesService.getRecentTrades(coin).then((t) => {
        if (!active || t.length === 0) return;
        // Merge rather than replace so live stream rows are not dropped on each poll.
        setRows((prev) => {
          const seen = new Set(prev.map((r) => r.id));
          const merged = [...prev, ...t.filter((r) => !seen.has(r.id))];
          return merged.sort((a, b) => b.time - a.time).slice(0, MAX_ROWS);
        });
      });
    }, 20_000);
    const clock = setInterval(() => tick((n) => n + 1), 5_000);
    return () => {
      active = false;
      clearInterval(refresh);
      clearInterval(clock);
    };
  }, [coin.id]);

  /* live rows from the stream */
  useEffect(() => {
    return wsService.onTokenTrade((evt) => {
      if (evt.mint !== mint.current) return;
      const row = TradesService.fromStream(evt, solPrice);
      if (!row) return;
      setRows((prev) => {
        if (prev.some((r) => r.id === row.id)) return prev;
        return [row, ...prev].slice(0, MAX_ROWS);
      });
      setLoading(false);
    });
  }, [solPrice]);

  const shown = useMemo(() => (filter === 'all' ? rows : rows.filter((r) => r.side === filter)), [rows, filter]);

  const flow = useMemo(() => {
    const buy = rows.filter((r) => r.side === 'buy').reduce((s, r) => s + r.valueUsd, 0);
    const sell = rows.filter((r) => r.side === 'sell').reduce((s, r) => s + r.valueUsd, 0);
    const total = buy + sell;
    return { buy, sell, buyShare: total > 0 ? (buy / total) * 100 : 0, total };
  }, [rows]);

  const explorer = (hash: string) =>
    (coin.chainId || '').toLowerCase() === 'solana' ? `https://solscan.io/tx/${hash}` : undefined;

  return (
    <section className="panel overflow-hidden flex flex-col">
      <header className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-line">
        <h3 className="text-[13px] font-bold text-white">
          Trades <span className="text-slate-500 font-normal">({rows.length})</span>
        </h3>
        <div className="tabbar">
          {(['all', 'buy', 'sell'] as SideFilter[]).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} data-active={filter === f} className="tab px-2.5 capitalize">
              {f}
            </button>
          ))}
        </div>
      </header>

      {/* buy vs sell flow: the bar is labelled, so it is not colour-alone */}
      {flow.total > 0 && (
        <div className="px-4 py-2.5 border-b border-line">
          <div className="flex items-center justify-between text-[11px] mb-1.5">
            <span className="text-pos font-mono font-semibold">Buys {usd(flow.buy)}</span>
            <span className="text-slate-500">{flow.buyShare.toFixed(0)}% buy</span>
            <span className="text-neg font-mono font-semibold">Sells {usd(flow.sell)}</span>
          </div>
          <div className="h-1 rounded-full bg-neg overflow-hidden" role="presentation">
            <div className="h-full bg-pos" style={{ width: `${flow.buyShare}%` }} />
          </div>
        </div>
      )}

      <div className="overflow-y-auto" style={{ maxHeight: height }}>
        {loading && rows.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-12 text-[13px] text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin text-signal" />
            Loading trades…
          </p>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-6">
            <Inbox className="w-6 h-6 text-slate-600 mb-2" />
            <p className="text-[13px] font-semibold text-slate-300">No trades yet</p>
            <p className="text-xs text-slate-500 mt-1 max-w-xs leading-relaxed">
              Nothing indexed for this pool. Trades appear live as soon as someone buys or sells.
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-[12px]">
            <thead className="sticky top-0 bg-ink-850 z-10">
              <tr className="thead border-b border-line">
                <th className="py-2 pl-4 pr-2 font-semibold">Time</th>
                <th className="py-2 px-2 font-semibold">Side</th>
                <th className="py-2 px-2 font-semibold text-right">Value</th>
                <th className="py-2 px-2 font-semibold text-right">Tokens</th>
                <th className="py-2 px-2 font-semibold text-right">Price</th>
                <th className="py-2 pl-2 pr-4 font-semibold text-right">Trader</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const buy = t.side === 'buy';
                const url = t.txHash ? explorer(t.txHash) : undefined;
                return (
                  <tr key={t.id} className="row">
                    <td className="py-1.5 pl-4 pr-2 font-mono text-slate-500 whitespace-nowrap">{ago(t.time)}</td>
                    <td className="py-1.5 px-2">
                      <span className={`inline-flex items-center gap-1 font-semibold ${buy ? 'text-pos' : 'text-neg'}`}>
                        {buy ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {buy ? 'Buy' : 'Sell'}
                      </span>
                    </td>
                    <td className={`py-1.5 px-2 text-right font-mono font-semibold ${buy ? 'text-pos' : 'text-neg'}`}>
                      {usd(t.valueUsd)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-slate-300">{tokens(t.tokenAmount)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-slate-400 whitespace-nowrap">
                      {t.priceUsd > 0 ? `$${t.priceUsd < 0.01 ? t.priceUsd.toExponential(2) : t.priceUsd.toFixed(4)}` : '—'}
                    </td>
                    <td className="py-1.5 pl-2 pr-4 text-right">
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-slate-400 hover:text-white transition-colors"
                          title="Open transaction"
                        >
                          {shortAddr(t.trader)}
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      ) : (
                        <span className="font-mono text-slate-500">{shortAddr(t.trader)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
};
