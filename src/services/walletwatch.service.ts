/**
 * Smart-wallet monitor (convergence flow, stage 1 input).
 *
 * Every tracked wallet is polled in turn through Solana RPC: `getSignaturesForAddress` returns the
 * signatures newer than the last one seen, and each new transaction is read with `getTransaction`
 * and reduced to the swap it made (token in / SOL out = buy, token out / SOL in = sell). With 50
 * wallets and a 30 s cycle that is under two signature calls a second plus one call per new trade,
 * so a private RPC (Helius, QuickNode, Triton) is strongly recommended over the public endpoint.
 *
 * PumpPortal's account-trade stream is subscribed as well. When it delivers, bonding-curve trades
 * arrive within a second; signatures are de-duplicated, so the poller never double counts them.
 */
import type { TokenTradeEvent } from '../types/bot';
import type { WalletSwap } from '../types/convergence';
import { rpc } from './wallet.service';
import { wsService } from './websocket.service';

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const USD_MINTS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);
/** A SOL change below this is a transfer, rent or fee - not a trade. */
const MIN_QUOTE_SOL = 0.0005;

/* ------------------------------------------------------------------ parsing */

interface TokenBalanceRow {
  accountIndex?: number;
  mint: string;
  owner?: string;
  uiTokenAmount?: { amount?: string; decimals?: number; uiAmount?: number | null; uiAmountString?: string };
}

function uiAmount(row: TokenBalanceRow): number {
  const t = row.uiTokenAmount;
  if (!t) return 0;
  if (typeof t.uiAmount === 'number') return t.uiAmount;
  if (t.uiAmountString) return Number(t.uiAmountString) || 0;
  const dec = Number(t.decimals) || 0;
  return (Number(t.amount) || 0) / 10 ** dec;
}

function accountKeyList(tx: any): string[] {
  const keys = tx?.transaction?.message?.accountKeys;
  if (!Array.isArray(keys)) return [];
  return keys.map((k: any) => (typeof k === 'string' ? k : String(k?.pubkey || '')));
}

/** Sum of a wallet's balance per mint across its token accounts. */
function balancesOf(rows: TokenBalanceRow[] | undefined, wallet: string): Map<string, number> {
  const out = new Map<string, number>();
  (rows || []).forEach((r) => {
    if (r?.owner !== wallet || !r.mint) return;
    out.set(r.mint, (out.get(r.mint) || 0) + uiAmount(r));
  });
  return out;
}

/**
 * The swap `wallet` made in a confirmed jsonParsed transaction, or [] when the transaction is not a
 * single-token swap against SOL / WSOL / USDC / USDT (transfers, airdrops, token-to-token routes).
 * Pure: unit-testable with recorded transactions.
 */
export function parseWalletSwaps(tx: any, wallet: string, solPriceUsd: number, signature?: string): WalletSwap[] {
  const meta = tx?.meta;
  if (!meta || meta.err) return [];
  const keys = accountKeyList(tx);
  const idx = keys.indexOf(wallet);

  // Native SOL change of the wallet, with the network fee given back when it paid it.
  let solDelta = 0;
  if (idx >= 0 && Array.isArray(meta.preBalances) && Array.isArray(meta.postBalances)) {
    const lamports = Number(meta.postBalances[idx]) - Number(meta.preBalances[idx]);
    const fee = idx === 0 ? Number(meta.fee) || 0 : 0;
    solDelta = (lamports + fee) / 1e9;
  }

  const pre = balancesOf(meta.preTokenBalances, wallet);
  const post = balancesOf(meta.postTokenBalances, wallet);
  const mints = new Set([...pre.keys(), ...post.keys()]);
  let usdDelta = 0;
  const changed: { mint: string; pre: number; post: number; delta: number }[] = [];
  mints.forEach((mint) => {
    const a = pre.get(mint) || 0;
    const b = post.get(mint) || 0;
    const delta = b - a;
    if (mint === WSOL_MINT) solDelta += delta;
    else if (USD_MINTS.has(mint)) usdDelta += delta;
    else if (Math.abs(delta) > 0 && Math.abs(delta) > Math.max(a, b) * 1e-9) changed.push({ mint, pre: a, post: b, delta });
  });
  if (changed.length !== 1) return [];

  const quoteSol = solDelta + (usdDelta && solPriceUsd > 0 ? usdDelta / solPriceUsd : 0);
  const c = changed[0];
  const side: 'buy' | 'sell' | null = c.delta > 0 && quoteSol < -MIN_QUOTE_SOL ? 'buy' : c.delta < 0 && quoteSol > MIN_QUOTE_SOL ? 'sell' : null;
  if (!side) return [];
  const solAmount = Math.abs(quoteSol);
  const tokenAmount = Math.abs(c.delta);
  const sig = signature || String(tx?.transaction?.signatures?.[0] || '');
  return [
    {
      wallet,
      mint: c.mint,
      side,
      solAmount,
      tokenAmount,
      priceSol: tokenAmount > 0 ? solAmount / tokenAmount : 0,
      preBalance: c.pre,
      postBalance: c.post,
      signature: sig,
      at: tx?.blockTime ? Number(tx.blockTime) * 1000 : Date.now(),
      source: 'rpc',
    },
  ];
}

