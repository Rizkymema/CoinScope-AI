/**
 * The smart-wallet convergence flow, run in the dashboard tab like the rest of the engine.
 *
 *   stage 0  wallet list: tiers, clusters, on-chain verification (persisted)
 *   stage 1  WalletWatch feeds every swap of a tracked wallet into the ConvergenceTracker; a token
 *            that reaches the trigger points opens a signal in the journal
 *   stage 2-4 each signal runs the hard gate, the momentum score and the AI review, one signal at a
 *            time; 40-59 waits on the watchlist and is re-checked every few minutes
 *   stage 5  sizing, risk guards, chase and price-impact checks, then the bot store's buy
 *   stage 6  the position carries an exit plan the bot store runs on every tick; the emergency
 *            exits (trigger wallets or dev selling, liquidity drop) are watched here
 *   stage 7  every signal stays in the journal with its price at +5m / +1h / +6h / +24h and its result
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  ConvergenceAiVerdict,
  ConvergenceConfig,
  ConvergenceSignal,
  ConvergenceTrigger,
  CheckpointKey,
  DEFAULT_CONVERGENCE_CONFIG,
  MAX_TRACKED_WALLETS,
  SignalStage,
  TrackedWallet,
  WalletSwap,
  WalletTier,
} from '../types/convergence';
import type { AiDecision } from '../types/bot';
import { WalletWatch, MonitorStatus } from '../services/walletwatch.service';
import { WalletAnalysis, clusterOf, deriveAutoClusters, evaluateWallet } from '../services/walletanalysis.service';
import {
  Candidate,
  ConvergenceTracker,
  WalletInfo,
  entryImpactPct,
  fetchBestPair,
  fetchPrices,
  lateCheck,
  momentumScore,
  priceAt,
  safetyGate,
  socialsOf,
} from '../services/convergence.service';
import { isSolanaAddress } from '../services/smartwallet.service';
import { mapPairToCoinData } from '../services/coin.service';
import { AIService } from '../services/ai.service';
import { SolPriceService } from '../services/solprice.service';
import { HotWallet } from '../services/hotwallet.service';
import { buildExitPlan } from '../lib/exit-plan';
import { isDailyLossReached, useBotStore } from './useBotStore';

const LOOP_MS = 5_000;
const EMERGENCY_POLL_MS = 30_000;
const CHECKPOINT_MS = 60_000;
const MAX_JOURNAL = 400;
const MAX_FEED = 40;
/** A token that opened a signal is not signalled again for this long. */
const SIGNAL_COOLDOWN_MS = 60 * 60_000;
/** Market-data retries before a signal without a DexScreener pair is dropped. */
const MAX_DATA_RETRIES = 4;
const DATA_RETRY_MS = 45_000;
/** Claude is asked again about a watched token at most this often. */
const AI_RECHECK_MS = 10 * 60_000;
const ENTRY_RESERVE_SOL = 0.005;

export const CHECKPOINTS: { key: CheckpointKey; label: string; offsetMs: number; liveForMs: number }[] = [
  { key: 'm5', label: '+5m', offsetMs: 5 * 60_000, liveForMs: 10 * 60_000 },
  { key: 'h1', label: '+1h', offsetMs: 60 * 60_000, liveForMs: 20 * 60_000 },
  { key: 'h6', label: '+6h', offsetMs: 6 * 3_600_000, liveForMs: 60 * 60_000 },
  { key: 'h24', label: '+24h', offsetMs: 24 * 3_600_000, liveForMs: 3 * 3_600_000 },
];

export type PipelineStep = 'trigger' | 'safety' | 'momentum' | 'ai' | 'execution';

export interface FeedItem {
  swap: WalletSwap;
  label: string;
  tier?: WalletTier;
  dev?: boolean;
}

/**
 * Live, fast-changing state (monitor heartbeat, swap feed, pipeline progress). Kept out of the
 * persisted store so a heartbeat every two seconds does not rewrite the journal to localStorage.
 */
interface LiveState {
  monitor: MonitorStatus | null;
  candidates: Candidate[];
  feed: FeedItem[];
  /** Signal id -> the stage it is in right now. */
  progress: Record<string, { step: PipelineStep; startedAt: number }>;
  analyzing: Record<string, { done: number; total: number; error?: string }>;
}

export const useConvergenceLive = create<LiveState>()(() => ({ monitor: null, candidates: [], feed: [], progress: {}, analyzing: {} }));

interface ConvergenceState {
  wallets: TrackedWallet[];
  config: ConvergenceConfig;
  journal: ConvergenceSignal[];
  /** Watch wallets and record signals even while auto trade is off. */
  monitorOn: boolean;

  init: () => void;
  addWallets: (addresses: string[], meta?: { source?: string; tier?: WalletTier; label?: string }) => { added: number; error?: string };
  updateWallet: (address: string, patch: Partial<TrackedWallet>) => void;
  removeWallet: (address: string) => void;
  analyzeWallet: (address: string) => Promise<void>;
  /** Re-verifies every wallet, one after another (weekly maintenance). */
  analyzeAll: () => void;
  setConfig: (patch: Partial<ConvergenceConfig>) => void;
  resetConfig: () => void;
  setMonitorOn: (on: boolean) => void;
  clearJournal: () => void;
  isRunning: () => boolean;
}

/* ------------------------------------------------------------------ module state */

