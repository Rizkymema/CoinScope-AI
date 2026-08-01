'use client';

import React, { useState } from 'react';
import { TrendingUp, Flame, Zap, Clock, BarChart3, Target, History, Settings } from 'lucide-react';

export type FilterType = 'movers' | 'trending' | 'mayhem' | 'live' | 'new' | 'market-cap' | 'agents' | 'oldest';

interface FilterTabsProps {
  onFilterChange: (filter: FilterType) => void;
  activeFilter: FilterType;
}

export const FilterTabs: React.FC<FilterTabsProps> = ({ onFilterChange, activeFilter }) => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const filters: { id: FilterType; label: string; icon: React.ReactNode }[] = [
    { id: 'movers', label: 'Movers', icon: <TrendingUp className="w-4 h-4" /> },
    { id: 'trending', label: 'Trending', icon: <Flame className="w-4 h-4" /> },
    { id: 'mayhem', label: 'Mayhem', icon: <Zap className="w-4 h-4" /> },
    { id: 'live', label: 'Live', icon: <Clock className="w-4 h-4" /> },
    { id: 'new', label: 'New', icon: <Zap className="w-4 h-4" /> },
    { id: 'market-cap', label: 'Market Cap', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'agents', label: 'Agents', icon: <Target className="w-4 h-4" /> },
    { id: 'oldest', label: 'Oldest', icon: <History className="w-4 h-4" /> },
  ];

  return (
    <div className="w-full mb-8 relative">
      <div className="flex items-start gap-2">
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide flex-1">
          {filters.map((filter) => (
            <button
              key={filter.id}
              onClick={() => onFilterChange(filter.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-medium text-sm whitespace-nowrap transition-all duration-200 ${
                activeFilter === filter.id
                  ? 'bg-signal/15 text-signal-soft border border-signal/35'
                  : 'bg-ink-850/70 text-slate-400 hover:text-white border border-white/8 hover:border-white/15'
              }`}
            >
              {filter.icon}
              {filter.label}
            </button>
          ))}
        </div>

        <div className="relative z-50 flex-shrink-0 pb-2">
          <button
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className="p-2.5 hover:bg-ink-800 rounded-xl transition-colors border border-white/10"
          >
            <Settings className="w-5 h-5 text-slate-400" />
          </button>

          {isSettingsOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 surface rounded-xl shadow-xl z-[100] overflow-hidden">
              <div className="p-3 border-b border-white/8">
                <h3 className="text-sm font-semibold text-white">Filter Settings</h3>
              </div>
              <div className="p-2 flex flex-col gap-1">
                <label className="flex items-center justify-between p-2 hover:bg-white/5 rounded-lg cursor-pointer transition-colors">
                  <span className="text-sm text-slate-300">Auto-refresh</span>
                  <input type="checkbox" className="rounded bg-ink-900 border-slate-700 text-signal focus:ring-signal" defaultChecked />
                </label>
                <label className="flex items-center justify-between p-2 hover:bg-white/5 rounded-lg cursor-pointer transition-colors">
                  <span className="text-sm text-slate-300">Show exact numbers</span>
                  <input type="checkbox" className="rounded bg-ink-900 border-slate-700 text-signal focus:ring-signal" />
                </label>
                <label className="flex items-center justify-between p-2 hover:bg-white/5 rounded-lg cursor-pointer transition-colors">
                  <span className="text-sm text-slate-300">High contrast</span>
                  <input type="checkbox" className="rounded bg-ink-900 border-slate-700 text-signal focus:ring-signal" />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
