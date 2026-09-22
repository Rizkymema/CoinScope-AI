'use client';

import React from 'react';
import { TrendingUp, Flame, Zap, Clock, BarChart3, Sparkles, Trophy } from 'lucide-react';

export type FilterType = 'movers' | 'trending' | 'mayhem' | 'live' | 'new' | 'market-cap' | 'agents' | 'oldest';

const FILTERS: { id: FilterType; label: string; icon: typeof TrendingUp }[] = [
  { id: 'trending', label: 'Trending', icon: Flame },
  { id: 'movers', label: 'Movers', icon: TrendingUp },
  { id: 'mayhem', label: 'Volatile', icon: Zap },
  { id: 'new', label: 'Newest', icon: Clock },
  { id: 'market-cap', label: 'Market cap', icon: BarChart3 },
  { id: 'agents', label: 'Gainers', icon: Sparkles },
  { id: 'oldest', label: 'Established', icon: Trophy },
];

export const FilterTabs: React.FC<{ onFilterChange: (f: FilterType) => void; activeFilter: FilterType }> = ({
  onFilterChange,
  activeFilter,
}) => (
  <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
    <div className="tabbar" role="tablist" aria-label="Market filters">
      {FILTERS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={activeFilter === id}
          data-active={activeFilter === id}
          onClick={() => onFilterChange(id)}
          className="tab"
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>
  </div>
);