let initialized = false;
let loopTimer: ReturnType<typeof setInterval> | null = null;
let lastEmergencyPoll = 0;
let lastCheckpointRun = 0;
let lastBackfillAt = 0;
let infoByAddress = new Map<string, WalletInfo>();
let pipelineChain: Promise<void> = Promise.resolve();
/** Wallet verifications run one after another: each reads up to 150 transactions. */
let analysisChain: Promise<void> = Promise.resolve();
const queueAnalysis = (address: string) => {
  analysisChain = analysisChain.then(() => useConvergenceStore.getState().analyzeWallet(address)).catch(() => {});
};
const queued = new Set<string>();
const retryAt = new Map<string, number>();
const dataRetries = new Map<string, number>();
/** Per signal: holder counts and dev holdings read at each safety check (red flags, holder trend). */
const samples = new Map<string, { holders: { at: number; holders: number }[]; devPct: number[] }>();
const lastAiAt = new Map<string, number>();

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const solPrice = () => useBotStore.getState().solPriceUsd || SolPriceService.getCached() || 0;
const uid = () => `sig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function rebuildInfo(wallets: TrackedWallet[], cfg: ConvergenceConfig) {
  const map = new Map<string, WalletInfo>();
  wallets.forEach((w) => {
    const ev = evaluateWallet(w, cfg);
    const counts = w.active && (cfg.onlyVerifiedWallets ? ev.verdict === 'pass' : ev.verdict !== 'fail');
    map.set(w.address, { address: w.address, label: w.label, tier: w.tier, cluster: clusterOf(w), counts });
  });
  infoByAddress = map;
}

const tracker = new ConvergenceTracker(
  () => useConvergenceStore.getState().config,
  (address) => infoByAddress.get(address),
  () => solPrice()
);

/**
 * localStorage that never throws: a full quota (a long journal) keeps the last saved state instead
 * of breaking the engine; the journal is trimmed and saved again on the next change.
 */
const safeStorage = {
  getItem: (k: string) => {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k: string, v: string) => {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      const st = useConvergenceStore.getState();
      if (st.journal.length > 50) setTimeout(() => useConvergenceStore.setState({ journal: st.journal.slice(0, Math.floor(st.journal.length * 0.7)) }), 0);
    }
  },
  removeItem: (k: string) => {
    try {
      window.localStorage.removeItem(k);
    } catch {
      // ignore
    }
  },
};

/* ------------------------------------------------------------------ store */

export const useConvergenceStore = create<ConvergenceState>()(
  persist(
    (set, get) => ({
      wallets: [],
      config: DEFAULT_CONVERGENCE_CONFIG,
      journal: [],
      monitorOn: false,

      init: () => {
        if (initialized || typeof window === 'undefined') return;
        initialized = true;
        Promise.resolve(useConvergenceStore.persist.rehydrate()).then(() => {
          importFromSettings();
          rebuildInfo(get().wallets, get().config);
          // A wallet added from elsewhere (MCP update_settings, the copilot) joins the list.
          useBotStore.subscribe((s, prev) => {
            if (s.settings.smartWallets !== prev.settings.smartWallets) importFromSettings();
          });
          // Signals left mid-pipeline by a closed tab are picked up again (or expire).
          get().journal.filter((sig) => sig.status === 'evaluating').forEach((sig) => retryAt.set(sig.id, Date.now()));
          loopTimer = setInterval(() => void loop(), LOOP_MS);
          void loop();
        });
      },

      addWallets: (addresses, meta) => {
        const list = [...new Set(addresses.map((a) => a.trim()).filter(Boolean))];
        const bad = list.find((a) => !isSolanaAddress(a));
        if (bad) return { added: 0, error: `Not a Solana wallet address: ${bad}` };
        const have = new Set(get().wallets.map((w) => w.address));
        const fresh = list.filter((a) => !have.has(a));
        const room = MAX_TRACKED_WALLETS - get().wallets.length;
        const take = fresh.slice(0, Math.max(0, room));
        if (take.length) {
          const now = Date.now();
          setWallets([
            ...get().wallets,
            ...take.map((address) => ({ address, label: meta?.label, source: meta?.source || 'Manual', addedAt: now, tier: meta?.tier || 'B', active: true }) as TrackedWallet),
          ]);
          take.forEach((a) => queueAnalysis(a));
        }
        return {
          added: take.length,
          error: fresh.length > take.length ? `The list holds ${MAX_TRACKED_WALLETS} wallets; ${fresh.length - take.length} not added.` : undefined,
        };
      },

      updateWallet: (address, patch) => {
        setWallets(get().wallets.map((w) => (w.address === address ? { ...w, ...patch, address } : w)));
      },

      removeWallet: (address) => {
        setWallets(get().wallets.filter((w) => w.address !== address));
        WalletWatch.forget(address);
        const bot = useBotStore.getState();
        bot.updateSettings({ smartWallets: (bot.settings.smartWallets || []).filter((a) => a !== address) });
      },

      analyzeWallet: async (address) => {
        const live = useConvergenceLive;
        const cur = live.getState().analyzing[address];
        if (cur && !cur.error) return;
        if (!get().wallets.some((w) => w.address === address)) return;
        live.setState((s) => ({ analyzing: { ...s.analyzing, [address]: { done: 0, total: 0 } } }));
        try {
          const stats = await WalletAnalysis.analyze(address, useBotStore.getState().settings.solanaRpcUrl, solPrice(), (done, total) =>
            live.setState((s) => ({ analyzing: { ...s.analyzing, [address]: { done, total } } }))
          );
          setWallets(get().wallets.map((w) => (w.address === address ? { ...w, stats } : w)));
          live.setState((s) => {
            const { [address]: _, ...rest } = s.analyzing;
            return { analyzing: rest };
          });
        } catch (err: any) {
          live.setState((s) => ({ analyzing: { ...s.analyzing, [address]: { done: 0, total: 0, error: err?.message || 'RPC did not answer' } } }));
        }
      },

      analyzeAll: () => {
        get().wallets.forEach((w) => queueAnalysis(w.address));
      },

      setConfig: (patch) => {
        set((s) => ({ config: { ...s.config, ...patch } }));
        rebuildInfo(get().wallets, get().config);
      },

      resetConfig: () => {
        set({ config: { ...DEFAULT_CONVERGENCE_CONFIG, narratives: get().config.narratives } });
        rebuildInfo(get().wallets, get().config);
      },

      setMonitorOn: (on) => {
        set({ monitorOn: on });
        void loop();
      },

      clearJournal: () => set({ journal: [] }),

      isRunning: () => WalletWatch.isRunning(),
    }),
    {
      name: 'coinscope-convergence-v1',
      storage: createJSONStorage(() => safeStorage),
      skipHydration: true,
      partialize: (s) => ({ wallets: s.wallets, config: s.config, journal: s.journal, monitorOn: s.monitorOn }),
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<ConvergenceState>;
        return { ...current, ...p, config: { ...DEFAULT_CONVERGENCE_CONFIG, ...(p.config || {}) } };
      },
    }
  )
);

/* ------------------------------------------------------------------ wallets */

function setWallets(wallets: TrackedWallet[]) {
  const derived = deriveAutoClusters(wallets);
  useConvergenceStore.setState({ wallets: derived });
  rebuildInfo(derived, useConvergenceStore.getState().config);
  // The setup scanner's discovery reads the same list (tier A first).
  const addresses = [...derived].sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'A' ? -1 : 1)).filter((w) => w.active).map((w) => w.address);
  const bot = useBotStore.getState();
  const cur = bot.settings.smartWallets || [];
  const same = cur.length === addresses.length && cur.every((a, i) => a === addresses[i]);
  if (!same) bot.updateSettings({ smartWallets: addresses });
}

/** Wallets in the bot settings (older saves, MCP, copilot) that the list does not have yet. */
function importFromSettings() {
  const s = useConvergenceStore.getState();
  const have = new Set(s.wallets.map((w) => w.address));
  const missing = (useBotStore.getState().settings.smartWallets || []).filter((a) => isSolanaAddress(a) && !have.has(a));
  if (!missing.length) return;
  const now = Date.now();
  const room = MAX_TRACKED_WALLETS - s.wallets.length;
  const add = missing.slice(0, Math.max(0, room)).map((address) => ({ address, source: 'Smart wallet list', addedAt: now, tier: 'B', active: true }) as TrackedWallet);
  if (!add.length) return;
  setWallets([...s.wallets, ...add]);
  add.forEach((w) => queueAnalysis(w.address));
}

const countingWallets = () => [...infoByAddress.values()].filter((i) => i.counts).map((i) => i.address);

/* ------------------------------------------------------------------ main loop */

function autoConvergenceOn(): boolean {
  const { settings } = useBotStore.getState();
  return settings.scannerAutoBuy && settings.entryStrategy !== 'setups';
}

function planPositions() {
  return useBotStore.getState().positions.filter((p) => p.exitPlan);
}

function shouldRun(): boolean {
  const s = useConvergenceStore.getState();
  const hasPlans = planPositions().length > 0;
  return ((s.monitorOn || autoConvergenceOn()) && countingWallets().length > 0) || hasPlans;
}

async function loop() {
  const s = useConvergenceStore.getState();
  if (shouldRun() && !WalletWatch.isRunning()) {
    WalletWatch.start({
      wallets: () => (useConvergenceStore.getState().monitorOn || autoConvergenceOn() ? countingWallets() : []),
      extraWallets: () =>
        planPositions()
          .flatMap((p) => [p.exitPlan!.devWallet || '', ...p.exitPlan!.triggerWallets])
          .filter(Boolean),
      rpcUrl: () => useBotStore.getState().settings.solanaRpcUrl,
      solPriceUsd: solPrice,
      pollSeconds: () => useConvergenceStore.getState().config.pollSeconds,
      replayMs: () => useConvergenceStore.getState().config.windowMinutes * 60_000,
      onSwap,
      onStatus: (monitor) => useConvergenceLive.setState({ monitor }),
    });
    useBotStore.getState().log('info', `[CONVERGENCE] Watching ${countingWallets().length} smart wallets for convergence.`);
  } else if (!shouldRun() && WalletWatch.isRunning()) {
    WalletWatch.stop();
    useBotStore.getState().log('info', '[CONVERGENCE] Wallet monitor stopped.');
  }

  const now = Date.now();
  // Keep trades of tokens still in play, drop the rest after the window.
  const keep = new Set<string>([
    ...planPositions().map((p) => p.mint || p.coin.mint || ''),
    ...s.journal.filter((j) => j.status === 'evaluating' || j.status === 'watch').map((j) => j.mint),
  ]);
  tracker.prune(Math.max(2, s.config.windowMinutes * 2) * 60_000, keep, now);
  useConvergenceLive.setState({ candidates: tracker.candidates(now).slice(0, 12) });

  // Watchlist re-checks and data retries.
  s.journal.forEach((sig) => {
    if (sig.status === 'watch') {
      const windowEnd = sig.createdAt + s.config.watchMinutes * 60_000;
      if (now > windowEnd) {
        // One last evaluation at the end of the window, then it expires.
        if ((sig.lastEvaluatedAt || 0) < windowEnd) enqueue(sig.id);
        else patchSignal(sig.id, { status: 'expired', reason: `Watchlist window (${s.config.watchMinutes} min) ended: ${sig.reason}` });
      } else if (!sig.lastEvaluatedAt || now - sig.lastEvaluatedAt >= s.config.recheckMinutes * 60_000) {
        enqueue(sig.id);
      }
    } else if (sig.status === 'evaluating' && (retryAt.get(sig.id) || Infinity) <= now) {
      retryAt.delete(sig.id);
      if (now - sig.createdAt > s.config.watchMinutes * 60_000) patchSignal(sig.id, { status: 'expired', reason: 'Not evaluated in time (tab closed or data missing)' });
      else enqueue(sig.id);
    }
  });

  // Per-signal scratch data is dropped once the signal is finished.
  const active = new Set(s.journal.filter((j) => j.status === 'evaluating' || j.status === 'watch').map((j) => j.id));
  [samples, lastAiAt, dataRetries, retryAt].forEach((m) => [...m.keys()].forEach((k) => !active.has(k) && m.delete(k)));

  linkResults();
  if (now - lastEmergencyPoll >= EMERGENCY_POLL_MS) {
    lastEmergencyPoll = now;
    void liquidityEmergencies();
  }
  if (now - lastCheckpointRun >= CHECKPOINT_MS) {
    lastCheckpointRun = now;
    void fillCheckpoints();
  }
}

/* ------------------------------------------------------------------ stage 1: swaps -> signals */

function onSwap(swap: WalletSwap) {
  tracker.ingest(swap);
  const s = useConvergenceStore.getState();
  const info = infoByAddress.get(swap.wallet);
  const dev = planPositions().some((p) => p.exitPlan!.devWallet === swap.wallet);
  useConvergenceLive.setState((l) => ({ feed: [{ swap, label: info?.label || short(swap.wallet), tier: info?.tier, dev }, ...l.feed].slice(0, MAX_FEED) }));
  // A wallet that trades is active: stamped at most hourly so the list is not rewritten per trade.
  const w = s.wallets.find((x) => x.address === swap.wallet);
  if (w && Date.now() - (w.lastSeenAt || 0) > 3_600_000) {
    useConvergenceStore.setState({ wallets: s.wallets.map((x) => (x.address === swap.wallet ? { ...x, lastSeenAt: swap.at } : x)) });
    rebuildInfo(useConvergenceStore.getState().wallets, s.config);
  }

  if (swap.side === 'sell') checkWalletEmergency(swap);
  if (swap.side !== 'buy' || !info?.counts) return;

  const trigger = tracker.trigger(swap.mint);
  if (!trigger) return;
  const recent = s.journal.find((j) => j.mint === swap.mint && (j.status === 'evaluating' || j.status === 'watch' || Date.now() - j.createdAt < SIGNAL_COOLDOWN_MS));
  if (recent) {
    // More wallets joined a token already in the pipeline: keep its trigger current.
    if (recent.status === 'evaluating' || recent.status === 'watch') patchSignal(recent.id, { trigger });
    return;
  }
  const held = useBotStore.getState().positions.some((p) => (p.mint || p.coin.mint) === swap.mint);
  if (held) return;
  openSignal(trigger);
}

function openSignal(trigger: ConvergenceTrigger) {
  const sig: ConvergenceSignal = {
    id: uid(),
    mint: trigger.mint,
    symbol: short(trigger.mint),
    name: '',
    createdAt: Date.now(),
    status: 'evaluating',
    stage: 'trigger',
    reason: `${trigger.points} points from ${trigger.wallets.filter((w) => w.points > 0).length} clusters in ${useConvergenceStore.getState().config.windowMinutes} min`,
    trigger,
    priceAtSignalUsd: 0,
    liquidityAtSignalUsd: 0,
    marketCapAtSignalUsd: 0,
    evaluations: 0,
    redFlags: [],
    checkpoints: {},
  };
  useConvergenceStore.setState((s) => ({ journal: [sig, ...s.journal].slice(0, MAX_JOURNAL) }));
  useBotStore.getState().log('info', `[CONVERGENCE] Signal ${short(trigger.mint)}: ${sig.reason} (${trigger.wallets.map((w) => `${w.label || short(w.address)} ${w.tier}`).join(', ')})`);
  enqueue(sig.id);
}

function enqueue(id: string) {
  if (queued.has(id)) return;
  queued.add(id);
  pipelineChain = pipelineChain
    .then(() => runPipeline(id))
    .catch((err) => {
      useBotStore.getState().log('warning', `[CONVERGENCE] Pipeline error: ${err?.message || err}`);
      // Picked up again (or expired) by the loop instead of sitting in 'evaluating' for good.
      const sig = getSignal(id);
      if (sig && (sig.status === 'evaluating' || sig.status === 'watch')) {
        patchSignal(id, { status: 'evaluating' });
        retryAt.set(id, Date.now() + 60_000);
      }
    })
    .finally(() => {
      queued.delete(id);
      setStep(id, null);
    });
}

/* ------------------------------------------------------------------ journal helpers */

function getSignal(id: string) {
  return useConvergenceStore.getState().journal.find((j) => j.id === id);
}

function patchSignal(id: string, patch: Partial<ConvergenceSignal>) {
  useConvergenceStore.setState((s) => ({ journal: s.journal.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));
}

function setStep(id: string, step: PipelineStep | null) {
  useConvergenceLive.setState((s) => {
    const next = { ...s.progress };
    if (step) next[id] = { step, startedAt: Date.now() };
    else delete next[id];
    return { progress: next };
  });
}

function stopAt(id: string, stage: SignalStage, reason: string, status: ConvergenceSignal['status'] = 'rejected') {
  patchSignal(id, { status, stage, reason });
  const sig = getSignal(id);
  useBotStore.getState().log('skip', `[CONVERGENCE] ${sig?.symbol || id} stopped at ${stage}: ${reason}`, { coinSymbol: sig?.symbol });
}

/* ------------------------------------------------------------------ stages 2-4 */

async function runPipeline(id: string) {
  let sig = getSignal(id);
  if (!sig || (sig.status !== 'evaluating' && sig.status !== 'watch')) return;
  const cfg = useConvergenceStore.getState().config;
  const trigger = tracker.trigger(sig.mint) || sig.trigger;

  setStep(id, 'trigger');
  const pair = await fetchBestPair(sig.mint);
  if (!pair) {
    const n = (dataRetries.get(id) || 0) + 1;
    dataRetries.set(id, n);
    if (n >= MAX_DATA_RETRIES) stopAt(id, 'trigger', 'No DexScreener pair after several tries - no market data to judge');
    else {
      retryAt.set(id, Date.now() + DATA_RETRY_MS);
      patchSignal(id, { reason: `Waiting for market data (try ${n}/${MAX_DATA_RETRIES})` });
    }
    return;
  }
  dataRetries.delete(id);
  const coin = mapPairToCoinData(pair);
  const priceUsd = Number(pair.priceUsd) || 0;
  const liquidityUsd = Number(pair.liquidity?.usd) || 0;
  if (!sig.priceAtSignalUsd) {
    patchSignal(id, {
      symbol: coin?.symbol || sig.symbol,
      name: coin?.name || '',
      imageUrl: coin?.imageUrl || undefined,
      priceAtSignalUsd: priceUsd,
      liquidityAtSignalUsd: liquidityUsd,
      marketCapAtSignalUsd: Number(pair.marketCap || pair.fdv) || 0,
      dexId: pair.dexId,
      pairAddress: pair.pairAddress,
    });
  }
  patchSignal(id, { trigger });
  sig = getSignal(id)!;

  // Stage 1 - too late?
  const late = lateCheck(trigger, priceUsd, cfg, tracker.soldSince(sig.mint, trigger.firstWallet, trigger.firstBuyAt));
  if (late) return stopAt(id, 'late', late);

  // Stage 2 - hard gate. The AI never sees a token that failed it.
  setStep(id, 'safety');
  const sp = solPrice();
  const buyUsd = Math.max(1, (tradingCapitalUsd() * cfg.positionPct) / 100);
  const safety = await safetyGate(sig.mint, pair, cfg, { buyLamports: sp > 0 ? (buyUsd / sp) * 1e9 : 50_000_000, solPriceUsd: sp });
  const smp = samples.get(id) || { holders: [], devPct: [] };
  if (safety.holders) smp.holders.push({ at: Date.now(), holders: safety.holders });
  if (safety.devPct !== undefined) smp.devPct.push(safety.devPct);
  samples.set(id, smp);
  patchSignal(id, { safety });
  if (!safety.passed) return stopAt(id, 'safety', safety.failure || 'Failed the hard gate');

  // Stage 3 - momentum.
  setStep(id, 'momentum');
  const momentum = await momentumScore(
    sig.mint,
    {
      holderSamples: smp.holders,
      smartAdding: tracker.addedAgain(sig.mint, trigger),
      socials: socialsOf(pair),
      narrativeText: `${coin?.name || ''} ${coin?.symbol || ''} ${pair.info?.description || coin?.description || ''}`,
      narratives: cfg.narratives,
    },
    cfg
  );
  const evaluations = sig.evaluations + 1;
  // GeckoTerminal rate-limited: scoring without its data would throw a good token away.
  if (!momentum.poolAddress && evaluations < 3) {
    patchSignal(id, { evaluations, lastEvaluatedAt: Date.now(), reason: 'Momentum data rate-limited - retrying in a minute' });
    retryAt.set(id, Date.now() + 60_000);
    if (sig.status === 'watch') patchSignal(id, { status: 'evaluating' });
    return;
  }
  patchSignal(id, { momentum, evaluations, lastEvaluatedAt: Date.now() });

  if (momentum.score < cfg.watchScore) return stopAt(id, 'momentum', `Momentum ${momentum.score}/100 is under ${cfg.watchScore}`);
  if (momentum.score < cfg.aiScore) {
    patchSignal(id, { status: 'watch', stage: 'momentum', reason: `Momentum ${momentum.score}/100 - watchlist, re-checked every ${cfg.recheckMinutes} min for ${cfg.watchMinutes} min` });
    return;
  }

  // Stage 4a - critical red flags found by code are an automatic SKIP.
  const redFlags = criticalRedFlags(getSignal(id)!, trigger, pair);
  patchSignal(id, { redFlags });
  if (redFlags.length) return stopAt(id, 'ai', `Critical red flag: ${redFlags.join('; ')}`);

  // Stage 4b - Claude, unless asked recently about this watched token.
  setStep(id, 'ai');
  const prevAi = getSignal(id)!.ai;
  let ai: ConvergenceAiVerdict;
  if (prevAi && prevAi.available && Date.now() - (lastAiAt.get(id) || 0) < AI_RECHECK_MS) {
    ai = prevAi;
  } else {
    ai = await AIService.reviewConvergence(aiPackage(getSignal(id)!, trigger, pair), useBotStore.getState().settings.aiModel);
    lastAiAt.set(id, Date.now());
    patchSignal(id, { ai });
    if (ai.available) {
      useBotStore.getState().log('ai', `[AI ${ai.model || 'claude'}] ${getSignal(id)!.symbol}: ${ai.verdict} (${ai.confidence}%) - ${ai.alasan.join('; ') || ai.red_flags.join('; ')}`, {
        coinSymbol: getSignal(id)!.symbol,
      });
      useBotStore.setState({
        lastAiDecision: {
          action: ai.verdict === 'ENTRY' ? 'buy' : 'skip',
          confidence: ai.confidence,
          reason: ai.alasan.join('; ') || ai.red_flags.join('; '),
          source: 'ai',
          model: ai.model,
          symbol: getSignal(id)!.symbol,
          at: Date.now(),
        },
      });
    }
  }

  if (!ai.available) {
    const note = ai.note || 'Claude did not answer';
    const noKey = note === 'not-configured';
    const permanent = note.startsWith('permanent');
    if (cfg.requireAi || (!noKey && !permanent)) {
      if (noKey || permanent) return stopAt(id, 'ai', noKey ? 'No ANTHROPIC_API_KEY on the server - the AI gate is required' : note.replace(/^permanent: /, ''));
      patchSignal(id, { status: 'watch', stage: 'ai', reason: `AI unavailable (${note}) - asked again at the next re-check` });
      lastAiAt.delete(id);
      return;
    }
    if (momentum.score < cfg.noAiMinScore) {
      patchSignal(id, { status: 'watch', stage: 'ai', reason: `No AI: momentum ${momentum.score} needs ${cfg.noAiMinScore} to trade without Claude` });
      return;
    }
    return execute(id, pair, null);
  }

  if (ai.verdict === 'ENTRY' && ai.confidence >= cfg.aiMinConfidence) return execute(id, pair, ai);
  if (ai.verdict === 'SKIP') return stopAt(id, 'ai', `AI SKIP (${ai.confidence}%): ${ai.alasan.join('; ') || ai.red_flags.join('; ') || 'no reason given'}`);
  patchSignal(id, {
    status: 'watch',
    stage: 'ai',
    reason:
      ai.verdict === 'ENTRY'
        ? `AI ENTRY at ${ai.confidence}% is under ${cfg.aiMinConfidence}% - watching`
        : `AI WATCH (${ai.confidence}%): ${ai.syarat_naik_ke_entry || ai.alasan.join('; ')}`,
  });
}

/** Rule 3 of the AI prompt, checked by code first so a red flag never depends on the model. */
function criticalRedFlags(sig: ConvergenceSignal, trigger: ConvergenceTrigger, pair: any): string[] {
  const flags: string[] = [];
  const smp = samples.get(sig.id);
  if (smp && smp.devPct.length >= 2) {
    const first = smp.devPct[0];
    const now = smp.devPct[smp.devPct.length - 1];
    if (first >= 0.5 && now < first * 0.5) flags.push(`dev is selling (holding fell from ${first.toFixed(1)}% to ${now.toFixed(1)}%)`);
  }
  const liqNow = Number(pair?.liquidity?.usd) || 0;
  if (pair?.dexId !== 'pumpfun' && sig.liquidityAtSignalUsd > 0 && liqNow > 0 && liqNow < sig.liquidityAtSignalUsd * 0.85) {
    flags.push(`liquidity fell ${Math.round((1 - liqNow / sig.liquidityAtSignalUsd) * 100)}% since the signal`);
  }
  if (sig.momentum?.washTrading) flags.push('unique holders stagnant while volume rises (wash trading)');
  const sellers = trigger.wallets.filter((w) => tracker.soldSince(sig.mint, w.address, w.at));
  if (sellers.length) flags.push(`trigger wallet sold part of its position (${sellers.map((w) => w.label || short(w.address)).join(', ')})`);
  return flags;
}

/** The JSON package Claude reads: stage 1-3 data and nothing it would have to guess. */
function aiPackage(sig: ConvergenceSignal, trigger: ConvergenceTrigger, pair: any): Record<string, unknown> {
  const cfg = useConvergenceStore.getState().config;
  const now = Date.now();
  const priceUsd = Number(pair.priceUsd) || 0;
  const created = pair.pairCreatedAt ? Math.round((now - pair.pairCreatedAt) / 60_000) : null;
  return {
    token: {
      mint: sig.mint,
      symbol: sig.symbol,
      nama: sig.name,
      dex: pair.dexId,
      masih_di_bonding_curve: sig.safety?.onCurve ?? null,
      progres_curve_persen: sig.safety?.curvePercent !== undefined ? Math.round(sig.safety.curvePercent) : null,
      umur_pair_menit: created,
      harga_usd: priceUsd,
      market_cap_usd: Math.round(Number(pair.marketCap || pair.fdv) || 0),
      likuiditas_usd: Math.round(Number(pair.liquidity?.usd) || 0),
      likuiditas_saat_sinyal_usd: Math.round(sig.liquidityAtSignalUsd),
      perubahan_harga_5m_persen: pair.priceChange?.m5 ?? null,
      perubahan_harga_1j_persen: pair.priceChange?.h1 ?? null,
    },
    tahap_1_konvergensi: {
      poin: trigger.points,
      ambang_poin: cfg.triggerPoints,
      jendela_menit: cfg.windowMinutes,
      cluster_berbeda: new Set(trigger.wallets.filter((w) => w.points > 0).map((w) => w.cluster)).size,
      wallet_pemicu: trigger.wallets.map((w) => ({
        wallet: w.label || short(w.address),
        tier: w.tier,
        cluster: w.cluster === w.address ? 'sendiri' : w.cluster.replace(/^funder:/, 'funder ').slice(0, 18),
        poin: w.points,
        beli_sol: Math.round(w.solAmount * 100) / 100,
        harga_beli_usd: w.priceUsd,
        menit_lalu: Math.round((now - w.at) / 60_000),
        sudah_menjual: tracker.soldSince(sig.mint, w.address, w.at),
      })),
      harga_vs_beli_wallet_pertama: trigger.firstBuyPriceUsd > 0 ? Math.round((priceUsd / trigger.firstBuyPriceUsd) * 100) / 100 : null,
      wallet_pemicu_menambah_posisi: tracker.addedAgain(sig.mint, trigger),
    },
    tahap_2_keamanan: {
      lolos: sig.safety?.passed,
      cek: (sig.safety?.checks || []).map((c) => ({ cek: c.label, hasil: c.state, nilai: c.value })),
      holder: sig.safety?.holders ?? null,
    },
    tahap_3_momentum: {
      skor: sig.momentum?.score,
      metrik: (sig.momentum?.metrics || []).map((m) => ({ metrik: m.label, poin: m.points, bobot: m.weight, nilai: m.value })),
      wash_trading: sig.momentum?.washTrading,
      volume_15m_usd: sig.momentum?.volume15mUsd,
      pembeli_unik_15m: sig.momentum?.buyers15m,
      penjual_unik_15m: sig.momentum?.sellers15m,
      pembeli_baru_15m: sig.momentum?.newBuyers15m,
      porsi_volume_top5_wallet: sig.momentum?.top5VolumeShare,
      evaluasi_ke: sig.evaluations,
    },
    sosial_dan_narasi: {
      link: socialsOf(pair),
      narasi_minggu_ini: cfg.narratives,
    },
    red_flag_terdeteksi_sistem: sig.redFlags,
    data_tidak_tersedia: [...(sig.momentum?.dataMissing || []), ...(sig.safety?.checks || []).filter((c) => c.state === 'unknown').map((c) => c.label)],
  };
}

/* ------------------------------------------------------------------ stage 5: execution */

/** Paper: cash plus open paper positions at cost. Live: the signing wallet in USD plus open live positions at cost. */
export function tradingCapitalUsd(): number {
  const bot = useBotStore.getState();
  const { settings } = bot;
  if (settings.paperTrading) return bot.walletBalance + bot.positions.filter((p) => !p.isLive).reduce((a, p) => a + p.amountUsd, 0);
  // Only the wallet that signs: sizes stay equal whether or not another wallet is connected.
  const sp = solPrice();
  const signerSol = (settings.liveSigner === 'bot' ? bot.botWallet.solBalance : settings.solBalance) ?? 0;
  return signerSol * sp + bot.positions.filter((p) => p.isLive).reduce((a, p) => a + p.amountUsd, 0);
}

async function execute(id: string, pair: any, ai: ConvergenceAiVerdict | null) {
  setStep(id, 'execution');
  const sig = getSignal(id)!;
  const cfg = useConvergenceStore.getState().config;
  const bot = useBotStore.getState();
  const { settings } = bot;

  if (!settings.scannerAutoBuy || settings.entryStrategy === 'setups') {
    return stopAt(id, 'risk', 'Passed all four gates - not bought: auto trade is off (observe only)');
  }
  if (bot.positions.length >= settings.maxPositions) return stopAt(id, 'risk', `${settings.maxPositions} positions already open`);
  const capital = tradingCapitalUsd();
  const today = bot.getTodayRealizedPnl();
  if (isDailyLossReached() || (cfg.dailyLossPct > 0 && capital > 0 && today <= -(capital * cfg.dailyLossPct) / 100)) {
    return stopAt(id, 'risk', `Daily loss limit reached (${today.toFixed(2)} USD today) - no new entries until tomorrow`);
  }
  if (bot.positions.some((p) => (p.mint || p.coin.mint) === sig.mint)) return stopAt(id, 'risk', 'Already holding it - never average down');
  if (bot.pendingTradeIds.some((x) => x.includes(sig.mint))) return stopAt(id, 'risk', 'An order for it is already in flight');

  const amountUsd = Math.round(((capital * cfg.positionPct) / 100) * 100) / 100;
  if (!(amountUsd >= 1)) return stopAt(id, 'risk', `Position size $${amountUsd.toFixed(2)} (${cfg.positionPct}% of $${capital.toFixed(2)}) is too small`);
  const sp = solPrice();
  if (!settings.paperTrading) {
    const signerSol = (settings.liveSigner === 'bot' ? bot.botWallet.solBalance : settings.solBalance) ?? 0;
    const signerReady = settings.liveSigner === 'bot' ? !!HotWallet.unlockedAddress() : settings.phantomWalletConnected;
    if (!signerReady) return stopAt(id, 'risk', settings.liveSigner === 'bot' ? 'Bot wallet is locked' : 'No wallet connected');
    if (sp > 0 && signerSol < amountUsd / sp + ENTRY_RESERVE_SOL) return stopAt(id, 'risk', `Wallet holds ${signerSol.toFixed(4)} SOL - not enough for $${amountUsd} plus fees`);
  } else if (bot.walletBalance < amountUsd) {
    return stopAt(id, 'risk', `Paper balance $${bot.walletBalance.toFixed(2)} is under $${amountUsd}`);
  }

  // Do not chase: the price may not have run more than maxChaseUpPct since the signal.
  const ref = sig.priceAtSignalUsd;
  const now = (await fetchPrices([sig.mint])).get(sig.mint);
  const priceNow = now?.priceUsd || Number(pair.priceUsd) || 0;
  if (ref > 0 && priceNow > ref * (1 + cfg.maxChaseUpPct / 100)) {
    return stopAt(id, 'execution', `Price ran +${Math.round((priceNow / ref - 1) * 100)}% since the signal - not chasing (limit +${cfg.maxChaseUpPct}%)`, 'failed');
  }
  const impact = sp > 0 ? await entryImpactPct(sig.mint, (amountUsd / sp) * 1e9, cfg.maxSlippagePct) : null;
  if (impact === null) return stopAt(id, 'execution', 'No Jupiter route for the entry', 'failed');
  if (impact > cfg.maxPriceImpactPct) return stopAt(id, 'execution', `Price impact ${impact.toFixed(1)}% is over ${cfg.maxPriceImpactPct}%`, 'failed');

  const coin = { ...mapPairToCoinData(pair), priceUsd: priceNow };
  const decision: AiDecision | undefined = ai
    ? { action: 'buy', confidence: ai.confidence, reason: ai.alasan.join('; '), riskLevel: 'High', source: 'ai', model: ai.model }
    : { action: 'buy', confidence: sig.momentum?.score ?? 0, reason: 'Momentum only (AI not required and unavailable)', source: 'heuristic' };
  const exitPlan = {
    ...buildExitPlan(cfg, {
      signalId: id,
      triggerWallets: sig.trigger.wallets.map((w) => w.address),
      devWallet: sig.safety?.creator,
      entryLiquidityUsd: Number(pair.liquidity?.usd) || undefined,
      entryDexId: pair.dexId,
    }),
    walletPeaks: Object.fromEntries(sig.trigger.wallets.map((w) => [w.address, tracker.peakHolding(w.address, sig.mint)])),
  };
  // The awaits above take seconds: another flow may have bought it meanwhile.
  const fresh = useBotStore.getState();
  if (fresh.positions.some((p) => (p.mint || p.coin.mint) === sig.mint) || fresh.pendingTradeIds.some((x) => x.includes(sig.mint))) {
    return stopAt(id, 'risk', 'Bought or being bought by another flow meanwhile - never average down');
  }
  if (fresh.positions.length >= fresh.settings.maxPositions) return stopAt(id, 'risk', `${fresh.settings.maxPositions} positions already open`);
  const r = await bot.manualSnipeCoin(coin, amountUsd, `convergence ${sig.trigger.points}pt, momentum ${sig.momentum?.score ?? '-'}${ai ? `, AI ${ai.confidence}%` : ''}`, {
    tp: (cfg.tp1Multiple - 1) * 100,
    sl: cfg.stopLossPct,
    exitPlan,
    signalId: id,
    maxSlippagePercent: cfg.maxSlippagePct,
    decision,
  });
  if (!r.success || !r.positionId) return stopAt(id, 'execution', r.message, 'failed');
  const pos = useBotStore.getState().positions.find((p) => p.id === r.positionId);
  patchSignal(id, {
    status: 'entered',
    stage: 'execution',
    reason: r.message,
    entry: { positionId: r.positionId, at: Date.now(), priceUsd: pos?.buyPriceUsd || priceNow, amountUsd: pos?.amountUsd || amountUsd, isLive: !!pos?.isLive },
  });
}

/* ------------------------------------------------------------------ stage 6: emergency exits */

function checkWalletEmergency(swap: WalletSwap) {
  const bot = useBotStore.getState();
  bot.positions
    .filter((p) => p.exitPlan && (p.mint || p.coin.mint) === swap.mint)
    .forEach((p) => {
      const plan = p.exitPlan!;
      if (plan.devWallet && swap.wallet === plan.devWallet) {
        void bot.emergencyExit(p.id, `the dev wallet ${short(swap.wallet)} is selling`);
        return;
      }
      if (!plan.triggerWallets.includes(swap.wallet) || plan.exitedWallets.includes(swap.wallet)) return;
      // Measured against the holding recorded at entry, which survives a reload of the tab.
      const peak = plan.walletPeaks?.[swap.wallet] || 0;
      const sold = peak > 0 && Number.isFinite(swap.postBalance) ? Math.max(0, Math.min(1, 1 - swap.postBalance / peak)) : tracker.soldFraction(swap.wallet, swap.mint);
      if (sold <= plan.emergencySellFraction) return;
      const exited = [...plan.exitedWallets, swap.wallet];
      bot.patchExitPlan(p.id, { exitedWallets: exited });
      bot.log('warning', `[EXIT PLAN] ${p.coin.symbol}: trigger wallet ${short(swap.wallet)} sold ${Math.round(sold * 100)}% (${exited.length}/${plan.emergencyTriggerSellers})`, { coinSymbol: p.coin.symbol });
      if (exited.length >= plan.emergencyTriggerSellers) void bot.emergencyExit(p.id, `${exited.length} trigger wallets sold more than ${Math.round(plan.emergencySellFraction * 100)}% of their position`);
    });
}

async function liquidityEmergencies() {
  const positions = planPositions().filter((p) => p.exitPlan!.entryLiquidityUsd);
  if (!positions.length) return;
  const prices = await fetchPrices(positions.map((p) => p.mint || p.coin.mint || '').filter(Boolean));
  const bot = useBotStore.getState();
  positions.forEach((p) => {
    const plan = p.exitPlan!;
    const now = prices.get(p.mint || p.coin.mint || '');
    // No answer for this token is not a rug (the API may have failed): wait for the next poll.
    if (!now) return;
    // A migration (curve -> AMM) moves the token to a new pool: measure from the new pool on.
    if (now.dexId !== plan.entryDexId) {
      if (now.liquidityUsd > 0) bot.patchExitPlan(p.id, { entryDexId: now.dexId, entryLiquidityUsd: now.liquidityUsd });
      return;
    }
    const floor = plan.entryLiquidityUsd! * (1 - plan.emergencyLiquidityDropPct / 100);
    if (now.liquidityUsd < floor) {
      void bot.emergencyExit(p.id, `liquidity fell from $${Math.round(plan.entryLiquidityUsd!)} to $${Math.round(now.liquidityUsd)} (more than ${plan.emergencyLiquidityDropPct}%)`);
    }
  });
}

/* ------------------------------------------------------------------ stage 7: journal */

/** Sums the closed trades of every entered signal whose position is fully closed. */
function linkResults() {
  const bot = useBotStore.getState();
  const s = useConvergenceStore.getState();
  const open = new Set(bot.positions.map((p) => p.signalId).filter(Boolean));
  const pending = s.journal.filter((j) => j.status === 'entered' && !j.result && !open.has(j.id));
  if (!pending.length) return;
  pending.forEach((j) => {
    const trades = bot.history.filter((h) => h.signalId === j.id);
    if (!trades.length) return;
    const pnlUsd = trades.reduce((a, t) => a + t.pnlUsd, 0);
    const cost = trades.reduce((a, t) => a + t.amountUsd, 0);
    patchSignal(j.id, {
      result: {
        pnlUsd: Math.round(pnlUsd * 100) / 100,
        pnlPercent: cost > 0 ? Math.round((pnlUsd / cost) * 1000) / 10 : 0,
        exitReasons: trades.map((t) => t.exitReason),
        closedAt: Math.max(...trades.map((t) => t.soldAt)),
      },
    });
  });
}

/** Fills +5m / +1h / +6h / +24h prices: live while due, backfilled from candles when the tab was closed. */
async function fillCheckpoints() {
  const now = Date.now();
  const journal = useConvergenceStore.getState().journal.filter((j) => now - j.createdAt < 30 * 3_600_000 && j.priceAtSignalUsd > 0);
  const live = new Map<string, { id: string; key: CheckpointKey }[]>();
  const backfill: { sig: ConvergenceSignal; key: CheckpointKey; at: number }[] = [];
  journal.forEach((sig) => {
    CHECKPOINTS.forEach(({ key, offsetMs, liveForMs }) => {
      if (sig.checkpoints[key] !== undefined) return;
      const due = sig.createdAt + offsetMs;
      if (due > now) return;
      if (now - due <= liveForMs) live.set(sig.mint, [...(live.get(sig.mint) || []), { id: sig.id, key }]);
      else backfill.push({ sig, key, at: due });
    });
  });
  if (live.size) {
    const prices = await fetchPrices([...live.keys()]);
    live.forEach((items, mint) => {
      const p = prices.get(mint)?.priceUsd;
      if (!p) return;
      items.forEach(({ id, key }) => {
        const sig = getSignal(id);
        if (sig) patchSignal(id, { checkpoints: { ...sig.checkpoints, [key]: p } });
      });
    });
  }
  // One candle request per minute at most: GeckoTerminal's budget is shared with the scanner.
  const next = backfill[0];
  if (next && now - lastBackfillAt >= 60_000) {
    lastBackfillAt = now;
    const pool = next.sig.momentum?.poolAddress || next.sig.pairAddress;
    const tries = (next.sig.checkpointTries?.[next.key] || 0) + 1;
    const price = pool ? await priceAt(pool, next.sig.mint, next.at) : null;
    const sig = getSignal(next.sig.id);
    if (!sig) return;
    if (price !== null || tries >= 3 || !pool) {
      patchSignal(sig.id, { checkpoints: { ...sig.checkpoints, [next.key]: price } });
    } else {
      patchSignal(sig.id, { checkpointTries: { ...(sig.checkpointTries || {}), [next.key]: tries } });
    }
  }
}
