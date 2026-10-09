import { create } from 'zustand';
import { minEntryScore, ScannerService, ScanSignal } from '../services/scanner.service';
import { AudioService } from '../services/audio.service';
import { SolPriceService } from '../services/solprice.service';
import { AIService, SignalForGate } from '../services/ai.service';
import { useBotStore } from './useBotStore';
import { ScannerSignalBrief, setScannerSummary } from '../lib/scanner-status';

/**
 * Runs the setup scanner every minute while the app is open, on any tab, and alerts once per
 * newly ready signal. Only the on/off and alert preferences persist (localStorage).
 */

const SCAN_INTERVAL_MS = 60_000;
/** A scan this overdue means the timer died (throttled tab, failed promise): the watchdog restarts it. */
const STALE_SCAN_MS = 3 * SCAN_INTERVAL_MS;
const WATCHDOG_MS = 30_000;
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
  /** When auto trade was switched on in this tab (uptime display); null while off. */
  autoSince: number | null;

  init: () => void;
  setEnabled: (on: boolean) => void;
  setAlerts: (on: boolean) => Promise<void>;
  scanNow: () => Promise<void>;
  /** Scanner on + auto-buy on: the one switch the Auto Trade page exposes. */
  startAutoTrade: () => void;
  stopAutoTrade: () => void;
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
/**
 * Live auto-buys never put more than this share of the trading capital into one token (the
 * skill's micro-account rule: at most a third of the balance). Capital is the signing wallet plus,
 * for the bot wallet, the connected wallet that funds it.
 */
const AUTO_BUY_MAX_CAPITAL_SHARE = 0.35;
/** SOL the signing wallet must keep beyond the buy itself: token-account rent plus buy and sell fees. */
const ENTRY_RESERVE_SOL = 0.005;
const autoBuyAt = new Map<string, number>();
const round1 = (v?: number) => Math.round((v ?? 0) * 10) / 10;

/** Half size is only worth it when the smaller order still clears Solana's fixed costs comfortably. */
const MIN_HALF_SIZE_USD = 10;

function toGateSignal(s: ScanSignal): SignalForGate {
  return {
    symbol: s.coin.symbol,
    name: s.coin.name,
    mint: s.id,
    setup: s.setup,
    reason: s.reason,
    priceUsd: s.priceUsd,
    liquidityUsd: Math.round(s.liquidityUsd),
    marketCapUsd: Math.round(s.marketCapUsd),
    ageHours: Math.round(s.ageHours * 10) / 10,
    volume1hUsd: Math.round(s.volume1hUsd),
    buys1h: s.buys1h,
    sells1h: s.sells1h,
    rsi: s.rsi !== undefined ? Math.round(s.rsi) : undefined,
    entryLow: s.entryLow,
    entryHigh: s.entryHigh,
    stopPrice: s.stopPrice,
    targetPrice: s.targetPrice,
    slPercent: round1(s.slPercent),
    tpPercent: round1(s.tpPercent),
    invalidation: s.invalidation,
    costPercent: s.costPercent !== undefined ? round1(s.costPercent) : undefined,
    netRewardRisk: s.netRewardRisk !== undefined ? round1(s.netRewardRisk) : undefined,
    smartWallets: s.smartWallets,
    gates: s.gates ? { top10Pct: round1(s.gates.top10Pct), maxHolderPct: round1(s.gates.maxHolderPct), insiderPct: round1(s.gates.insiderPct), devPct: round1(s.gates.devPct), holders: s.gates.holders } : undefined,
    score: s.score,
    sellBack: s.swap ? (s.swap.sellable ? { sellable: true, roundTripPct: round1(s.swap.roundTripPct) } : { sellable: false }) : undefined,
  };
}

