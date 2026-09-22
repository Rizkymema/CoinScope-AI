'use client';

import React, { useState } from 'react';

/**
 * Chain identity. Solid brand colours only - no gradients, no decorative tints.
 * `dot` is the colour used for the corner badge, `chip` for the inline text badge.
 */
const CHAINS: Record<string, { label: string; dot: string; chip: string }> = {
  solana: { label: 'SOL', dot: '#9945ff', chip: 'bg-[#9945ff]/12 text-[#c4a1ff] border-[#9945ff]/25' },
  ethereum: { label: 'ETH', dot: '#627eea', chip: 'bg-[#627eea]/12 text-[#a3b4f5] border-[#627eea]/25' },
  base: { label: 'BASE', dot: '#0052ff', chip: 'bg-[#0052ff]/14 text-[#7fa5ff] border-[#0052ff]/28' },
  bsc: { label: 'BNB', dot: '#f0b90b', chip: 'bg-[#f0b90b]/12 text-[#f5d67f] border-[#f0b90b]/25' },
  arbitrum: { label: 'ARB', dot: '#28a0f0', chip: 'bg-[#28a0f0]/12 text-[#93cff8] border-[#28a0f0]/25' },
  polygon: { label: 'POL', dot: '#8247e5', chip: 'bg-[#8247e5]/12 text-[#c1a3f2] border-[#8247e5]/25' },
  avalanche: { label: 'AVAX', dot: '#e84142', chip: 'bg-[#e84142]/12 text-[#f4a0a0] border-[#e84142]/25' },
  optimism: { label: 'OP', dot: '#ff0420', chip: 'bg-[#ff0420]/12 text-[#ff8291] border-[#ff0420]/25' },
  sui: { label: 'SUI', dot: '#4da2ff', chip: 'bg-[#4da2ff]/12 text-[#a6d0ff] border-[#4da2ff]/25' },
  ton: { label: 'TON', dot: '#0098ea', chip: 'bg-[#0098ea]/12 text-[#7fcbf4] border-[#0098ea]/25' },
  robinhood: { label: 'RHC', dot: '#25d366', chip: 'bg-[#25d366]/12 text-[#8ee7ab] border-[#25d366]/25' },
  arc: { label: 'ARC', dot: '#f97316', chip: 'bg-[#f97316]/12 text-[#fbbf8c] border-[#f97316]/25' },
  hyperliquid: { label: 'HYPE', dot: '#97fce4', chip: 'bg-[#97fce4]/12 text-[#97fce4] border-[#97fce4]/25' },
  berachain: { label: 'BERA', dot: '#814625', chip: 'bg-[#814625]/20 text-[#d4a884] border-[#814625]/35' },
  abstract: { label: 'ABS', dot: '#4ade80', chip: 'bg-[#4ade80]/12 text-[#86efac] border-[#4ade80]/25' },
};

/** Muted monogram tints. Low saturation so avatars never compete with data. */
const MONOGRAM_TINTS = [
  'bg-[#1b2440] text-[#9db4e8]',
  'bg-[#1c2c33] text-[#8fc4d4]',
  'bg-[#2a2338] text-[#b6a0d8]',
  'bg-[#1f2e28] text-[#8fcbb0]',
  'bg-[#31261f] text-[#d8ae8c]',
  'bg-[#2e2029] text-[#d59db3]',
];

/** Hosts that already serve browser-friendly CORS/CORP headers and need no proxy. */
const DIRECT_HOSTS = ['dd.dexscreener.com', 'cdn.dexscreener.com', 'coin-images.coingecko.com', 'assets.coingecko.com'];

/**
 * IPFS gateways rate-limit browsers and send `Cross-Origin-Resource-Policy: same-origin`,
 * so those logos are routed through our own cached proxy instead.
 */
export function tokenImageSrc(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('/')) return url;
  if (url.startsWith('ipfs://')) return `/api/img?u=${encodeURIComponent(url)}`;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (DIRECT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return url;
    return `/api/img?u=${encodeURIComponent(url)}`;
  } catch {
    return undefined;
  }
}

interface CoinAvatarProps {
  imageUrl?: string;
  symbol: string;
  chainId?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showChain?: boolean;
  className?: string;
}

const SIZE = { xs: 'w-5 h-5', sm: 'w-7 h-7', md: 'w-9 h-9', lg: 'w-11 h-11', xl: 'w-14 h-14' };
const TEXT = { xs: 'text-[8px]', sm: 'text-[9px]', md: 'text-[11px]', lg: 'text-xs', xl: 'text-sm' };
const BADGE = {
  xs: 'w-2 h-2 -bottom-px -right-px',
  sm: 'w-2.5 h-2.5 -bottom-0.5 -right-0.5',
  md: 'w-3 h-3 -bottom-0.5 -right-0.5',
  lg: 'w-3.5 h-3.5 -bottom-0.5 -right-0.5',
  xl: 'w-4 h-4 -bottom-0.5 -right-0.5',
};

function tintFor(symbol: string): string {
  const s = String(symbol || 'UN');
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return MONOGRAM_TINTS[hash % MONOGRAM_TINTS.length];
}

export const CoinAvatar: React.FC<CoinAvatarProps> = ({
  imageUrl,
  symbol,
  chainId,
  size = 'md',
  showChain = true,
  className = '',
}) => {
  const [failed, setFailed] = useState(false);
  const chain = CHAINS[String(chainId || '').toLowerCase()];
  const monogram = String(symbol || 'UN').replace(/^\$/, '').slice(0, 2).toUpperCase();
  const src = failed ? undefined : tokenImageSrc(imageUrl);

  return (
    <div className={`relative inline-flex shrink-0 ${className}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          aria-hidden="true"
          className={`${SIZE[size]} rounded-full object-cover bg-ink-850 ring-1 ring-white/10`}
          onError={() => setFailed(true)}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div
          aria-hidden="true"
          className={`${SIZE[size]} ${TEXT[size]} ${tintFor(symbol)} rounded-full ring-1 ring-white/10 flex items-center justify-center font-bold tracking-tight`}
        >
          {monogram}
        </div>
      )}

      {showChain && chain && (
        <span
          className={`absolute ${BADGE[size]} rounded-full ring-2 ring-ink-900`}
          style={{ backgroundColor: chain.dot }}
          title={chain.label}
        />
      )}
    </div>
  );
};

export const ChainBadge: React.FC<{ chainId?: string; className?: string }> = ({ chainId, className = '' }) => {
  if (!chainId) return null;
  const raw = String(chainId);
  const chain = CHAINS[raw.toLowerCase()];
  const label = chain?.label ?? raw.toUpperCase();
  return (
    <span
      title={raw}
      className={`inline-flex items-center h-[18px] px-1.5 rounded-[5px] border text-[10px] font-bold leading-none whitespace-nowrap ${
        chain?.chip ?? 'bg-ink-800 text-slate-400 border-white/8'
      } ${className}`}
    >
      {label}
    </span>
  );
};

export { formatNumber, formatPrice, timeAgo } from '../lib/formatters';
