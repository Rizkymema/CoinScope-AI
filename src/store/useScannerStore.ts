import { create } from 'zustand';
import { MIN_ENTRY_SCORE, ScannerService, ScanSignal } from '../services/scanner.service';
import { AudioService } from '../services/audio.service';
import { SolPriceService } from '../services/solprice.service';
import { useBotStore } from './useBotStore';

/**
 * Runs the setup scanner every minute while the app is open, on any tab, and alerts once per
 * newly ready signal. Only the on/off and alert preferences persist (localStorage).
 */

const SCAN_INTERVAL_MS = 60_000;
const PREFS_KEY = 'coinscope:scanner';
/** The micro-account rule from the skill: a wider stop does not fit a $3-5 position. */
const MAX_STOP_PERCENT = 12;

interface ScannerState {
  enabled: boolean;
  alerts: boolean;
  scanning: boolean;
  signals: ScanSignal[];
  candidateCount: number;
  lastScanAt: number | null;
  error: string | null;
  /** Mints that were ready on the last scan, so an alert fires once per new signal. */
  readyIds: string[];

  init: () => void;
  setEnabled: (on: boolean) => void;
  setAlerts: (on: boolean) => Promise<void>;
  scanNow: () => Promise<void>;
}

function readPrefs(): { enabled: boolean; alerts: boolean } {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const p = raw ? JSON.parse(raw) : {};
    return { enabled: p.enabled !== false, alerts: !!p.alerts };
  } catch {
    return { enabled: true, alerts: false };
  }
}

function writePrefs(prefs: { enabled: boolean; alerts: boolean }) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // private mode / blocked storage: preferences just do not survive a reload
  }
}

function notify(signal: ScanSignal) {
  const sym = signal.coin.symbol;
  const body = `${signal.reason}. Entry ${signal.entryLow?.toPrecision(4)}-${signal.entryHigh?.toPrecision(4)}, SL -${signal.slPercent?.toFixed(0)}%, TP +${signal.tpPercent?.toFixed(0)}%`;
  AudioService.playSignalSound();
  try {
    navigator.vibrate?.([120, 80, 120]);
  } catch {
    // no vibration support
  }
  try {
    // Android Chrome only allows notifications from a service worker and throws here; sound,
    // vibration and the in-app toast still fire.
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(`Setup ready: ${sym}`, { body, tag: signal.id });
  } catch {
    // ignore
  }
  useBotStore.setState({ latestToastNotification: { title: `Setup ready: ${sym}`, description: body, type: 'info', coinSymbol: sym } });
}

/* ------------------------------------------------------------------ auto-buy */

const AUTO_BUY_COOLDOWN_MS = 60 * 60_000;
/** Live auto-buys never spend more than this share of the signing wallet's SOL (micro-account rule). */
const AUTO_BUY_MAX_WALLET_SHARE = 0.35;
const autoBuyAt = new Map<string, number>();
const round1 = (v?: number) => Math.round((v ?? 0) * 10) / 10;

/**
 * At most one entry per scan, and only while every guard holds: the setting is on, there is room
 * under maxPositions, the daily loss limit is not hit, the signal is Ready with a passing sell-back
 * quote and reward over risk after fees, the token is not already held or pending, it was not
 * bought in the last hour, and (live) the buy is a small share of the signing wallet.
 */
