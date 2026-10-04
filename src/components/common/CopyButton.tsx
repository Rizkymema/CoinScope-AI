'use client';

import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Clipboard API is unavailable over plain http on some browsers.
    const el = document.createElement('textarea');
    el.value = value;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    try {
      document.execCommand('copy');
    } catch {
      /* nothing else to try */
    }
    document.body.removeChild(el);
  }
}

export const CopyButton: React.FC<{ value: string; label: string; className?: string; compact?: boolean }> = ({
  value,
  label,
  className = '',
  compact = false,
}) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await copyText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button type="button" onClick={copy} aria-label={label} title={label} className={`btn btn-sm btn-secondary ${className}`}>
      {copied ? <Check className="w-3 h-3 text-pos" /> : <Copy className="w-3 h-3" />}
      {!compact && (copied ? 'Copied' : 'Copy')}
    </button>
  );
};
