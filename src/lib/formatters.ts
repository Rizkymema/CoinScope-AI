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
