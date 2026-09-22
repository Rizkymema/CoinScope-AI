'use client';

import React from 'react';

interface StatusBadgeProps {
  label: React.ReactNode;
  color?: 'emerald' | 'purple' | 'amber' | 'teal' | 'slate' | 'red';
  icon?: React.ReactNode;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  label,
  color = 'slate',
  icon,
  className = '',
}) => {
  const colorMap = {
    emerald: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    purple: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    amber: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    teal: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
    slate: 'bg-slate-800 text-slate-400 border-slate-700',
    red: 'bg-red-500/20 text-red-400 border-red-500/30',
  };

  return (
    <span
      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 ${colorMap[color]} ${className}`}
    >
      {icon}
      {label}
    </span>
  );
};
