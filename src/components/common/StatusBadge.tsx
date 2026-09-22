'use client';

import React from 'react';

type Tone = 'neutral' | 'accent' | 'pos' | 'neg' | 'warn' | 'info';

interface StatusBadgeProps {
  label: React.ReactNode;
  tone?: Tone;
  icon?: React.ReactNode;
  className?: string;
}

const TONE: Record<Tone, string> = {
  neutral: 'chip',
  accent: 'chip chip-accent',
  pos: 'chip chip-pos',
  neg: 'chip chip-neg',
  warn: 'chip chip-warn',
  info: 'chip chip-info',
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ label, tone = 'neutral', icon, className = '' }) => (
  <span className={`${TONE[tone]} ${className}`}>
    {icon}
    {label}
  </span>
);
