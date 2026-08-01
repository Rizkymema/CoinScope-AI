'use client';

import React from 'react';
import { TrendingUp, Flame, Zap, Clock, BarChart3, Target, History } from 'lucide-react';

export type FilterType = 'movers' | 'trending' | 'mayhem' | 'live' | 'new' | 'market-cap' | 'agents' | 'oldest';

interface FilterTabsProps {
  onFilterChange: (filter: FilterType) => void;
  activeFilter: FilterType;
}

export const FilterTabs: React.FC<FilterTabsProps> = ({ onFilterChange, activeFilter }) => {
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
    <div className="w-full mb-8">
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
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
    </div>
  );
};