/** The wallet created a token mint in this transaction (deployer). */
export function isTokenCreation(tx: any, wallet: string): boolean {
  const keys = accountKeyList(tx);
  if (keys[0] !== wallet) return false;
  const logs: string[] = tx?.meta?.logMessages || [];
  return logs.some((l) => /Instruction: InitializeMint2?$/.test(l));
}

/** A PumpPortal account-trade event as a swap. Balances are NaN when the stream did not send them. */
export function swapFromStream(trade: TokenTradeEvent): WalletSwap | null {
  const wallet = trade.traderPublicKey;
  if (!wallet || !trade.mint || !trade.signature) return null;
  const side = trade.txType === 'buy' ? 'buy' : trade.txType === 'sell' ? 'sell' : null;
  if (!side || !(trade.solAmount > 0) || !(trade.tokenAmount > 0)) return null;
  const post = trade.newTokenBalance;
  const hasPost = typeof post === 'number' && Number.isFinite(post);
  return {
    wallet,
    mint: trade.mint,
    side,
    solAmount: trade.solAmount,
    tokenAmount: trade.tokenAmount,
    priceSol: trade.solAmount / trade.tokenAmount,
    preBalance: hasPost ? (side === 'buy' ? Math.max(0, post - trade.tokenAmount) : post + trade.tokenAmount) : NaN,
    postBalance: hasPost ? post : NaN,
    signature: trade.signature,
    at: trade.timestamp || Date.now(),
    source: 'stream',
  };
}

/* ------------------------------------------------------------------ monitor */

export interface MonitorStatus {
  running: boolean;
  wallets: number;
  /** Seconds one full round over every wallet takes at the current pace. */
  cycleSeconds: number;
  lastPollAt: number | null;
  polls: number;
  swaps: number;
  errors: number;
  lastError: string | null;
  streamSwaps: number;
}

export interface MonitorOptions {
  /** Tracked wallets that count toward signals. */
  wallets: () => string[];
  /** Other wallets to follow (dev wallets of open positions). */
  extraWallets: () => string[];
  rpcUrl: () => string;
  solPriceUsd: () => number;
  pollSeconds: () => number;
  /** How far back the first poll of a wallet replays its trades. */
  replayMs: () => number;
  onSwap: (swap: WalletSwap) => void;
  onStatus?: (status: MonitorStatus) => void;
}

const TICK_MS = 2_000;
const SIGNATURE_PAGE = 30;
const SEEN_CAP = 6_000;

interface WalletCursor {
  lastSig: string | null;
  seeded: boolean;
  backoffUntil: number;
  /** Signatures whose transaction could not be read yet (429, timeout, not indexed): retried. */
  retry: { sig: string; tries: number }[];
}

/** Most signature pages read per wallet and poll (a wallet that traded more waits for the next poll). */
const MAX_PAGES = 3;
const MAX_TX_TRIES = 4;
/** Pause for every wallet after the RPC answered "too many requests". */
const RATE_LIMIT_PAUSE_MS = 20_000;

const cursors = new Map<string, WalletCursor>();
const seen = new Set<string>();
const seenOrder: string[] = [];
let opts: MonitorOptions | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;
let rr = 0;
let globalPauseUntil = 0;
let unsubscribeStream: (() => void) | null = null;
const status: MonitorStatus = { running: false, wallets: 0, cycleSeconds: 0, lastPollAt: null, polls: 0, swaps: 0, errors: 0, lastError: null, streamSwaps: 0 };

function markSeen(sig: string): boolean {
  if (!sig || seen.has(sig)) return false;
  seen.add(sig);
  seenOrder.push(sig);
  if (seenOrder.length > SEEN_CAP) seen.delete(seenOrder.shift()!);
  return true;
}

function emitStatus() {
  try {
    opts?.onStatus?.({ ...status });
  } catch {
    // the UI must never break the monitor
  }
}

function watchedList(): string[] {
  if (!opts) return [];
  return [...new Set([...opts.wallets(), ...opts.extraWallets()])].filter(Boolean);
}

function noteError(err: any, fallback: string) {
  status.errors++;
  status.lastError = err?.message || fallback;
  // One rate-limited call pauses the whole monitor, not just this wallet.
  if (/429|rate.?limit|too many/i.test(status.lastError || '')) globalPauseUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
}

type SigRow = { signature: string; err: unknown; blockTime?: number | null };

