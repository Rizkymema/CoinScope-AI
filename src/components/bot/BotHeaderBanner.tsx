'use client';

import React, { useEffect, useState } from 'react';
import { Bot, Wallet, Play, Pause, Radio, Brain, Plug, FlaskConical, Zap } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useBotStore } from '@/store/useBotStore';
import { BridgeService, BridgeStatus } from '@/services/bridge.service';

export const BotHeaderBanner: React.FC = () => {
  const {
    isActive,
    settings,
    isWsConnected,
    wsLatencyMs,
    wsEventsPerMinute,
    lastAiDecision,
    toggleBot,
    connectWallet,
    disconnectWallet,
  } = useBotStore(
    useShallow((s) => ({
      isActive: s.isActive,
      settings: s.settings,
      isWsConnected: s.isWsConnected,
      wsLatencyMs: s.wsLatencyMs,
      wsEventsPerMinute: s.wsEventsPerMinute,
      lastAiDecision: s.lastAiDecision,
      toggleBot: s.toggleBot,
      connectWallet: s.connectWallet,
      disconnectWallet: s.disconnectWallet,
    }))
  );

  const [bridge, setBridge] = useState<BridgeStatus>(() => BridgeService.getStatus());
  useEffect(() => BridgeService.onStatus(setBridge), []);

  const live = !settings.paperTrading;

  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
        {/* identity + state */}
        <div className="flex items-start gap-3.5 min-w-0">
          <span
            className={`grid place-items-center w-11 h-11 rounded-xl border shrink-0 ${
              isActive ? 'bg-pos/10 border-pos/30 text-pos' : 'bg-ink-850 border-line text-slate-500'
            }`}
          >
            <Bot className="w-5 h-5" />
          </span>

          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-[15px] font-bold text-white leading-none">Auto-snipe bot</h2>
              <span className="flex items-center gap-1.5 text-[13px] text-slate-400">
                <span className={`dot ${isActive ? 'dot-live' : 'dot-idle'}`} />
                {isActive ? 'Running' : 'Idle'}
              </span>
              <span className={live ? 'chip chip-neg' : 'chip chip-warn'}>
                <FlaskConical className="w-3 h-3" />
                {live ? 'Live funds' : 'Paper'}
              </span>
            </div>

            <p className="text-[13px] text-slate-400 mt-1.5 max-w-xl leading-relaxed">
              Watches new Pump.fun mints and fresh DEX pools, screens each launch against your filters and the AI gate,
              then manages exits with take-profit, stop-loss and trailing rules.
            </p>

            <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
              <span className="chip" title={isWsConnected ? 'PumpPortal launch stream' : 'Stream reconnecting'}>
                <Radio className={`w-3 h-3 ${isWsConnected ? 'text-pos' : 'text-slate-500'}`} />
                {isWsConnected
                  ? `Stream · ${wsEventsPerMinute}/min${wsLatencyMs > 8000 ? ` · quiet ${Math.round(wsLatencyMs / 1000)}s` : ''}`
                  : 'Stream offline'}
              </span>
              {settings.aiGateEnabled && (
                <span className="chip">
                  <Brain className="w-3 h-3 text-signal" />
                  AI gate ≥ {settings.aiMinConfidence}%
                </span>
              )}
              <span
                className="chip"
                title={bridge.lastError || (bridge.connected ? `MCP bridge online (${bridge.backend})` : 'MCP bridge offline')}
              >
                <Plug className={`w-3 h-3 ${bridge.connected ? 'text-pos' : 'text-slate-500'}`} />
                {bridge.connected
                  ? `MCP ${bridge.authRequired ? 'secured' : 'open'}`
                  : bridge.lastError
                  ? 'MCP key needed'
                  : 'MCP offline'}
              </span>
              <span className="chip">
                <Zap className="w-3 h-3 text-slate-500" />${settings.buyAmountUsd} / trade
              </span>
            </div>

            {lastAiDecision && (
              <p className="text-xs text-slate-500 mt-2.5 truncate max-w-xl">
                <span className="text-slate-400">Last AI call:</span>{' '}
                <span className={lastAiDecision.action === 'buy' ? 'text-pos font-semibold' : 'text-warn font-semibold'}>
                  {lastAiDecision.action.toUpperCase()} {lastAiDecision.symbol} ({lastAiDecision.confidence}%)
                </span>{' '}
                — {lastAiDecision.reason}
              </p>
            )}
          </div>
        </div>

        {/* actions */}
        <div className="flex items-center gap-2 shrink-0 w-full lg:w-auto">
          <button
            type="button"
            onClick={() => (settings.phantomWalletConnected ? disconnectWallet() : connectWallet())}
            className="btn btn-secondary flex-1 lg:flex-none"
          >
            <Wallet className="w-4 h-4 text-signal" />
            {settings.phantomWalletConnected && settings.connectedWalletAddress ? (
              <span className="font-mono">
                {settings.connectedWalletAddress.slice(0, 4)}…{settings.connectedWalletAddress.slice(-4)} ·{' '}
                {settings.solBalance.toFixed(2)} SOL
              </span>
            ) : (
              'Connect wallet'
            )}
          </button>

          <button
            type="button"
            onClick={() => toggleBot()}
            className={`btn btn-lg flex-1 lg:flex-none ${isActive ? 'btn-danger' : 'btn-primary'}`}
          >
            {isActive ? (
              <>
                <Pause className="w-4 h-4" />
                Pause
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Start bot
              </>
            )}
          </button>
        </div>
      </div>
    </section>
  );
};
