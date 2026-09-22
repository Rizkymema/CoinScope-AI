'use client';

import React, { useState } from 'react';
import { LayoutDashboard, Target, SlidersHorizontal, History } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useBotStore } from '@/store/useBotStore';
import { BotHeaderBanner } from './bot/BotHeaderBanner';
import { BotMetricsBar } from './bot/BotMetricsBar';
import { BotPositionsTable } from './bot/BotPositionsTable';
import { BotTerminalLogs } from './bot/BotTerminalLogs';
import { BotTargetsPanel } from './bot/BotTargetsPanel';
import { BotSettingsPanel } from './bot/BotSettingsPanel';
import { BotTradeHistory } from './bot/BotTradeHistory';

type SubTab = 'overview' | 'targets' | 'settings' | 'history';

export const AutoBotDashboard: React.FC = () => {
  const [tab, setTab] = useState<SubTab>('overview');
  const { positionsCount, targetsCount, historyCount } = useBotStore(
    useShallow((s) => ({
      positionsCount: s.positions.length,
      targetsCount: s.settings.whitelistedSymbols.length,
      historyCount: s.history.length,
    }))
  );

  const tabs: { id: SubTab; label: string; icon: typeof Target; count?: number }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, count: positionsCount },
    { id: 'targets', label: 'Watchlist', icon: Target, count: targetsCount },
    { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
    { id: 'history', label: 'History', icon: History, count: historyCount },
  ];

  return (
    <div className="space-y-5">
      <div>
        <BotHeaderBanner />
        <BotMetricsBar />
      </div>

      <div className="tabbar" role="tablist" aria-label="Bot sections">
        {tabs.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            data-active={tab === id}
            onClick={() => setTab(id)}
            className="tab"
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {count !== undefined && count > 0 && (
              <span className="ml-0.5 px-1.5 rounded-[5px] bg-white/8 text-[10px] font-bold">{count}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
          <BotPositionsTable />
          <BotTerminalLogs />
        </div>
      )}
      {tab === 'targets' && <BotTargetsPanel />}
      {tab === 'settings' && <BotSettingsPanel />}
      {tab === 'history' && <BotTradeHistory />}
    </div>
  );
};
