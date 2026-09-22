'use client';

import React from 'react';

interface LivePulseIndicatorProps {
  color?: 'emerald' | 'amber' | 'signal' | 'purple';
  size?: 'sm' | 'md';
  className?: string;
}

export const LivePulseIndicator: React.FC<LivePulseIndicatorProps> = ({
  color = 'emerald',
  size = 'sm',
  className = '',
}) => {
  const sizeClasses = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5';
  
  const colorClasses = {
    emerald: {
      ping: 'bg-emerald-400',
      dot: 'bg-emerald-500',
    },
    amber: {
      ping: 'bg-amber-400',
      dot: 'bg-amber-500',
    },
    signal: {
      ping: 'bg-teal-400',
      dot: 'bg-teal-500',
    },
    purple: {
      ping: 'bg-purple-400',
      dot: 'bg-purple-500',
    },
  }[color];

  return (
    <span className={`relative flex ${sizeClasses} ${className}`}>
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${colorClasses.ping} opacity-75`} />
      <span className={`relative inline-flex rounded-full ${sizeClasses} ${colorClasses.dot}`} />
    </span>
  );
};
