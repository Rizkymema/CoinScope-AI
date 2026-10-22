/**
 * Stage 0 of the convergence flow: is a candidate wallet worth following?
 *
 * The on-chain check reads the wallet's newest transactions (up to SAMPLE_TXS, at most 90 days
 * back), turns them into swaps and closes them per token, then measures what the criteria ask for:
 * tokens traded in 30 days, win rate, realized profit over 30 and 90 days, how much of the profit
 * came from the single best trade, and the average hold time (sniper / MEV bots hold seconds).
 * It also flags deployer wallets and finds the account that funded the wallet, so wallets funded
 * from one source are counted as one cluster.
 *
 * A busy wallet can make hundreds of trades a day, so the sample may cover days, not months. The
 * figures say how many days they cover; for 30/90-day profit the user can enter the numbers shown
 * on Kolscan, GMGN or Nansen, which win over the sample.
 */
import type { ConvergenceConfig, CriteriaCheck, TrackedWallet, WalletEvaluation, WalletStats, WalletSwap } from '../types/convergence';
import { rpc } from './wallet.service';
import { isTokenCreation, parseWalletSwaps } from './walletwatch.service';

const SAMPLE_TXS = 150;
const SIGNATURE_LIMIT = 1000;
const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ pure statistics */

interface TokenBook {
  bought: number;
  sold: number;
  solIn: number;
  solOut: number;
  firstBuyAt: number;
  lastSellAt: number;
}

/**
 * Statistics from a wallet's swaps (any order). A token counts as a closed trade once the sample
 * shows it sold at least 90% of what it bought; its profit is SOL out minus SOL in.
 */
export function statsFromSwaps(
  swaps: WalletSwap[],
  ctx: { now: number; sampleTxs: number; oldestAt: number | null; newestAt: number | null; funder: string | null; deployer: boolean }
): WalletStats {
  const books = new Map<string, TokenBook>();
  [...swaps]
    .sort((a, b) => a.at - b.at)
    .forEach((s) => {
      const b = books.get(s.mint) || { bought: 0, sold: 0, solIn: 0, solOut: 0, firstBuyAt: 0, lastSellAt: 0 };
      if (s.side === 'buy') {
        b.bought += s.tokenAmount;
        b.solIn += s.solAmount;
        if (!b.firstBuyAt) b.firstBuyAt = s.at;
      } else if (b.bought > 0) {
        // A sell of a token bought before the sample started cannot be priced: skipped.
        b.sold += s.tokenAmount;
        b.solOut += s.solAmount;
        b.lastSellAt = s.at;
      }
      books.set(s.mint, b);
    });

  const closed = [...books.values()].filter((b) => b.bought > 0 && b.sold >= b.bought * 0.9);
  const profitOf = (b: TokenBook) => b.solOut - b.solIn;
  const within = (days: number) => closed.filter((b) => ctx.now - b.lastSellAt <= days * DAY_MS);
  const sampleDays = ctx.oldestAt && ctx.newestAt ? Math.max(0, (ctx.newestAt - ctx.oldestAt) / DAY_MS) : 0;
  const coversDays = ctx.oldestAt ? (ctx.now - ctx.oldestAt) / DAY_MS : 0;
  const sum = (bs: TokenBook[]) => bs.reduce((a, b) => a + profitOf(b), 0);
  const net = sum(closed);
  const wins = closed.filter((b) => profitOf(b) > 0);
  const bestWin = wins.reduce((m, b) => Math.max(m, profitOf(b)), 0);
  const holds = closed.filter((b) => b.firstBuyAt && b.lastSellAt).map((b) => (b.lastSellAt - b.firstBuyAt) / 60_000);
  const bought30 = [...books.entries()].filter(([, b]) => b.firstBuyAt && ctx.now - b.firstBuyAt <= 30 * DAY_MS).length;

  return {
    analyzedAt: ctx.now,
    sampleTxs: ctx.sampleTxs,
    sampleDays: Math.round(sampleDays * 10) / 10,
    tokensTraded30d: bought30,
    winRate: closed.length >= 5 ? Math.round((1000 * wins.length) / closed.length) / 10 : null,
    pnl30dSol: coversDays >= 30 ? round4(sum(within(30))) : null,
    pnl90dSol: coversDays >= 90 ? round4(sum(within(90))) : null,
    pnlSampleSol: round4(net),
    closedTrades: closed.length,
    largestWinShare: net > 0 && bestWin > 0 ? Math.round((1000 * bestWin) / net) / 1000 : null,
    avgHoldMinutes: holds.length ? Math.round((10 * holds.reduce((a, b) => a + b, 0)) / holds.length) / 10 : null,
    lastActiveAt: ctx.newestAt,
    funder: ctx.funder,
    deployer: ctx.deployer,
  };
}

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