async function autoBuy(ready: ScanSignal[]) {
  const bot = useBotStore.getState();
  const { settings } = bot;
  if (!settings.scannerAutoBuy) return;
  if (bot.positions.length >= settings.maxPositions) return;
  if (settings.dailyLossLimitUsd > 0 && bot.getTodayRealizedPnl() <= -settings.dailyLossLimitUsd) return;

  const held = new Set(bot.positions.map((p) => p.mint || p.coin.mint || p.coin.id));
  const candidate = [...ready]
    .sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0))
    .find(
      (s) =>
        s.swap?.sellable === true &&
        (s.netRewardRisk ?? 0) >= 1 &&
        !held.has(s.id) &&
        !bot.pendingTradeIds.includes(s.coin.id) &&
        Date.now() - (autoBuyAt.get(s.id) || 0) > AUTO_BUY_COOLDOWN_MS
    );
  if (!candidate) return;

  // Checked only once a signal would actually be bought, so an underfunded wallet is logged per
  // missed signal (at most hourly per token) instead of every scan.
  if (!settings.paperTrading) {
    const solBalance = settings.liveSigner === 'bot' ? bot.botWallet.solBalance : settings.solBalance;
    const walletUsd = (solBalance ?? 0) * (bot.solPriceUsd || SolPriceService.getCached());
    if (settings.buyAmountUsd > walletUsd * AUTO_BUY_MAX_WALLET_SHARE) {
      autoBuyAt.set(candidate.id, Date.now());
      bot.log(
        'warning',
        `[AUTO-BUY] Skipped ${candidate.coin.symbol}: $${settings.buyAmountUsd} is over ${Math.round(AUTO_BUY_MAX_WALLET_SHARE * 100)}% of the signing wallet ($${walletUsd.toFixed(2)}). Fund the bot wallet or lower the buy size.`,
        { coinSymbol: candidate.coin.symbol }
      );
      return;
    }
  }

  autoBuyAt.set(candidate.id, Date.now());
  const r = await bot.manualSnipeCoin(candidate.coin, settings.buyAmountUsd, `scanner auto-buy ${candidate.setup} ${candidate.score?.total}`, {
    tp: round1(candidate.tpPercent),
    sl: round1(candidate.slPercent),
  });
  bot.log(r.success ? 'buy' : 'warning', `[AUTO-BUY] ${candidate.coin.symbol}: ${r.message}`, { coinSymbol: candidate.coin.symbol });
  if (!r.success) {
    useBotStore.setState({ latestToastNotification: { title: `Auto-buy failed: ${candidate.coin.symbol}`, description: r.message, type: 'error', coinSymbol: candidate.coin.symbol } });
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

export const useScannerStore = create<ScannerState>()((set, get) => {
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = get().enabled ? setTimeout(() => void get().scanNow(), SCAN_INTERVAL_MS) : null;
  };

  return {
    enabled: false,
    alerts: false,
    scanning: false,
    signals: [],
    candidateCount: 0,
    lastScanAt: null,
    error: null,
    readyIds: [],

    init: () => {
      if (initialized || typeof window === 'undefined') return;
      initialized = true;
      const prefs = readPrefs();
      set(prefs);
      if (prefs.enabled) void get().scanNow();
    },

    setEnabled: (on) => {
      set({ enabled: on });
      writePrefs({ enabled: on, alerts: get().alerts });
      if (on) void get().scanNow();
      else schedule();
    },

    setAlerts: async (on) => {
      if (on && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        try {
          await Notification.requestPermission();
        } catch {
          // permission prompt unavailable; sound and toast alerts still work
        }
      }
      set({ alerts: on });
      writePrefs({ enabled: get().enabled, alerts: on });
      if (on) AudioService.playSignalSound(); // also unlocks audio after the user gesture
    },

    scanNow: async () => {
      if (get().scanning) return;
      set({ scanning: true, error: null });
      try {
        const bot = useBotStore.getState();
        const { settings } = bot;
        const result = await ScannerService.scan({
          buyAmountUsd: settings.buyAmountUsd,
          solPriceUsd: bot.solPriceUsd || SolPriceService.getCached(),
          priorityFeeSol: settings.priorityFeeSol,
          takeProfitPercent: Math.min(50, Math.max(10, settings.takeProfitPercent)),
          maxStopPercent: MAX_STOP_PERCENT,
          priorityMints: get().signals.filter((s) => s.status !== 'rejected').map((s) => s.id),
        });

        const ready = result.signals.filter((s) => s.status === 'ready' && (s.score?.total ?? 0) >= MIN_ENTRY_SCORE);
        const previous = new Set(get().readyIds);
        if (get().alerts) ready.filter((s) => !previous.has(s.id)).forEach(notify);
        await autoBuy(ready);

        set({
          signals: result.signals,
          candidateCount: result.candidateCount,
          lastScanAt: result.scannedAt,
          readyIds: ready.map((s) => s.id),
          error: result.candidateCount === 0 ? 'No market data came back - the data APIs may be rate-limiting. Retrying next minute.' : null,
        });
      } catch (err) {
        set({ error: err instanceof Error ? err.message : 'Scan failed' });
      } finally {
        set({ scanning: false });
        schedule();
      }
    },
  };
});
