'use client';

import React, { useState } from 'react';

// Map of known chain IDs to their colors
const CHAIN_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  solana: { bg: 'bg-gradient-to-br from-purple-500 to-fuchsia-600', text: 'text-purple-300', label: 'SOL' },
  ethereum: { bg: 'bg-gradient-to-br from-blue-500 to-indigo-600', text: 'text-blue-300', label: 'ETH' },
  bsc: { bg: 'bg-gradient-to-br from-yellow-500 to-amber-600', text: 'text-yellow-300', label: 'BSC' },
  base: { bg: 'bg-gradient-to-br from-blue-400 to-blue-600', text: 'text-blue-300', label: 'BASE' },
  arbitrum: { bg: 'bg-gradient-to-br from-sky-400 to-blue-600', text: 'text-sky-300', label: 'ARB' },
  polygon: { bg: 'bg-gradient-to-br from-violet-500 to-purple-700', text: 'text-violet-300', label: 'POLY' },
  avalanche: { bg: 'bg-gradient-to-br from-red-500 to-rose-600', text: 'text-red-300', label: 'AVAX' },
  optimism: { bg: 'bg-gradient-to-br from-red-400 to-red-600', text: 'text-red-300', label: 'OP' },
  fantom: { bg: 'bg-gradient-to-br from-blue-500 to-cyan-600', text: 'text-blue-300', label: 'FTM' },
  cronos: { bg: 'bg-gradient-to-br from-blue-800 to-indigo-900', text: 'text-blue-300', label: 'CRO' },
  sui: { bg: 'bg-gradient-to-br from-cyan-400 to-teal-600', text: 'text-cyan-300', label: 'SUI' },
  ton: { bg: 'bg-gradient-to-br from-sky-500 to-blue-700', text: 'text-sky-300', label: 'TON' },
};

interface CoinAvatarProps {
  imageUrl?: string;
  symbol: string;
  chainId?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showChain?: boolean;
  className?: string;
}

const SIZE_MAP = {
  xs: 'w-6 h-6',
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
  lg: 'w-12 h-12',
  xl: 'w-16 h-16',
};

const TEXT_SIZE_MAP = {
  xs: 'text-[8px]',
  sm: 'text-[10px]',
  md: 'text-xs',
  lg: 'text-sm',
  xl: 'text-lg',
};

const CHAIN_BADGE_SIZE = {
  xs: 'w-3 h-3 -bottom-0.5 -right-0.5',
  sm: 'w-3.5 h-3.5 -bottom-0.5 -right-0.5',
  md: 'w-4 h-4 -bottom-0.5 -right-0.5',
  lg: 'w-5 h-5 -bottom-0.5 -right-0.5',
  xl: 'w-6 h-6 -bottom-1 -right-1',
};

export const CoinAvatar: React.FC<CoinAvatarProps> = ({
  imageUrl,
  symbol,
  chainId,
  size = 'md',
  showChain = true,
  className = '',
}) => {
  const [imgError, setImgError] = useState(false);
  const safeChainId = String(chainId || '').toLowerCase();
  const chainInfo = safeChainId ? CHAIN_COLORS[safeChainId] : null;

  // Generate a consistent gradient from the symbol safely
  const getSymbolGradient = (sym: string) => {
    const safeSym = String(sym || 'UK');
    const hash = safeSym.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const gradients = [
      'from-indigo-500 to-purple-600',
      'from-emerald-500 to-teal-600',
      'from-orange-500 to-red-600',
      'from-cyan-500 to-blue-600',
      'from-pink-500 to-rose-600',
      'from-violet-500 to-fuchsia-600',
      'from-amber-500 to-yellow-600',
      'from-lime-500 to-green-600',
    ];
    return gradients[(hash || 0) % gradients.length];
  };

  const displaySymbol = String(symbol || 'UN').slice(0, 2).toUpperCase();

  return (
    <div className={`relative inline-flex shrink-0 ${className}`}>
      {imageUrl && !imgError ? (
        <img
          src={imageUrl}
          alt={`${displaySymbol} logo`}
          className={`${SIZE_MAP[size]} rounded-full object-cover ring-2 ring-slate-700/50`}
          onError={() => setImgError(true)}
          loading="lazy"
        />
      ) : (
        <div
          className={`${SIZE_MAP[size]} rounded-full bg-gradient-to-br ${getSymbolGradient(symbol)} flex items-center justify-center ${TEXT_SIZE_MAP[size]} font-bold text-white ring-2 ring-slate-700/50`}
        >
          {displaySymbol}
        </div>
      )}

      {/* Chain badge */}
      {showChain && chainInfo && (
        <div
          className={`absolute ${CHAIN_BADGE_SIZE[size]} rounded-full ${chainInfo.bg} flex items-center justify-center ring-2 ring-slate-900`}
          title={chainInfo.label}
        >
          <span className="text-[6px] font-bold text-white leading-none">
            {String(chainInfo.label).slice(0, 1)}
          </span>
        </div>
      )}
    </div>
  );
};

export const ChainBadge: React.FC<{ chainId?: string; className?: string }> = ({ chainId, className = '' }) => {
  if (!chainId) return null;
  const safeChainId = String(chainId).toLowerCase();
  const chain = CHAIN_COLORS[safeChainId];
  if (!chain) {
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-700 text-slate-300 ${className}`}>
        {String(chainId).toUpperCase()}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${chain.bg} text-white ${className}`}>
      {chain.label}
    </span>
  );
};

export function formatNumber(num: number | undefined | null): string {
  const safeNum = Number(num) || 0;
  if (safeNum >= 1_000_000_000) return `$${(safeNum / 1_000_000_000).toFixed(1)}B`;
  if (safeNum >= 1_000_000) return `$${(safeNum / 1_000_000).toFixed(1)}M`;
  if (safeNum >= 1_000) return `$${(safeNum / 1_000).toFixed(1)}K`;
  if (safeNum > 0) return `$${safeNum.toFixed(2)}`;
  return '$0.00';
}

export function formatPrice(price: number | undefined | null): string {
  const safePrice = Number(price) || 0;
  if (safePrice === 0) return '$0.00';
  if (safePrice >= 1000) return `$${safePrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (safePrice >= 1) return `$${safePrice.toFixed(4)}`;
  if (safePrice >= 0.01) return `$${safePrice.toFixed(6)}`;
  
  const str = safePrice.toFixed(12);
  const match = str.match(/^0\.(0+)(\d{4})/);
  if (match && match[1]) {
    const zeros = match[1].length;
    return `$0.0{${zeros}}${match[2]}`;
  }
  return `$${safePrice.toFixed(8)}`;
}

export function timeAgo(timestamp: number | undefined | null): string {
  if (!timestamp) return '';
  const safeTimestamp = Number(timestamp);
  const now = Date.now();
  const diff = now - safeTimestamp;
  if (diff < 0) return 'just now';
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}