/** The account that sent `wallet` SOL in its first transaction. */
export function funderOf(tx: any, wallet: string): string | null {
  const keys: string[] = (tx?.transaction?.message?.accountKeys || []).map((k: any) => (typeof k === 'string' ? k : String(k?.pubkey || '')));
  const pre: number[] = tx?.meta?.preBalances || [];
  const post: number[] = tx?.meta?.postBalances || [];
  const idx = keys.indexOf(wallet);
  if (idx < 0 || !(post[idx] > pre[idx])) return null;
  if (keys[0] && keys[0] !== wallet) return keys[0];
  let best: string | null = null;
  let drop = 0;
  keys.forEach((k, i) => {
    const d = (pre[i] || 0) - (post[i] || 0);
    if (k !== wallet && d > drop) {
      drop = d;
      best = k;
    }
  });
  return best;
}

/* ------------------------------------------------------------------ criteria */

const fmtPct = (v: number) => `${v.toFixed(0)}%`;

/** Criteria checks for one wallet; manual figures win over the on-chain sample. */
export function evaluateWallet(w: TrackedWallet, cfg: ConvergenceConfig, now = Date.now()): WalletEvaluation {
  const s = w.stats;
  const m = w.manual || {};
  const checks: CriteriaCheck[] = [];
  const sampleNote = s && s.sampleDays < 30 ? ` (sample ${s.sampleDays}d)` : '';

  const tokens = m.tokensTraded30d ?? s?.tokensTraded30d;
  checks.push({
    key: 'tokens',
    label: `Tokens traded, 30d ≥ ${cfg.minTokensTraded30d}`,
    value: tokens === undefined ? 'n/a' : `${tokens}${m.tokensTraded30d === undefined ? sampleNote : ''}`,
    // A short sample that already shows enough tokens passes; a short sample that shows too few proves nothing.
    state:
      tokens === undefined
        ? 'unknown'
        : tokens >= cfg.minTokensTraded30d
        ? 'pass'
        : m.tokensTraded30d !== undefined || (s && s.sampleDays >= 30)
        ? 'fail'
        : 'unknown',
  });

  const winRate = m.winRate ?? s?.winRate ?? undefined;
  checks.push({
    key: 'winRate',
    label: `Win rate ≥ ${cfg.minWinRate}%`,
    value: winRate == null ? 'n/a' : `${fmtPct(winRate)}${m.winRate === undefined && s ? ` of ${s.closedTrades}` : ''}`,
    state: winRate == null ? 'unknown' : winRate >= cfg.minWinRate ? 'pass' : 'fail',
  });

  const p30 = m.pnl30d ?? s?.pnl30dSol ?? undefined;
  const p90 = m.pnl90d ?? s?.pnl90dSol ?? undefined;
  const sign = (v: number | undefined | null) => (v == null ? '?' : v > 0 ? '+' : '−');
  checks.push({
    key: 'pnl',
    label: 'Realized profit positive, 30d and 90d',
    value: p30 == null && p90 == null ? (s && typeof s.pnlSampleSol === 'number' ? `sample ${s.pnlSampleSol >= 0 ? '+' : ''}${s.pnlSampleSol.toFixed(2)} SOL / ${s.sampleDays}d` : 'n/a') : `30d ${sign(p30)} · 90d ${sign(p90)}`,
    state: (p30 != null && p30 <= 0) || (p90 != null && p90 <= 0) ? 'fail' : p30 != null && p90 != null ? 'pass' : 'unknown',
  });

  const share = m.largestWinShare ?? s?.largestWinShare ?? undefined;
  checks.push({
    key: 'concentration',
    label: `Best trade < ${Math.round(cfg.maxLargestWinShare * 100)}% of profit`,
    value: share == null ? 'n/a' : fmtPct(share * 100),
    state: share == null ? 'unknown' : share < cfg.maxLargestWinShare ? 'pass' : 'fail',
  });

  const hold = m.avgHoldMinutes ?? s?.avgHoldMinutes ?? undefined;
  checks.push({
    key: 'hold',
    label: `Average hold > ${cfg.minAvgHoldMinutes} min`,
    value: hold == null ? 'n/a' : hold < 60 ? `${hold.toFixed(1)} min` : `${(hold / 60).toFixed(1)} h`,
    state: hold == null ? 'unknown' : hold > cfg.minAvgHoldMinutes ? 'pass' : 'fail',
  });

  const flags: string[] = [];
  let mustDrop = false;
  if (s?.deployer) {
    flags.push('Deployed a token (dev / deployer wallet)');
    mustDrop = true;
  }
  const lastActive = Math.max(s?.lastActiveAt || 0, w.lastSeenAt || 0);
  if (lastActive && now - lastActive > cfg.inactiveDays * DAY_MS) {
    flags.push(`No transaction for ${Math.floor((now - lastActive) / DAY_MS)} days`);
    mustDrop = true;
  }
  if (w.autoClusterId && !w.clusterId) flags.push('Funded from the same source as another tracked wallet - counted as one cluster');
  if (s && now - s.analyzedAt > 7 * DAY_MS) flags.push('Last verified over a week ago');

  const anyFail = checks.some((c) => c.state === 'fail');
  const verdict = mustDrop || anyFail ? 'fail' : checks.every((c) => c.state === 'pass') ? 'pass' : 'incomplete';
  return { checks, verdict, flags };
}

