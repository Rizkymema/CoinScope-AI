/**
 * Recent marks of each open position, kept in memory for the live sparklines on the Auto Trade
 * page. Fed by every mark-to-market (stream tick or price poll); nothing here affects trading.
 */
const MAX_POINTS = 120;
const trails = new Map<string, { t: number; price: number }[]>();

export function recordPriceTrail(positionId: string, price: number): void {
  if (!(price > 0)) return;
  const list = trails.get(positionId) || [];
  const last = list[list.length - 1];
  // Polls repeat the same price; keep one point per change (or per 15 s while flat).
  if (last && last.price === price && Date.now() - last.t < 15_000) return;
  list.push({ t: Date.now(), price });
  if (list.length > MAX_POINTS) list.shift();
  trails.set(positionId, list);
}

export function getPriceTrail(positionId: string): { t: number; price: number }[] {
  return trails.get(positionId) || [];
}
