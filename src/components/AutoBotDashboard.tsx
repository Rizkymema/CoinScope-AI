'use client';

import React, { useState } from 'react';
import { useBotStore } from '@/store/useBotStore';
import { Bot, Target, Sliders, History } from 'lucide-react';
import { BotHeaderBanner } from './bot/BotHeaderBanner';
import { BotMetricsBar } from './bot/BotMetricsBar';
import { BotPositionsTable } from './bot/BotPositionsTable';
import { BotTerminalLogs } from './bot/BotTerminalLogs';
import { BotTargetsPanel } from './bot/BotTargetsPanel';
import { BotSettingsPanel } from './bot/BotSettingsPanel';
import { BotTradeHistory } from './bot/BotTradeHistory';

export const AutoBotDashboard: React.FC = () => {
  const { positions, settings, history } = useBotStore();
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'targets' | 'settings' | 'history'>('overview');

  return (
    <div className="w-full space-y-8 animate-fade-up">
      {/* HEADER & MASTER CONTROL BANNER */}
      <div>
        <BotHeaderBanner />
        <BotMetricsBar />
      </div>

      {/* NAVIGATION SUB-TABS */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-3">
        <button
          onClick={() => setActiveSubTab('overview')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all ${
            activeSubTab === 'overview'
              ? 'bg-signal text-ink-950 shadow-lg shadow-signal/20'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Bot className="w-4 h-4" />
          Active Dashboard ({positions.length})
        </button>
        <button
          onClick={() => setActiveSubTab('targets')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all ${
            activeSubTab === 'targets'
              ? 'bg-amber-400 text-ink-950 font-bold shadow-lg shadow-amber-400/20'
              : 'text-amber-300 hover:bg-amber-400/10'
          }`}
        >
          <Target className="w-4 h-4" />
          Pilih Coin Target Bot ({settings.whitelistedSymbols.length})
        </button>
        <button
          onClick={() => setActiveSubTab('settings')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all ${
            activeSubTab === 'settings'
              ? 'bg-signal text-ink-950 shadow-lg shadow-signal/20'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Sliders className="w-4 h-4" />
          Pump.fun & Safety Strategy
        </button>
        <button
          onClick={() => setActiveSubTab('history')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all ${
            activeSubTab === 'history'
              ? 'bg-signal text-ink-950 shadow-lg shadow-signal/20'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <History className="w-4 h-4" />
          Trade History ({history.length})
        </button>
      </div>

      {/* TAB CONTENTS */}
      {activeSubTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <BotPositionsTable />
          <BotTerminalLogs />
        </div>
      )}

      {activeSubTab === 'targets' && <BotTargetsPanel />}

      {activeSubTab === 'settings' && <BotSettingsPanel />}

      {activeSubTab === 'history' && <BotTradeHistory />}
    </div>
  );
};