/** The cluster a wallet counts in: the user's label, a shared funder, or the wallet itself. */
export const clusterOf = (w: Pick<TrackedWallet, 'address' | 'clusterId' | 'autoClusterId'>) => w.clusterId || w.autoClusterId || w.address;

/** autoClusterId for every wallet whose funder also funded another tracked wallet. */
export function deriveAutoClusters(wallets: TrackedWallet[]): TrackedWallet[] {
  // An exchange hot wallet funds thousands of unrelated wallets: it is not a cluster.
  const funderOfWallet = (w: TrackedWallet) => (w.stats?.funder && !w.stats.funderIsService ? w.stats.funder : null);
  const byFunder = new Map<string, number>();
  wallets.forEach((w) => {
    const f = funderOfWallet(w);
    if (f) byFunder.set(f, (byFunder.get(f) || 0) + 1);
  });
  return wallets.map((w) => {
    const f = funderOfWallet(w);
    const autoClusterId = f && (byFunder.get(f) || 0) >= 2 ? `funder:${f}` : undefined;
    return autoClusterId === w.autoClusterId ? w : { ...w, autoClusterId };
  });
}

/* ------------------------------------------------------------------ on-chain read */

async function mapLimit<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await run(items[next++]);
    })
  );
}

export const WalletAnalysis = {
  /**
   * Reads the wallet's recent transactions and returns its statistics. `onProgress` reports how
   * many transactions were read. Throws when the RPC cannot list the wallet's signatures.
   */
  async analyze(address: string, rpcUrl: string, solPriceUsd: number, onProgress?: (done: number, total: number) => void): Promise<WalletStats> {
    const now = Date.now();
    const sigs: { signature: string; err: unknown; blockTime?: number | null }[] = await rpc(rpcUrl, 'getSignaturesForAddress', [
      address,
      { limit: SIGNATURE_LIMIT, commitment: 'confirmed' },
    ]);
    const list = Array.isArray(sigs) ? sigs : [];
    const newestAt = list[0]?.blockTime ? list[0].blockTime * 1000 : null;
    const ok = list.filter((s) => !s.err && (!s.blockTime || now - s.blockTime * 1000 <= 90 * DAY_MS)).slice(0, SAMPLE_TXS);
    const swaps: WalletSwap[] = [];
    let deployer = false;
    let done = 0;
    let oldestAt: number | null = null;
    // Two at a time: the live monitor shares the same RPC budget.
    await mapLimit(ok, 2, async (s) => {
      try {
        const tx = await rpc(rpcUrl, 'getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
        if (tx) {
          swaps.push(...parseWalletSwaps(tx, address, solPriceUsd, s.signature));
          if (isTokenCreation(tx, address)) deployer = true;
          const at = tx.blockTime ? tx.blockTime * 1000 : null;
          if (at && (oldestAt === null || at < oldestAt)) oldestAt = at;
        }
      } catch {
        // one unreadable transaction does not spoil the sample
      }
      onProgress?.(++done, ok.length);
    });

    // Under a full page means the list reaches the wallet's first transaction: who funded it.
    let funder: string | null = null;
    let funderIsService = false;
    if (list.length > 0 && list.length < SIGNATURE_LIMIT) {
      const first = list[list.length - 1];
      try {
        const tx = await rpc(rpcUrl, 'getTransaction', [first.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
        funder = funderOf(tx, address);
        if (funder) {
          // A funder with a full page of recent transactions is an exchange or a service, not an owner.
          const fs = await rpc<unknown[]>(rpcUrl, 'getSignaturesForAddress', [funder, { limit: SIGNATURE_LIMIT, commitment: 'confirmed' }]);
          funderIsService = Array.isArray(fs) && fs.length >= SIGNATURE_LIMIT;
        }
      } catch {
        // funder stays unknown
      }
    }

    return { ...statsFromSwaps(swaps, { now, sampleTxs: ok.length, oldestAt, newestAt, funder, deployer }), funderIsService };
  },
};
