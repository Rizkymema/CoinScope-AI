'use client';

import React from 'react';

/**
 * Single steady status dot. Replaces the stacked ping animation:
 * a looping pulse next to live numbers competes with the data for attention.
 */
export const LivePulseIndicator: React.FC<{
  state?: 'live' | 'idle' | 'warn';
  className?: string;
  label?: string;
}> = ({ state = 'live', className = '', label }) => (
  <span
    role={label ? 'img' : undefined}
    aria-label={label}
    className={`dot ${state === 'live' ? 'dot-live' : state === 'warn' ? 'dot-warn' : 'dot-idle'} ${className}`}
  />
);