/** Reads one transaction and emits its swap; false when it has to be read again later. */
async function readTx(wallet: string, sig: string, url: string): Promise<boolean> {
  if (!opts) return true;
  if (seen.has(sig)) return true;
  let tx: any;
  try {
    tx = await rpc(url, 'getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
  } catch (err) {
    noteError(err, 'getTransaction failed');
    return false;
  }
  // null right after confirmation is common on load-balanced RPCs: not lost, read again.
  if (!tx) return false;
  markSeen(sig);
  parseWalletSwaps(tx, wallet, opts.solPriceUsd(), sig).forEach((swap) => {
    status.swaps++;
    opts?.onSwap(swap);
  });
  return true;
}

async function pollWallet(wallet: string) {
  if (!opts) return;
  const cur = cursors.get(wallet) || { lastSig: null, seeded: false, backoffUntil: 0, retry: [] };
  cursors.set(wallet, cur);
  if (cur.backoffUntil > Date.now()) return;
  const url = opts.rpcUrl();

  // Transactions that could not be read last time come first (oldest first).
  if (cur.retry.length) {
    const pending = cur.retry;
    cur.retry = [];
    for (const r of pending) {
      if (!(await readTx(wallet, r.sig, url)) && r.tries + 1 < MAX_TX_TRIES) cur.retry.push({ sig: r.sig, tries: r.tries + 1 });
    }
  }

  // New signatures since the cursor, paged so a burst of trades is not skipped.
  const firstPoll = !cur.lastSig;
  const rows: SigRow[] = [];
  try {
    let before: string | undefined;
    for (let page = 0; page < (firstPoll ? 1 : MAX_PAGES); page++) {
      const params: Record<string, unknown> = { limit: firstPoll ? 15 : SIGNATURE_PAGE, commitment: 'confirmed' };
      if (cur.lastSig) params.until = cur.lastSig;
      if (before) params.before = before;
      const got: SigRow[] = await rpc(url, 'getSignaturesForAddress', [wallet, params]);
      if (!Array.isArray(got) || !got.length) break;
      rows.push(...got);
      if (got.length < SIGNATURE_PAGE) break;
      before = got[got.length - 1].signature;
    }
  } catch (err: any) {
    noteError(err, 'getSignaturesForAddress failed');
    cur.backoffUntil = Date.now() + 15_000;
    return;
  }
  status.polls++;
  status.lastPollAt = Date.now();
  cur.seeded = true;
  if (!rows.length) return;
  // The cursor moves to the newest signature; anything unread goes to the retry list, so nothing is lost.
  cur.lastSig = rows[0].signature;
  const cutoff = Date.now() - opts.replayMs();
  const fresh = rows
    .filter((r) => !r.err && (!firstPoll || (r.blockTime ? r.blockTime * 1000 >= cutoff : false)))
    .reverse(); // oldest first, so a buy is seen before the sell that follows it
  for (const r of fresh) {
    if (!opts) return;
    if (!(await readTx(wallet, r.signature, url))) cur.retry.push({ sig: r.signature, tries: 1 });
  }
}

async function tick() {
  if (busy || !opts) return;
  busy = true;
  try {
    const list = watchedList();
    status.wallets = list.length;
    syncStream(list);
    if (!list.length) return;
    const pollMs = Math.max(5, opts.pollSeconds()) * 1000;
    const perTick = Math.max(1, Math.ceil((list.length * TICK_MS) / pollMs));
    status.cycleSeconds = Math.round((Math.ceil(list.length / perTick) * TICK_MS) / 1000);
    if (Date.now() < globalPauseUntil) return;
    for (let i = 0; i < perTick; i++) {
      const wallet = list[rr++ % list.length];
      await pollWallet(wallet);
    }
  } finally {
    busy = false;
    emitStatus();
  }
}

function syncStream(list: string[]) {
  const want = new Set(list);
  const have = wsService.getTrackedAccounts();
  const drop = have.filter((w) => !want.has(w));
  if (drop.length) wsService.unsubscribeAccountTrades(drop);
  wsService.subscribeAccountTrades(list.filter((w) => !have.includes(w)));
}

export const WalletWatch = {
  start(options: MonitorOptions) {
    opts = options;
    if (timer) return;
    status.running = true;
    wsService.connect();
    unsubscribeStream = wsService.onTokenTrade((trade) => {
      if (!opts || !trade.traderPublicKey) return;
      if (!watchedList().includes(trade.traderPublicKey)) return;
      const swap = swapFromStream(trade);
      if (!swap || !markSeen(swap.signature)) return;
      status.streamSwaps++;
      status.swaps++;
      opts.onSwap(swap);
    });
    timer = setInterval(() => void tick(), TICK_MS);
    void tick();
  },

  stop() {
    if (timer) clearInterval(timer);
    timer = null;
    unsubscribeStream?.();
    unsubscribeStream = null;
    const subscribed = wsService.getTrackedAccounts();
    if (subscribed.length) wsService.unsubscribeAccountTrades(subscribed);
    status.running = false;
    emitStatus();
  },

  isRunning: () => !!timer,
  status: (): MonitorStatus => ({ ...status }),
  /** Forget a wallet's cursor (removed from the list), so re-adding it replays its last window. */
  forget(wallet: string) {
    cursors.delete(wallet);
  },
};
