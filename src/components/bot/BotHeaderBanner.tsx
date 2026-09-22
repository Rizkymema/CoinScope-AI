'use client';

import React, { useEffect, useState } from 'react';
import { BridgeService, BridgeStatus } from '@/services/bridge.service';
import { Plug } from 'lucide-react';
import { Bot, Flame, Wallet, Play, Pause, Radio, Brain } from 'lucide-react';
import { useBotStore } from '@/store/useBotStore';
import { useShallow } from 'zustand/react/shallow';

export const BotHeaderBanner: React.FC = () => {
  const { isActive, settings, isWsConnected, wsLatencyMs, wsEventsPerMinute, solPriceUsd, lastAiDecision, toggleBot, connectWallet, disconnectWallet } =
    useBotStore(
      useShallow((s) => ({
        isActive: s.isActive,
        settings: s.settings,
        isWsConnected: s.isWsConnected,
        wsLatencyMs: s.wsLatencyMs,
        wsEventsPerMinute: s.wsEventsPerMinute,
        solPriceUsd: s.solPriceUsd,
        lastAiDecision: s.lastAiDecision,
        toggleBot: s.toggleBot,
        connectWallet: s.connectWallet,
        disconnectWallet: s.disconnectWallet,
      }))
    );

  const live = !settings.paperTrading;
  const [bridge, setBridge] = useState<BridgeStatus>(() => BridgeService.getStatus());
  useEffect(() => BridgeService.onStatus(setBridge), []);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-ink-850/90 via-ink-900/80 to-ink-950 p-6 md:p-8 backdrop-blur-xl shadow-2xl">
      <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-signal/15 blur-3xl animate-soft-pulse" />
      <div className="pointer-events-none absolute -left-20 -bottom-20 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl" />

      <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
        <div className="flex items-start gap-4">
          <div
            className={`p-4 rounded-2xl border transition-all duration-500 ${
              isActive ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400 shadow-lg shadow-emerald-500/10' : 'bg-slate-800/50 border-slate-700/50 text-slate-400'
            }`}
          >
            <Bot className={`w-9 h-9 ${isActive ? 'animate-bounce-subtle' : ''}`} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display text-2xl md:text-3xl font-extrabold text-white">
                CoinScope<span className="text-signal-soft">Auto-Snipe Bot</span>
              </h2>
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 border ${
                  isActive ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 animate-pulse' : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'}`} />
                {isActive ? 'Running' : 'Idle'}
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                  live ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                }`}
              >
                {live ? '🔴 LIVE' : '🧪 PAPER'}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1">
                <Flame className="w-3 h-3 text-amber-400" />
                Pump.fun + DEX pools
              </span>
              {settings.aiGateEnabled && (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-teal-500/15 text-teal-300 border border-teal-500/30 flex items-center gap-1">
                  <Brain className="w-3 h-3" />
                  AI gate ≥{settings.aiMinConfidence}%
                </span>
              )}
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1.5 font-mono ${
                  isWsConnected ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                <Radio className={`w-3 h-3 ${isWsConnected ? 'animate-pulse' : ''}`} />
                {isWsConnected ? `Stream ${wsLatencyMs}ms · ${wsEventsPerMinute}/min` : 'Stream offline'}
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1.5 font-mono ${
                  bridge.connected ? 'bg-sky-500/15 text-sky-300 border-sky-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
                title={bridge.lastError || (bridge.connected ? `MCP bridge online (${bridge.backend}) - ${bridge.commandsExecuted} commands executed` : 'MCP bridge offline')}
              >
                <Plug className="w-3 h-3" />
                {bridge.connected ? `MCP ${bridge.authRequired ? 'secured' : 'open'}` : bridge.lastError ? 'MCP key needed' : 'MCP offline'}
              </span>
            </div>
            <p className="text-slate-400 text-sm mt-1 max-w-xl">
              Real-time PumpPortal stream for new Pump.fun mints, GeckoTerminal + DexScreener for new DEX pools, AI gate before every entry,
              automatic TP / SL / trailing exits and on-chain execution through your own wallet.
              {solPriceUsd > 0 && <span className="text-slate-500"> SOL ${solPriceUsd.toFixed(2)}</span>}
            </p>
            {lastAiDecision && (
              <p className="text-[11px] mt-1.5 text-slate-500 font-mono truncate max-w-xl">
                Last AI: <span className={lastAiDecision.action === 'buy' ? 'text-emerald-400' : 'text-amber-300'}>{lastAiDecision.action.toUpperCase()} {lastAiDecision.symbol} ({lastAiDecision.confidence}%)</span> — {lastAiDecision.reason}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
          <button
            onClick={() => (settings.phantomWalletConnected ? disconnectWallet() : connectWallet())}
            className={`w-full sm:w-auto px-4 py-3.5 rounded-2xl font-bold text-xs border transition-all flex items-center justify-center gap-2 ${
              settings.phantomWalletConnected ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 shadow-lg shadow-purple-500/10' : 'bg-ink-800/80 text-slate-300 border-white/10 hover:border-purple-400/50'
            }`}
          >
            <Wallet className="w-4 h-4 text-purple-400" />
            {settings.phantomWalletConnected && settings.connectedWalletAddress
              ? `${settings.connectedWalletAddress.slice(0, 4)}...${settings.connectedWalletAddress.slice(-4)} (${settings.solBalance.toFixed(3)} SOL)`
              : 'Connect Wallet'}
          </button>

          <button
            onClick={() => toggleBot()}
            className={`w-full sm:w-auto flex items-center justify-center gap-3 px-8 py-3.5 rounded-2xl font-bold text-base transition-all duration-300 shadow-xl ${
              isActive
                ? 'bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white shadow-red-500/25 border border-red-400/30'
                : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-ink-950 shadow-emerald-500/25 border border-emerald-300/40'
            }`}
          >
            {isActive ? (
              <>
                <Pause className="w-5 h-5 fill-current" />
                PAUSE BOT
              </>
            ) : (
              <>
                <Play className="w-5 h-5 fill-current" />
                START AUTO-SNIPER
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
