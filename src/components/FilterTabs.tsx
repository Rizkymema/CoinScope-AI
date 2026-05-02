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
              className={`flex items-center gap-2 px-4 py-2.5 rounded-full font-medium text-sm whitespace-nowrap transition-all duration-200 ${
                activeFilter === filter.id
                  ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-lg shadow-indigo-500/30'
                  : 'bg-slate-800/50 text-slate-300 hover:bg-slate-800 border border-slate-700/50'
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
            className="p-2.5 hover:bg-slate-800 rounded-lg transition-colors border border-slate-700"
          >
            <Settings className="w-5 h-5 text-slate-400" />
          </button>

          {isSettingsOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-[100] overflow-hidden">
              <div className="p-3 border-b border-slate-700/50 bg-slate-800/50">
                <h3 className="text-sm font-semibold text-white">Filter Settings</h3>
              </div>
              <div className="p-2 flex flex-col gap-1">
                <label className="flex items-center justify-between p-2 hover:bg-slate-700/50 rounded-lg cursor-pointer transition-colors">
                  <span className="text-sm text-slate-300">Auto-refresh</span>
                  <input type="checkbox" className="rounded bg-slate-900 border-slate-700 text-indigo-500 focus:ring-indigo-500" defaultChecked />
                </label>
                <label className="flex items-center justify-between p-2 hover:bg-slate-700/50 rounded-lg cursor-pointer transition-colors">
                  <span className="text-sm text-slate-300">Show exact numbers</span>
                  <input type="checkbox" className="rounded bg-slate-900 border-slate-700 text-indigo-500 focus:ring-indigo-500" />
                </label>
                <label className="flex items-center justify-between p-2 hover:bg-slate-700/50 rounded-lg cursor-pointer transition-colors">
                  <span className="text-sm text-slate-300">High contrast</span>
                  <input type="checkbox" className="rounded bg-slate-900 border-slate-700 text-indigo-500 focus:ring-indigo-500" />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