/**
 * At most one entry per scan, and only while every guard holds: the setting is on, there is room
 * under maxPositions, the daily loss limit is not hit, the signal is Ready with a passing sell-back
 * quote and reward over risk after fees, the token is not already held or pending, it was not
 * bought in the last hour, and (live) the buy is a small share of the trading capital that the
 * signing wallet can actually pay for, rent and fees included.
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
    const solPrice = bot.solPriceUsd || SolPriceService.getCached();
    const signerSol = (settings.liveSigner === 'bot' ? bot.botWallet.solBalance : settings.solBalance) ?? 0;
    const funderSol = settings.liveSigner === 'bot' && settings.phantomWalletConnected ? settings.solBalance || 0 : 0;
    const capitalUsd = (signerSol + funderSol) * solPrice;
    const buySol = solPrice > 0 ? settings.buyAmountUsd / solPrice : Infinity;
    const skip = (why: string) => {
      autoBuyAt.set(candidate.id, Date.now());
      bot.log('warning', `[AUTO-BUY] Skipped ${candidate.coin.symbol}: ${why}`, { coinSymbol: candidate.coin.symbol });
    };
    if (settings.buyAmountUsd > capitalUsd * AUTO_BUY_MAX_CAPITAL_SHARE) {
      skip(`$${settings.buyAmountUsd} is over ${Math.round(AUTO_BUY_MAX_CAPITAL_SHARE * 100)}% of the trading capital ($${capitalUsd.toFixed(2)}). Lower the buy size.`);
      return;
    }
    if (signerSol < buySol + ENTRY_RESERVE_SOL) {
      skip(
        `the ${settings.liveSigner === 'bot' ? 'bot wallet' : 'wallet'} holds ${signerSol.toFixed(4)} SOL but this entry needs ~${(buySol + ENTRY_RESERVE_SOL).toFixed(4)} SOL with rent and fees. Fund it or lower the buy size.`
      );
      return;
    }
  }

  let amountUsd = settings.buyAmountUsd;
  let tp = round1(candidate.tpPercent);
  let sl = round1(candidate.slPercent);
  let reason = `scanner auto-buy ${candidate.setup} ${candidate.score?.total}`;

  // Final review by Claude. The scanner's stop is the widest allowed; the model may only tighten it.
  if (settings.aiGateEnabled) {
    const solPrice = bot.solPriceUsd || SolPriceService.getCached();
    const capitalUsd = settings.paperTrading
      ? bot.walletBalance
      : solPrice > 0
      ? ((settings.liveSigner === 'bot' ? bot.botWallet.solBalance ?? 0 : settings.solBalance) + (settings.liveSigner === 'bot' && settings.phantomWalletConnected ? settings.solBalance : 0)) * solPrice
      : null;
    const verdict = await AIService.decideSignal(toGateSignal(candidate), settings, {
      openPositions: bot.positions.length,
      stats: bot.getStats(),
      todayPnlUsd: Number(bot.getTodayRealizedPnl().toFixed(2)),
      capitalUsd: capitalUsd === null ? null : Math.round(capitalUsd * 100) / 100,
    });
    if (!verdict || !verdict.available) {
      // Not a verdict on the token: the signal stays eligible for the next scan.
      bot.log('warning', `[AI GATE] No answer from Claude (${verdict?.reason || 'network error'}) - ${candidate.coin.symbol} not bought. Check the AI settings.`, { coinSymbol: candidate.coin.symbol });
      return;
    }
    useBotStore.setState({
      lastAiDecision: { action: verdict.action, confidence: verdict.confidence, reason: verdict.reason, riskLevel: verdict.riskLevel, source: verdict.source, model: verdict.model, symbol: candidate.coin.symbol, at: Date.now() },
    });
    const approved = verdict.action === 'buy' && verdict.confidence >= settings.aiMinConfidence;
    bot.log('ai', `[AI ${verdict.model || 'claude'}] ${candidate.coin.symbol}: ${verdict.action.toUpperCase()} (${verdict.confidence}%) - ${verdict.reason}`, { coinSymbol: candidate.coin.symbol });
    if (!approved) {
      autoBuyAt.set(candidate.id, Date.now());
      return;
    }
    if (settings.aiAdjustTargets) {
      if (verdict.suggestedStopLossPercent) sl = round1(Math.max(4, Math.min(sl, verdict.suggestedStopLossPercent)));
      if (verdict.suggestedTakeProfitPercent) tp = round1(Math.max(tp * 0.8, Math.min(tp * 1.5, verdict.suggestedTakeProfitPercent)));
    }
    if (verdict.sizeFactor === 0.5 && settings.buyAmountUsd * 0.5 >= MIN_HALF_SIZE_USD) amountUsd = Math.round(settings.buyAmountUsd * 0.5);
    reason = `${reason}, AI ${verdict.confidence}%`;
  }

  autoBuyAt.set(candidate.id, Date.now());
  const r = await bot.manualSnipeCoin(candidate.coin, amountUsd, reason, { tp, sl });
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
    autoSince: null,

    init: () => {
      if (initialized || typeof window === 'undefined') return;
      initialized = true;
      const prefs = readPrefs();
      const autoOn = useBotStore.getState().settings.scannerAutoBuy;
      // Auto-buy that was left on must keep scanning, whatever the scanner preference says.
      set({ ...prefs, enabled: prefs.enabled || autoOn, autoSince: autoOn ? Date.now() : null });
      if (get().enabled) void get().scanNow();

      const restartIfStale = () => {
        const s = get();
        if (s.enabled && !s.scanning && s.lastScanAt && Date.now() - s.lastScanAt > STALE_SCAN_MS) void s.scanNow();
      };
      setInterval(restartIfStale, WATCHDOG_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') restartIfStale();
      });
    },

    startAutoTrade: () => {
      useBotStore.getState().updateSettings({ scannerAutoBuy: true });
      set({ autoSince: Date.now() });
      get().setEnabled(true);
      useBotStore.getState().log('info', '[AUTO TRADE] On: the scanner buys Ready signals it confirms (and Claude approves, when the AI gate is on).');
    },

    stopAutoTrade: () => {
      useBotStore.getState().updateSettings({ scannerAutoBuy: false });
      set({ autoSince: null });
      useBotStore.getState().log('info', '[AUTO TRADE] Off. Open positions are still managed; the scanner keeps listing signals.');
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
          mode: settings.scannerMode,
          maxStopPercent: MAX_STOP_PERCENT,
          priorityMints: get().signals.filter((s) => s.status !== 'rejected').map((s) => s.id),
          smartWallets: settings.smartWallets,
        });

        const minScore = minEntryScore(useBotStore.getState().settings.scannerMode);
        const ready = result.signals.filter((s) => s.status === 'ready' && (s.score?.total ?? 0) >= minScore);
        const previous = new Set(get().readyIds);
        if (get().alerts) ready.filter((s) => !previous.has(s.id)).forEach(notify);
        await autoBuy(ready);

        const error = result.candidateCount === 0 ? 'No market data came back - the data APIs may be rate-limiting. Retrying next minute.' : null;
        set({
          signals: result.signals,
          candidateCount: result.candidateCount,
          lastScanAt: result.scannedAt,
          readyIds: ready.map((s) => s.id),
          error,
        });

        const brief = (s: ScanSignal): ScannerSignalBrief => ({
          symbol: s.coin.symbol,
          mint: s.id,
          setup: s.setup,
          score: s.score?.total,
          reason: s.reason,
          entryLow: s.entryLow,
          entryHigh: s.entryHigh,
          stopPrice: s.stopPrice,
          targetPrice: s.targetPrice,
          slPercent: s.slPercent,
          tpPercent: s.tpPercent,
          netRewardRisk: s.netRewardRisk,
          rsi: s.rsi,
          smartWallets: s.smartWallets,
        });
        const rejectedBy = new Map<string, number>();
        result.signals
          .filter((s) => s.status === 'rejected')
          // Group "Liquidity $12K is under $25K" and friends by their wording, not their numbers.
          .forEach((s) => {
            const key = s.reason.replace(/\$[\d.,]+[KM]?|\d+(\.\d+)?%|\$0\.[\d{}]+/g, '#');
            rejectedBy.set(key, (rejectedBy.get(key) || 0) + 1);
          });
        setScannerSummary({
          enabled: get().enabled,
          scannedAt: result.scannedAt,
          candidates: result.candidateCount,
          ready: result.signals.filter((s) => s.status === 'ready').map(brief),
          watch: result.signals.filter((s) => s.status === 'watch').slice(0, 8).map(brief),
          rejectedBy: [...rejectedBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([reason, count]) => ({ reason, count })),
          error,
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
