'use client';

import React, { useRef } from 'react';
import { Layers, Inbox, ExternalLink, Loader2, Brain, Pill, CandlestickChart, Lock, Timer } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useBotStore } from '@/store/useBotStore';
import { useScannerStore } from '@/store/useScannerStore';
import { BotPosition } from '@/types/bot';
import { CoinAvatar, ChainBadge } from '../CoinAvatar';
import { formatPrice, timeAgo } from '@/lib/formatters';
import { WalletService } from '@/services/wallet.service';
import { getPriceTrail } from '@/lib/price-trail';
import { clock, Sparkline, TickingPrice, useNow } from '../desk/shared';

/**
 * Open positions as live cards: price that ticks with the stream, a sparkline of recent marks
 * against the entry, where the price sits between stop and target, and the exits that apply.
 */
export const BotPositionsTable: React.FC<{ focusKey?: string | null; onFocus?: (key: string) => void }> = ({ focusKey, onFocus }) => {
  const { positions, settings, pendingTradeIds, closePosition } = useBotStore(
    useShallow((s) => ({
      positions: s.positions,
      settings: s.settings,
      pendingTradeIds: s.pendingTradeIds,
      closePosition: s.closePosition,
    }))
  );
  const { readyCount, scanning } = useScannerStore(useShallow((s) => ({ readyCount: s.readyIds.length, scanning: s.scanning })));
  const now = useNow(1000);

  return (
    <div className="space-y-3 min-w-0">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-bold text-white flex items-center gap-2">
          <Layers className="w-4 h-4 text-slate-500" />
          Open positions
          <span className="text-slate-500 font-normal">
            ({positions.length}/{settings.maxPositions})
          </span>
        </h3>
        <span className="text-xs text-slate-500 truncate">
          {settings.autoSell
            ? `Exits automatic · own TP / SL · profit lock${settings.trailingStopPercent ? ` · trail ${settings.trailingStopPercent}%` : ''}`
            : 'Automatic exits off'}
        </span>
      </div>

      {positions.length === 0 ? (
        <div className="panel flex flex-col items-center justify-center text-center px-6 py-12">
          <Inbox className="w-7 h-7 text-slate-600 mb-3" />
          <p className="text-white font-semibold text-[13px]">No open positions</p>
          <p className="text-[13px] text-slate-400 mt-1 max-w-sm leading-relaxed">
            {settings.scannerAutoBuy
              ? `Auto trade is waiting for a Ready signal${readyCount ? ` (${readyCount} ready right now)` : scanning ? ' - scanning now' : ''}. The pipeline on the right shows where each candidate is.`
              : 'Start auto trade and the bot buys the signals it confirms, or buy a Ready signal below or a token from Market.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {positions.map((pos) => (
            <PositionCard
              key={pos.id}
              pos={pos}
              now={now}
              busy={pendingTradeIds.includes(pos.id)}
              focused={focusKey === `pos:${pos.id}`}
              onFocus={onFocus ? () => onFocus(`pos:${pos.id}`) : undefined}
              onSell={(pct) => closePosition(pos.id, 'MANUAL_SELL', pct)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const PositionCard: React.FC<{
  pos: BotPosition;
  now: number;
  busy: boolean;
  focused: boolean;
  onFocus?: () => void;
  onSell: (percent: number) => void;
}> = ({ pos, now, busy, focused, onFocus, onSell }) => {
  const profit = pos.pnlUsd >= 0;
  const trail = getPriceTrail(pos.id);
  const prev = useRef(pos.currentPriceUsd);
  const direction = pos.currentPriceUsd > prev.current ? 'up' : pos.currentPriceUsd < prev.current ? 'down' : null;
  prev.current = pos.currentPriceUsd;

  // Where the price sits between the stop (0%) and the target (100%), with the entry marked.
  const range = pos.tpPriceUsd - pos.slPriceUsd;
  const at = (p: number) => (range > 0 ? Math.max(0, Math.min(100, ((p - pos.slPriceUsd) / range) * 100)) : 0);
  const toStop = pos.currentPriceUsd > 0 ? (pos.slPriceUsd / pos.currentPriceUsd - 1) * 100 : 0;
  const toTarget = pos.currentPriceUsd > 0 ? (pos.tpPriceUsd / pos.currentPriceUsd - 1) * 100 : 0;
  const stale = !pos.lastPriceUpdateAt || now - pos.lastPriceUpdateAt > 60_000;
  const timeLeft = pos.timeStopMinutes ? pos.timeStopMinutes * 60_000 - (now - (pos.highAt ?? pos.boughtAt)) : null;

  return (
    <article className={`panel-interactive p-3.5 min-w-0 ${focused ? 'border-signal/40' : ''}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        <CoinAvatar imageUrl={pos.coin.imageUrl} symbol={pos.coin.symbol} chainId={pos.coin.chainId} size="sm" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-white text-[13px] truncate">${pos.coin.symbol}</span>
            <ChainBadge chainId={pos.coin.chainId} />
            <span className={pos.isLive ? 'chip chip-neg' : 'chip chip-warn'}>{pos.isLive ? 'LIVE' : 'PAPER'}</span>
            {pos.coin.isPumpFun && !pos.coin.graduated && (
              <span className="chip chip-info" title="Still on the Pump.fun bonding curve">
                <Pill className="w-3 h-3" />
                {pos.coin.bondingCurve ?? 0}%
              </span>
            )}
            {pos.aiDecision && (
              <span className="chip chip-accent" title={pos.aiDecision.reason}>
                <Brain className="w-3 h-3" />
                {pos.aiDecision.confidence}%
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 truncate">
            ${pos.amountUsd.toFixed(2)} in · {timeAgo(pos.boughtAt)}
            {stale ? ' · waiting for a price' : ''}
          </p>
        </div>
        <div className="ml-auto text-right shrink-0">
          <p className={`text-[15px] font-mono font-bold leading-none ${profit ? 'text-pos' : 'text-neg'}`}>
            {profit ? '+' : '−'}
            {Math.abs(pos.pnlPercent).toFixed(1)}%
          </p>
          <p className={`text-[11px] font-mono mt-1 ${profit ? 'text-pos/70' : 'text-neg/70'}`}>
            {profit ? '+' : '−'}${Math.abs(pos.pnlUsd).toFixed(2)}
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex items-end gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500">Now</p>
          <p className="text-[13px] font-mono font-semibold text-white">
            <TickingPrice value={formatPrice(pos.currentPriceUsd)} direction={direction} />
          </p>
          <p className="text-[11px] font-mono text-slate-500">entry {formatPrice(pos.buyPriceUsd)}</p>
        </div>
        <Sparkline points={trail.map((t) => t.price)} baseline={pos.buyPriceUsd} up={profit} className="flex-1 min-w-0" />
      </div>

      {/* stop -> target, with the entry and the price marked */}
      <div className="mt-3">
        <div className="relative h-1.5 rounded-full bg-ink-800" role="presentation">
          <div className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-200 ${profit ? 'bg-pos/60' : 'bg-neg/60'}`} style={{ width: `${at(pos.currentPriceUsd)}%` }} />
          <span aria-hidden="true" className="absolute -top-0.5 -bottom-0.5 w-px bg-signal" style={{ left: `${at(pos.buyPriceUsd)}%` }} title="Entry" />
        </div>
        <div className="flex items-center justify-between mt-1.5 text-[11px] font-mono">
          <span className={pos.profitLocked ? 'text-pos flex items-center gap-1' : 'text-neg'}>
            {pos.profitLocked && <Lock className="w-3 h-3" />}
            {pos.profitLocked ? 'Lock' : 'SL'} {formatPrice(pos.slPriceUsd)} ({toStop.toFixed(1)}%)
          </span>
          <span className="text-pos">
            TP {formatPrice(pos.tpPriceUsd)} (+{toTarget.toFixed(1)}%)
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-line flex-wrap">
        {timeLeft !== null && (
          <span className={`chip ${timeLeft < 3 * 60_000 ? 'chip-warn' : ''}`} title="Closes if it makes no new high before this runs out">
            <Timer className="w-3 h-3" />
            {clock(timeLeft)}
          </span>
        )}
        {onFocus && (
          <button type="button" onClick={onFocus} aria-pressed={focused} className={`btn btn-sm ${focused ? 'btn-secondary text-signal' : 'btn-ghost'}`} title="Show on the chart">
            <CandlestickChart className="w-3.5 h-3.5" />
            Chart
          </button>
        )}
        {pos.buyTxSignature && (
          <a href={WalletService.explorerUrl(pos.buyTxSignature)} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost" title="Buy transaction on Solscan">
            Tx
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
        <span className="ml-auto" />
        <button type="button" onClick={() => onSell(50)} disabled={busy} className="btn btn-sm btn-secondary">
          Sell 50%
        </button>
        <button type="button" onClick={() => onSell(100)} disabled={busy} className="btn btn-sm btn-danger">
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}
          Sell all
        </button>
      </div>
    </article>
  );
};
