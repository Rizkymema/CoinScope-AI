import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { CoinData } from '../types/coin';
import {
  AiDecision,
  BotLogEntry,
  BotPosition,
  BotSettings,
  BotStats,
  BotTradeHistory,
  StrategyPreset,
  TokenTradeEvent,
} from '../types/bot';
import { BotService } from '../services/bot.service';
import { wsService } from '../services/websocket.service';
import { AudioService } from '../services/audio.service';
import { WalletService, WalletProviderType, DEFAULT_SOLANA_RPC } from '../services/wallet.service';
import { TradeService, DryRunResult } from '../services/trade.service';
import { AIService } from '../services/ai.service';
import { SolPriceService } from '../services/solprice.service';
import { CoinService } from '../services/coin.service';
import { recordTradeForChart } from '../services/chart.service';
import { PumpFunService } from '../services/pumpfun.service';
import { BridgeService } from '../services/bridge.service';

type ExitReason = BotTradeHistory['exitReason'];

export interface BotToast {
  title: string;
  description: string;
  type: 'buy' | 'sell_tp' | 'sell_sl' | 'info' | 'error';
  coinSymbol?: string;
}

interface BotState {
  isActive: boolean;
  settings: BotSettings;
  /** Virtual USD balance used in paper-trading mode. */
  walletBalance: number;
  positions: BotPosition[];
  history: BotTradeHistory[];
  logs: BotLogEntry[];
  /** Newest coins seen by the scanner (stream + feed), newest first. */
  recentCoins: CoinData[];
  processedCoinIds: string[];
  pendingTradeIds: string[];
  isWsConnected: boolean;
  wsLatencyMs: number;
  wsEventsPerMinute: number;
  solPriceUsd: number;
  latestToastNotification: BotToast | null;
  lastAiDecision: (AiDecision & { symbol: string; at: number }) | null;
  lastDryRun: (DryRunResult & { symbol: string; at: number }) | null;
  isDryRunning: boolean;
  /** Why candidates were rejected, newest first. Powers the "nothing is trading" hint. */
  skipReasons: { reason: string; at: number }[];
  evaluatedCount: number;

  // lifecycle
  boot: () => void;
  toggleBot: (active?: boolean) => void;
  updateSettings: (newSettings: Partial<BotSettings>) => void;
  applyPreset: (preset: Exclude<StrategyPreset, 'custom'>) => void;
  /** Most common rejection reason in the recent window, for the empty-state hint. */
  getTopSkipReason: () => { reason: string; count: number; total: number } | null;

  // scanner + execution
  ingestCoins: (coins: CoinData[], origin?: 'stream' | 'feed') => void;
  processIncomingCoins: (coins: CoinData[]) => Promise<void>;
  manualSnipeCoin: (coin: CoinData, amountUsd?: number, reason?: string) => Promise<{ success: boolean; message: string }>;
  closePosition: (positionId: string, exitReason: ExitReason, percent?: number) => Promise<{ success: boolean; message: string }>;
  setPositionTargets: (positionId: string, tpPercent?: number, slPercent?: number) => boolean;
  updatePositionsWithLatestCoins: (coins: CoinData[]) => void;
  applyTradeTick: (trade: TokenTradeEvent) => void;
  pollPositionPrices: () => Promise<void>;
  findCoin: (query: string) => CoinData | null;
  /** Builds and simulates a real buy for a Solana coin without signing - proves the live pipeline. */
  dryRunLiveTrade: (coinQuery?: string, amountUsd?: number) => Promise<DryRunResult>;

  // wallet
  connectWallet: (preferred?: WalletProviderType) => Promise<void>;
  disconnectWallet: () => Promise<void>;
  refreshWalletBalance: () => Promise<void>;

  // targets
  addTargetSymbol: (symbol: string) => void;
  removeTargetSymbol: (symbol: string) => void;

  // misc
  log: (type: BotLogEntry['type'], message: string, extra?: Partial<BotLogEntry>) => void;
  clearLogs: () => void;
  resetWallet: () => void;
  clearToast: () => void;
  getStats: () => BotStats;
  getSnapshot: () => Record<string, unknown>;
}

/**
 * Risk presets. The filters below decide how often the bot can trade at all, so the choice
 * belongs to the user rather than being buried in defaults.
 *
 * Reference point measured from the live stream: a typical fresh Pump.fun mint holds
 * $0-$150 of liquidity in its first minute, and only a small share ever passes $1,000.
 */
export const STRATEGY_PRESETS: Record<Exclude<StrategyPreset, 'custom'>, Partial<BotSettings> & { label: string; blurb: string }> = {
  conservative: {
    label: 'Conservative',
    blurb: 'Waits for a filled curve and real depth. Trades rarely.',
    minLiquidityUsd: 5_000,
    minBondingCurvePercent: 40,
    maxTokenAgeMinutes: 1_440,
    aiMinConfidence: 45,
    takeProfitPercent: 40,
    stopLossPercent: 20,
    trailingStopPercent: 15,
    maxPositions: 3,
  },
  balanced: {
    label: 'Balanced',
    blurb: 'Needs some money in the pool before entering. A few trades an hour.',
    minLiquidityUsd: 500,
    minBondingCurvePercent: 0,
    maxTokenAgeMinutes: 120,
    aiMinConfidence: 45,
    takeProfitPercent: 60,
    stopLossPercent: 25,
    trailingStopPercent: 0,
    maxPositions: 5,
  },
  aggressive: {
    label: 'Aggressive',
    blurb: 'Buys very early with almost no depth. Expect most entries to fail.',
    minLiquidityUsd: 150,
    minBondingCurvePercent: 0,
    maxTokenAgeMinutes: 120,
    aiMinConfidence: 35,
    takeProfitPercent: 100,
    stopLossPercent: 35,
    trailingStopPercent: 0,
    maxPositions: 8,
  },
};

/** Fields that define a preset - editing any of them flips the preset to 'custom'. */
const PRESET_FIELDS: (keyof BotSettings)[] = [
  'minLiquidityUsd',
  'minBondingCurvePercent',
  'maxTokenAgeMinutes',
  'aiMinConfidence',
  'takeProfitPercent',
  'stopLossPercent',
  'trailingStopPercent',
  'maxPositions',
];

const DEFAULT_SETTINGS: BotSettings = {
  buyAmountUsd: 25,
  minLiquidityUsd: 500,
  maxRiskLevel: 'High',
  minAiScore: 60,
  targetChain: 'all',
  launchPlatform: 'all',
  scanSpeed: 'websocket',
  minBondingCurvePercent: 0,
  takeProfitPercent: 60,
  stopLossPercent: 25,
  trailingStopPercent: 0,
  autoSell: true,
  maxPositions: 5,
  slippagePercent: 15,
  paperTrading: true,
  maxTokenAgeMinutes: 120,
  soundAlerts: true,
  solanaRpcUrl: DEFAULT_SOLANA_RPC,
  priorityFeeSol: 0.0005,
  phantomWalletConnected: false,
  connectedWalletAddress: null,
  solBalance: 0,
  walletType: null,
  targetOnlyMode: false,
  whitelistedSymbols: [],
  aiGateEnabled: true,
  aiMinConfidence: 45,
  aiAdjustTargets: true,
  preset: 'balanced',
};

const MAX_LOGS = 200;
const MAX_RECENT = 80;
const PRICE_POLL_MS = 6_000;
const WALLET_REFRESH_MS = 30_000;

let booted = false;
let pricePollTimer: ReturnType<typeof setInterval> | null = null;
let walletTimer: ReturnType<typeof setInterval> | null = null;
let snipeQueue: Promise<void> = Promise.resolve();

const nowTime = () => new Date().toLocaleTimeString();
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const mintOf = (coin: CoinData) => coin.mint || (coin.id.includes(':') ? coin.id.split(':')[1] : coin.id);
const isSolana = (coin: CoinData) => (coin.chainId || '').toLowerCase() === 'solana';

function mergeCoin(prev: CoinData | undefined, next: CoinData): CoinData {
  if (!prev) return next;
  return {
    ...prev,
    ...next,
    imageUrl: next.imageUrl || prev.imageUrl,
    createdAt: prev.createdAt && next.createdAt ? Math.min(prev.createdAt, next.createdAt) : prev.createdAt || next.createdAt,
    fundamentals: {
      marketCap: next.fundamentals.marketCap || prev.fundamentals.marketCap,
      circulatingSupply: next.fundamentals.circulatingSupply || prev.fundamentals.circulatingSupply,
      volume24h: next.fundamentals.volume24h || prev.fundamentals.volume24h,
      tvl: next.fundamentals.tvl || prev.fundamentals.tvl,
    },
  };
}

export const useBotStore = create<BotState>()(
  persist(
    (set, get) => ({
      isActive: false,
      settings: DEFAULT_SETTINGS,
      walletBalance: 1000,
      positions: [],
      history: [],
      logs: [
        {
          id: uid('log-init'),
          timestamp: nowTime(),
          type: 'info',
          message: 'CoinScope bot engine ready. Paper trading is ON by default. Connect a wallet, then switch to live under Bot > Settings.',
        },
      ],
      recentCoins: [],
      processedCoinIds: [],
      pendingTradeIds: [],
      isWsConnected: false,
      wsLatencyMs: 0,
      wsEventsPerMinute: 0,
      solPriceUsd: 0,
      latestToastNotification: null,
      lastAiDecision: null,
      lastDryRun: null,
      isDryRunning: false,
      skipReasons: [],
      evaluatedCount: 0,

      log: (type, message, extra) => {
        const entry: BotLogEntry = { id: uid(`log-${type}`), timestamp: nowTime(), type, message, ...extra };
        set((state) => ({ logs: [entry, ...state.logs].slice(0, MAX_LOGS) }));
      },

      /** Wires stream listeners, price monitors and wallet auto-reconnect. Safe to call many times. */
      boot: () => {
        if (booted || typeof window === 'undefined') return;
        booted = true;

        wsService.onConnectionChange(({ connected, latencyMs, eventsPerMinute }) => {
          set({ isWsConnected: connected, wsLatencyMs: latencyMs, wsEventsPerMinute: eventsPerMinute });
        });

        wsService.onNewToken((coin) => {
          get().ingestCoins([coin], 'stream');
        });

        wsService.onTokenTrade((trade) => {
          // Tokens too new to be indexed by a chart provider get their candles built here.
          recordTradeForChart(trade, get().solPriceUsd || SolPriceService.getCached());
          get().applyTradeTick(trade);
        });

        wsService.onMigration(({ mint }) => {
          const pos = get().positions.find((p) => (p.mint || mintOf(p.coin)) === mint);
          if (pos) get().log('info', `${pos.coin.symbol} migrated off the bonding curve (graduated).`, { coinSymbol: pos.coin.symbol });
        });

        SolPriceService.onPrice((price) => set({ solPriceUsd: price }));
        SolPriceService.getSolPriceUsd().catch(() => {});

        // Re-subscribe price ticks for persisted positions and keep marking them to market.
        const solMints = get()
          .positions.filter((p) => isSolana(p.coin))
          .map((p) => p.mint || mintOf(p.coin));
        if (solMints.length) wsService.subscribeTokenTrades(solMints);

        // Always stream new launches: the scanner list feeds the UI, the AI chat and the MCP tools,
        // so it must be populated no matter which tab is open.
        wsService.connect();
        wsService.subscribeNewTokens();

        if (!pricePollTimer) {
          pricePollTimer = setInterval(() => {
            get().pollPositionPrices().catch(() => {});
          }, PRICE_POLL_MS);
        }

        // Silent wallet reconnect (no popup) when the user connected before.
        const { connectedWalletAddress, walletType, solanaRpcUrl } = get().settings;
        if (connectedWalletAddress) {
          WalletService.connect(solanaRpcUrl, walletType || undefined, true).then((res) => {
            if (res.success && res.address) {
              set((s) => ({
                settings: { ...s.settings, phantomWalletConnected: true, connectedWalletAddress: res.address!, solBalance: res.solBalance || 0, walletType: res.walletType || s.settings.walletType },
              }));
            } else {
              set((s) => ({ settings: { ...s.settings, phantomWalletConnected: false } }));
            }
          });
        }

        WalletService.onAccountChange((address) => {
          if (!address) {
            set((s) => ({ settings: { ...s.settings, phantomWalletConnected: false, connectedWalletAddress: null, solBalance: 0 } }));
            get().log('warning', 'Wallet disconnected from the extension.');
            return;
          }
          set((s) => ({ settings: { ...s.settings, connectedWalletAddress: address, phantomWalletConnected: true } }));
          get().refreshWalletBalance();
        });

        if (!walletTimer) {
          walletTimer = setInterval(() => get().refreshWalletBalance(), WALLET_REFRESH_MS);
        }

        // MCP bridge: lets external AI clients (Claude Desktop, Cursor, ...) read state and control the bot.
        BridgeService.start();
      },

      toggleBot: (active) => {
        const next = active !== undefined ? active : !get().isActive;
        const { settings } = get();

        if (next && !settings.paperTrading && !settings.phantomWalletConnected) {
          get().log('warning', 'Live mode is selected but no wallet is connected. Connect a wallet or switch to paper trading.');
          set({ latestToastNotification: { title: 'Wallet required', description: 'Connect Phantom/Solflare before starting the bot in live mode.', type: 'error' } });
          return;
        }

        if (next) {
          get().boot();
          wsService.connect();
          wsService.subscribeNewTokens();
          wsService.subscribeMigrations();
        }
        // When pausing we keep the stream open: the New Coins feed and open positions still use it.

        set({ isActive: next });
        get().log(
          'info',
          next
            ? `Auto-snipe bot STARTED (${settings.paperTrading ? 'paper trading' : 'LIVE - real funds'}${settings.aiGateEnabled ? ', AI gate on' : ''}). Listening to Pump.fun stream + new DEX pools...`
            : 'Auto-snipe bot PAUSED. Open positions are still monitored.'
        );
      },

      updateSettings: (newSettings) => {
        const prev = get().settings;
        const touchesPreset = PRESET_FIELDS.some((k) => newSettings[k] !== undefined && newSettings[k] !== prev[k]);
        set((state) => ({
          settings: { ...state.settings, ...newSettings, ...(touchesPreset ? { preset: 'custom' as StrategyPreset } : {}) },
        }));
        if (newSettings.paperTrading !== undefined && newSettings.paperTrading !== prev.paperTrading) {
          get().log(
            newSettings.paperTrading ? 'info' : 'warning',
            newSettings.paperTrading ? 'Switched to PAPER trading (simulated fills).' : 'Switched to LIVE trading - the bot will sign real Solana swaps with your wallet.'
          );
        }
        if (newSettings.solanaRpcUrl && newSettings.solanaRpcUrl !== prev.solanaRpcUrl) get().refreshWalletBalance();
      },

      applyPreset: (preset) => {
        const { label, blurb, ...values } = STRATEGY_PRESETS[preset];
        void blurb;
        set((state) => ({ settings: { ...state.settings, ...values, preset } }));
        get().log('info', `Strategy preset set to ${label}: min liquidity $${values.minLiquidityUsd}, AI gate >= ${values.aiMinConfidence}%, TP +${values.takeProfitPercent}% / SL -${values.stopLossPercent}%.`);
      },

      getTopSkipReason: () => {
        const cutoff = Date.now() - 10 * 60_000;
        const recent = get().skipReasons.filter((r) => r.at >= cutoff);
        if (recent.length === 0) return null;
        const tally = new Map<string, number>();
        recent.forEach((r) => tally.set(r.reason, (tally.get(r.reason) || 0) + 1));
        const [reason, count] = Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0];
        return { reason, count, total: recent.length };
      },

      ingestCoins: (coins, origin = 'feed') => {
        if (!coins.length) return;
        const solPrice = get().solPriceUsd || SolPriceService.getCached();

        set((state) => {
          const map = new Map(state.recentCoins.map((c) => [c.id, c]));
          coins.forEach((c) => {
            if (!c?.id) return;
            const priced = c.priceSol && !c.priceUsd && solPrice ? { ...c, priceUsd: c.priceSol * solPrice } : c;
            map.set(c.id, mergeCoin(map.get(c.id), priced));
          });
          const recent = Array.from(map.values())
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            .slice(0, MAX_RECENT);
          return { recentCoins: recent };
        });

        // Lazily resolve images for stream tokens (metadata lives on IPFS).
        coins
          .filter((c) => !c.imageUrl && c.metadataUri)
          .slice(0, 5)
          .forEach((c) => {
            PumpFunService.resolveMetadata(c.metadataUri).then((meta) => {
              if (!meta?.image) return;
              set((state) => ({
                recentCoins: state.recentCoins.map((rc) => (rc.id === c.id ? { ...rc, imageUrl: meta.image, description: rc.description || meta.description } : rc)),
                positions: state.positions.map((p) => (p.coin.id === c.id ? { ...p, coin: { ...p.coin, imageUrl: meta.image } } : p)),
              }));
            });
          });

        get().updatePositionsWithLatestCoins(coins);

        if (get().isActive) {
          // Serialize evaluation so the AI gate and live execution never race.
          snipeQueue = snipeQueue.then(() => get().processIncomingCoins(coins)).catch(() => {});
        }
        void origin;
      },

      processIncomingCoins: async (incoming) => {
        for (const coin of incoming) {
          const state = get();
          if (!state.isActive) return;
          if (!coin?.id) continue;
          if (state.processedCoinIds.includes(coin.id) || state.pendingTradeIds.includes(coin.id)) continue;
          if (state.positions.some((p) => p.coin.id === coin.id)) continue;

          const { settings } = state;

          if (settings.targetOnlyMode) {
            const sym = coin.symbol.toUpperCase();
            const mint = mintOf(coin).toLowerCase();
            const ok = settings.whitelistedSymbols.some((s) => s.toUpperCase() === sym || s.toLowerCase() === mint || s.toLowerCase() === coin.id.toLowerCase());
            if (!ok) {
              set((s) => ({ processedCoinIds: [...s.processedCoinIds, coin.id].slice(-2000) }));
              continue;
            }
          }

          const evalResult = BotService.evaluateCoinForSnipe(coin, settings, state.positions.length + state.pendingTradeIds.length);
          if (!evalResult.pass) {
            const transient = /Max positions/i.test(evalResult.reason);
            if (!transient) set((s) => ({ processedCoinIds: [...s.processedCoinIds, coin.id].slice(-2000) }));
            get().log('skip', `[SKIP] ${coin.symbol}: ${evalResult.reason}`, { coinSymbol: coin.symbol, chainId: coin.chainId });
            set((st) => ({
              skipReasons: [{ reason: evalResult.category, at: Date.now() }, ...st.skipReasons].slice(0, 200),
              evaluatedCount: st.evaluatedCount + 1,
            }));
            continue;
          }

          if (!settings.paperTrading) {
            if (!settings.phantomWalletConnected || !settings.connectedWalletAddress) {
              get().log('warning', `[LIVE] Skipped ${coin.symbol}: wallet not connected.`, { coinSymbol: coin.symbol });
              continue;
            }
            if (!isSolana(coin)) {
              set((s) => ({ processedCoinIds: [...s.processedCoinIds, coin.id].slice(-2000) }));
              get().log('skip', `[LIVE] Skipped ${coin.symbol}: live execution supports Solana only (token on ${coin.chainId}).`, { coinSymbol: coin.symbol });
              continue;
            }
          } else if (state.walletBalance < settings.buyAmountUsd) {
            get().log('warning', `[PAPER] Insufficient virtual balance ($${state.walletBalance.toFixed(2)}) to buy ${coin.symbol}.`, { coinSymbol: coin.symbol });
            continue;
          }

          set((s) => ({ processedCoinIds: [...s.processedCoinIds, coin.id].slice(-2000), pendingTradeIds: [...s.pendingTradeIds, coin.id] }));

          try {
            let decision: AiDecision | undefined;
            let tp = settings.takeProfitPercent;
            let sl = settings.stopLossPercent;

            if (settings.aiGateEnabled) {
              decision = await AIService.decideSnipe(coin, settings, { openPositions: get().positions.length, stats: get().getStats() });
              set({ lastAiDecision: { ...decision, symbol: coin.symbol, at: Date.now() } });
              const approved = decision.action === 'buy' && decision.confidence >= settings.aiMinConfidence;
              get().log(
                'ai',
                `[AI ${decision.source === 'ai' ? decision.model || 'claude' : 'heuristic'}] ${coin.symbol}: ${decision.action.toUpperCase()} (${decision.confidence}%) - ${decision.reason}`,
                { coinSymbol: coin.symbol, chainId: coin.chainId }
              );
              if (!approved) {
                set((st) => ({
                  skipReasons: [{ reason: 'AI gate below threshold', at: Date.now() }, ...st.skipReasons].slice(0, 200),
                  evaluatedCount: st.evaluatedCount + 1,
                }));
                continue;
              }
              if (settings.aiAdjustTargets) {
                if (decision.suggestedTakeProfitPercent) tp = decision.suggestedTakeProfitPercent;
                if (decision.suggestedStopLossPercent) sl = decision.suggestedStopLossPercent;
              }
            }

            if (!get().isActive) continue;
            set((st) => ({ evaluatedCount: st.evaluatedCount + 1 }));
            await openPosition(coin, settings.buyAmountUsd, { tp, sl, decision, reason: 'auto-snipe' });
          } finally {
            set((s) => ({ pendingTradeIds: s.pendingTradeIds.filter((id) => id !== coin.id) }));
          }
        }
      },

      manualSnipeCoin: async (coin, amountUsd, reason = 'manual') => {
        const { settings, walletBalance, pendingTradeIds } = get();
        const amount = amountUsd && amountUsd > 0 ? amountUsd : settings.buyAmountUsd;
        if (pendingTradeIds.includes(coin.id)) return { success: false, message: `${coin.symbol} already has an order in flight.` };
        if (!coin.priceUsd || coin.priceUsd <= 0) {
          const solPrice = get().solPriceUsd || SolPriceService.getCached();
          if (coin.priceSol && solPrice) coin = { ...coin, priceUsd: coin.priceSol * solPrice };
          else return { success: false, message: `${coin.symbol} has no usable price yet.` };
        }
        if (settings.paperTrading && walletBalance < amount) {
          return { success: false, message: `Insufficient paper balance ($${walletBalance.toFixed(2)} available, need $${amount}).` };
        }
        if (!settings.paperTrading) {
          if (!settings.phantomWalletConnected || !settings.connectedWalletAddress) return { success: false, message: 'Connect a wallet before live trading.' };
          if (!isSolana(coin)) return { success: false, message: `Live execution supports Solana only (token is on ${coin.chainId}).` };
        }

        set((s) => ({ pendingTradeIds: [...s.pendingTradeIds, coin.id] }));
        try {
          return await openPosition(coin, amount, { tp: settings.takeProfitPercent, sl: settings.stopLossPercent, reason });
        } finally {
          set((s) => ({ pendingTradeIds: s.pendingTradeIds.filter((id) => id !== coin.id) }));
        }
      },

      closePosition: async (positionId, exitReason, percent = 100) => {
        const state = get();
        const pos = state.positions.find((p) => p.id === positionId);
        if (!pos) return { success: false, message: 'Position not found.' };
        if (state.pendingTradeIds.includes(pos.id)) return { success: false, message: 'A sell is already in progress for this position.' };
        const pct = Math.max(1, Math.min(100, percent));

        set((s) => ({ pendingTradeIds: [...s.pendingTradeIds, pos.id] }));
        try {
          let sellPriceUsd = pos.currentPriceUsd || pos.buyPriceUsd;
          let proceedsUsd = pos.tokensBought * (pct / 100) * sellPriceUsd;
          let sellTx: string | undefined;

          if (pos.isLive) {
            const addr = get().settings.connectedWalletAddress;
            if (!addr) return { success: false, message: 'Wallet not connected - cannot sell a live position.' };
            const result = await TradeService.executeSell(pos, pct, get().settings, addr);
            if (!result.success) {
              get().log('warning', `[SELL FAILED] ${pos.coin.symbol}: ${result.message}`, { coinSymbol: pos.coin.symbol, txSignature: result.signature });
              set({ latestToastNotification: { title: 'Sell failed', description: result.message, type: 'error', coinSymbol: pos.coin.symbol } });
              return { success: false, message: result.message };
            }
            sellTx = result.signature;
            if (result.usdReceived && result.usdReceived > 0) {
              proceedsUsd = result.usdReceived;
              const sold = result.tokensSold || pos.tokensBought * (pct / 100);
              if (sold > 0) sellPriceUsd = proceedsUsd / sold;
            }
            get().refreshWalletBalance();
          }

          const soldTokens = pos.tokensBought * (pct / 100);
          const costBasis = pos.amountUsd * (pct / 100);
          const pnlUsd = proceedsUsd - costBasis;
          const pnlPercent = costBasis > 0 ? (pnlUsd / costBasis) * 100 : 0;

          const trade: BotTradeHistory = {
            id: uid('hist'),
            coinSymbol: pos.coin.symbol,
            coinName: pos.coin.name,
            chainId: pos.coin.chainId,
            buyPriceUsd: pos.buyPriceUsd,
            sellPriceUsd,
            amountUsd: costBasis,
            pnlUsd,
            pnlPercent,
            boughtAt: pos.boughtAt,
            soldAt: Date.now(),
            exitReason,
            isLive: pos.isLive,
            buyTxSignature: pos.buyTxSignature,
            sellTxSignature: sellTx,
          };

          const remaining = pct >= 100 ? null : {
            ...pos,
            tokensBought: pos.tokensBought - soldTokens,
            amountUsd: pos.amountUsd - costBasis,
            tokenAmountRaw: pos.tokenAmountRaw ? ((BigInt(pos.tokenAmountRaw) * BigInt(100 - pct)) / BigInt(100)).toString() : pos.tokenAmountRaw,
          };

          if (get().settings.soundAlerts) {
            if (exitReason === 'TP_HIT') AudioService.playTakeProfitSound();
            else if (exitReason === 'SL_HIT' || exitReason === 'TRAILING_STOP') AudioService.playStopLossSound();
          }

          const sign = pnlUsd >= 0 ? '+' : '';
          const label =
            exitReason === 'TP_HIT' ? 'TAKE PROFIT' : exitReason === 'SL_HIT' ? 'STOP LOSS' : exitReason === 'TRAILING_STOP' ? 'TRAILING STOP' : exitReason === 'AI_SELL' ? 'AI SELL' : 'MANUAL SELL';

          set((s) => ({
            walletBalance: pos.isLive ? s.walletBalance : s.walletBalance + proceedsUsd,
            positions: remaining ? s.positions.map((p) => (p.id === pos.id ? remaining : p)) : s.positions.filter((p) => p.id !== pos.id),
            history: [trade, ...s.history].slice(0, 500),
            latestToastNotification: {
              title: `${label}: ${pos.coin.symbol}`,
              description: `${pct}% sold for $${proceedsUsd.toFixed(2)} (${sign}${pnlPercent.toFixed(1)}%)${sellTx ? ' - tx ' + sellTx.slice(0, 8) : ''}`,
              type: exitReason === 'TP_HIT' ? 'sell_tp' : exitReason === 'SL_HIT' || exitReason === 'TRAILING_STOP' ? 'sell_sl' : 'info',
              coinSymbol: pos.coin.symbol,
            },
          }));

          get().log(
            exitReason === 'TP_HIT' ? 'sell' : exitReason === 'SL_HIT' || exitReason === 'TRAILING_STOP' ? 'warning' : 'sell',
            `[${label}] ${pos.isLive ? 'LIVE ' : ''}Sold ${pct}% of ${pos.coin.symbol} @ $${sellPriceUsd.toPrecision(4)} -> $${proceedsUsd.toFixed(2)} (${sign}${pnlPercent.toFixed(1)}%, ${sign}$${pnlUsd.toFixed(2)})`,
            { coinSymbol: pos.coin.symbol, chainId: pos.coin.chainId, txSignature: sellTx }
          );

          if (!remaining && isSolana(pos.coin)) {
            const mint = pos.mint || mintOf(pos.coin);
            const stillHeld = get().positions.some((p) => (p.mint || mintOf(p.coin)) === mint);
            if (!stillHeld) wsService.unsubscribeTokenTrades([mint]);
          }
          if (!remaining && get().positions.length === 0 && !get().isActive) wsService.disconnect();

          return { success: true, message: `Sold ${pct}% of ${pos.coin.symbol} for $${proceedsUsd.toFixed(2)} (${sign}${pnlPercent.toFixed(1)}%).` };
        } finally {
          set((s) => ({ pendingTradeIds: s.pendingTradeIds.filter((id) => id !== pos.id) }));
        }
      },

      setPositionTargets: (positionId, tpPercent, slPercent) => {
        const pos = get().positions.find((p) => p.id === positionId);
        if (!pos) return false;
        const tpPriceUsd = tpPercent ? pos.buyPriceUsd * (1 + tpPercent / 100) : pos.tpPriceUsd;
        const slPriceUsd = slPercent ? pos.buyPriceUsd * (1 - slPercent / 100) : pos.slPriceUsd;
        set((s) => ({ positions: s.positions.map((p) => (p.id === positionId ? { ...p, tpPriceUsd, slPriceUsd } : p)) }));
        get().log('info', `Targets updated for ${pos.coin.symbol}: TP $${tpPriceUsd.toPrecision(4)} / SL $${slPriceUsd.toPrecision(4)}`, { coinSymbol: pos.coin.symbol });
        return true;
      },

      updatePositionsWithLatestCoins: (latestCoins) => {
        const { positions } = get();
        if (positions.length === 0 || latestCoins.length === 0) return;
        const priceById = new Map<string, { price: number; source: BotPosition['priceSource'] }>();
        latestCoins.forEach((c) => {
          if (c.priceUsd && c.priceUsd > 0) priceById.set(c.id, { price: c.priceUsd, source: (c.source as BotPosition['priceSource']) || 'dexscreener' });
        });
        positions.forEach((pos) => {
          const hit = priceById.get(pos.coin.id);
          if (hit) markToMarket(pos.id, hit.price, hit.source);
        });
      },

      applyTradeTick: (trade) => {
        const solPrice = get().solPriceUsd || SolPriceService.getCached();
        if (!solPrice || !trade.priceSol) return;
        const priceUsd = trade.priceSol * solPrice;
        get().positions.forEach((pos) => {
          if ((pos.mint || mintOf(pos.coin)) === trade.mint) markToMarket(pos.id, priceUsd, 'pumpportal');
        });
        // Keep the scanner list fresh too (volume / mcap for the feed).
        set((s) => ({
          recentCoins: s.recentCoins.map((c) =>
            mintOf(c) === trade.mint
              ? { ...c, priceUsd, priceSol: trade.priceSol, fundamentals: { ...c.fundamentals, marketCap: trade.marketCapSol * solPrice || c.fundamentals.marketCap } }
              : c
          ),
        }));
      },

      pollPositionPrices: async () => {
        const { positions } = get();
        if (positions.length === 0) return;
        // Bonding-curve tokens are priced by the stream; everything else via DexScreener.
        const targets = positions
          .filter((p) => !(p.priceSource === 'pumpportal' && p.lastPriceUpdateAt && Date.now() - p.lastPriceUpdateAt < 20_000))
          .map((p) => ({ chainId: (p.coin.chainId || 'solana').toLowerCase(), address: p.mint || mintOf(p.coin) }));
        if (targets.length === 0) return;
        const quotes = await CoinService.getTokenQuotes(targets);
        if (quotes.size === 0) return;
        get().positions.forEach((pos) => {
          const key = `${(pos.coin.chainId || 'solana').toLowerCase()}:${pos.mint || mintOf(pos.coin)}`;
          const q = quotes.get(key) || quotes.get(pos.coin.id);
          if (q?.priceUsd) markToMarket(pos.id, q.priceUsd, 'dexscreener');
        });
      },

      findCoin: (query) => {
        const q = query.trim().toLowerCase();
        if (!q) return null;
        const pool = [...get().recentCoins, ...get().positions.map((p) => p.coin)];
        return (
          pool.find((c) => c.id.toLowerCase() === q) ||
          pool.find((c) => mintOf(c).toLowerCase() === q) ||
          pool.find((c) => c.symbol.toLowerCase() === q.replace(/^\$/, '')) ||
          pool.find((c) => c.name.toLowerCase() === q) ||
          null
        );
      },

      dryRunLiveTrade: async (coinQuery, amountUsd) => {
        const { settings, recentCoins, positions } = get();
        const fail = (message: string): DryRunResult => ({ success: false, message, attempts: [] });
        if (!settings.phantomWalletConnected || !settings.connectedWalletAddress) {
          const r = fail('Connect a wallet first - the dry run builds the swap for your real address.');
          set({ lastDryRun: { ...r, symbol: '-', at: Date.now() }, latestToastNotification: { title: 'Dry run', description: r.message, type: 'error' } });
          return r;
        }
        let coin: CoinData | null = coinQuery ? get().findCoin(coinQuery) : null;
        if (!coin) {
          // Prefer a Solana coin that already has some liquidity so the route is realistic.
          coin =
            recentCoins.find((c) => isSolana(c) && (c.fundamentals.tvl || 0) >= 500 && c.priceUsd > 0) ||
            recentCoins.find((c) => isSolana(c) && c.priceUsd > 0) ||
            positions.find((p) => isSolana(p.coin))?.coin ||
            null;
        }
        if (!coin) {
          const r = fail('No Solana coin available yet - open the New Coins tab for a few seconds and retry.');
          set({ lastDryRun: { ...r, symbol: '-', at: Date.now() } });
          return r;
        }
        const amount = amountUsd && amountUsd > 0 ? amountUsd : settings.buyAmountUsd;
        set({ isDryRunning: true });
        get().log('tx', `[DRY RUN] Building + simulating a $${amount} buy of ${coin.symbol} for ${settings.connectedWalletAddress.slice(0, 4)}... (no signature)`, { coinSymbol: coin.symbol });
        try {
          const result = await TradeService.dryRunBuy(coin, amount, settings, settings.connectedWalletAddress);
          set({
            lastDryRun: { ...result, symbol: coin.symbol, at: Date.now() },
            latestToastNotification: {
              title: result.success ? 'Live pipeline OK' : 'Dry run failed',
              description: result.message,
              type: result.success ? 'info' : 'error',
              coinSymbol: coin.symbol,
            },
          });
          get().log(result.success ? 'tx' : 'warning', `[DRY RUN ${result.success ? 'OK' : 'FAILED'}] ${result.message}`, { coinSymbol: coin.symbol });
          return result;
        } finally {
          set({ isDryRunning: false });
        }
      },

      connectWallet: async (preferred) => {
        const res = await WalletService.connect(get().settings.solanaRpcUrl, preferred);
        if (res.success && res.address) {
          set((s) => ({
            settings: { ...s.settings, phantomWalletConnected: true, connectedWalletAddress: res.address!, solBalance: res.solBalance ?? 0, walletType: res.walletType || 'phantom' },
            latestToastNotification: { title: 'Wallet connected', description: `${res.address!.slice(0, 4)}...${res.address!.slice(-4)} | ${(res.solBalance ?? 0).toFixed(3)} SOL`, type: 'info' },
          }));
          get().log('info', `[WALLET] ${res.walletType} connected ${res.address.slice(0, 4)}...${res.address.slice(-4)} | ${(res.solBalance ?? 0).toFixed(3)} SOL`);
        } else {
          set({ latestToastNotification: { title: 'Wallet connection failed', description: res.message || 'Could not connect wallet.', type: 'error' } });
          get().log('warning', `[WALLET] ${res.message}`);
        }
      },

      disconnectWallet: async () => {
        await WalletService.disconnect();
        set((s) => ({
          settings: { ...s.settings, phantomWalletConnected: false, connectedWalletAddress: null, solBalance: 0, walletType: null, paperTrading: true },
        }));
        get().log('info', '[WALLET] Disconnected. Bot switched back to paper trading.');
      },

      refreshWalletBalance: async () => {
        const { connectedWalletAddress, solanaRpcUrl, phantomWalletConnected } = get().settings;
        if (!connectedWalletAddress || !phantomWalletConnected) return;
        const bal = await WalletService.getSolBalance(connectedWalletAddress, solanaRpcUrl);
        if (bal !== null) set((s) => ({ settings: { ...s.settings, solBalance: bal } }));
      },

      addTargetSymbol: (symbol) => {
        const clean = symbol.trim();
        if (!clean) return;
        const key = clean.length > 20 ? clean : clean.toUpperCase();
        const list = get().settings.whitelistedSymbols;
        if (list.some((s) => s.toLowerCase() === key.toLowerCase())) return;
        set((s) => ({ settings: { ...s.settings, whitelistedSymbols: [...list, key] } }));
        get().log('info', `[TARGET] ${key} added to the target list.`, { coinSymbol: key });
      },

      removeTargetSymbol: (symbol) => {
        const key = symbol.trim().toLowerCase();
        set((s) => ({ settings: { ...s.settings, whitelistedSymbols: s.settings.whitelistedSymbols.filter((x) => x.toLowerCase() !== key) } }));
        get().log('info', `[TARGET] ${symbol.trim()} removed from the target list.`);
      },

      clearLogs: () => set({ logs: [] }),

      resetWallet: () => {
        const livePositions = get().positions.filter((p) => p.isLive);
        set((s) => ({
          walletBalance: 1000,
          positions: livePositions,
          history: s.history.filter((h) => h.isLive),
          processedCoinIds: [],
        }));
        get().log('info', 'Paper wallet reset to $1,000. Paper positions and history cleared (live records kept).');
      },

      clearToast: () => set({ latestToastNotification: null }),

      getStats: () => {
        const { history, positions } = get();
        const totalTrades = history.length;
        const winningTrades = history.filter((h) => h.pnlUsd > 0).length;
        const losingTrades = totalTrades - winningTrades;
        const realized = history.reduce((sum, h) => sum + h.pnlUsd, 0);
        const unrealized = positions.reduce((sum, p) => sum + p.pnlUsd, 0);
        return {
          totalTrades,
          winningTrades,
          losingTrades,
          winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
          totalProfitUsd: realized + unrealized,
          totalInvestedUsd: history.reduce((s, h) => s + h.amountUsd, 0) + positions.reduce((s, p) => s + p.amountUsd, 0),
        };
      },

      getSnapshot: () => {
        const s = get();
        const { whitelistedSymbols, connectedWalletAddress, ...rest } = s.settings;
        return {
          isActive: s.isActive,
          executionMode: s.settings.paperTrading ? 'paper' : 'live',
          wallet: {
            connected: s.settings.phantomWalletConnected,
            address: connectedWalletAddress,
            solBalance: s.settings.solBalance,
            solPriceUsd: s.solPriceUsd,
            paperBalanceUsd: s.walletBalance,
          },
          stream: { connected: s.isWsConnected, latencyMs: s.wsLatencyMs, eventsPerMinute: s.wsEventsPerMinute },
          settings: { ...rest, whitelistedSymbols },
          openPositions: s.positions.length,
          pendingOrders: s.pendingTradeIds.length,
          stats: s.getStats(),
          recentCoinsCount: s.recentCoins.length,
          lastAiDecision: s.lastAiDecision,
        };
      },
    }),
    {
      name: 'coinscope-bot-v2',
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state) => ({
        settings: state.settings,
        walletBalance: state.walletBalance,
        positions: state.positions,
        history: state.history,
        logs: state.logs.slice(0, 60),
        isActive: false,
      }),
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<BotState>;
        return {
          ...current,
          ...p,
          settings: { ...DEFAULT_SETTINGS, ...(p.settings || {}), phantomWalletConnected: false },
          isActive: false,
        };
      },
    }
  )
);

/* ------------------------------------------------------------------ */
/* Internal helpers (need access to the store singleton)               */
/* ------------------------------------------------------------------ */

function markToMarket(positionId: string, price: number, source: BotPosition['priceSource']) {
  if (!price || price <= 0) return;
  const store = useBotStore.getState();
  const pos = store.positions.find((p) => p.id === positionId);
  if (!pos || store.pendingTradeIds.includes(pos.id)) return;

  const currentVal = pos.tokensBought * price;
  const pnlUsd = currentVal - pos.amountUsd;
  const pnlPercent = pos.amountUsd > 0 ? (pnlUsd / pos.amountUsd) * 100 : 0;
  const highPriceUsd = Math.max(pos.highPriceUsd, price);

  useBotStore.setState((s) => ({
    positions: s.positions.map((p) =>
      p.id === positionId ? { ...p, currentPriceUsd: price, pnlUsd, pnlPercent, highPriceUsd, lastPriceUpdateAt: Date.now(), priceSource: source } : p
    ),
  }));

  const { settings } = store;
  if (!settings.autoSell) return;
  let exit: ExitReason | null = null;
  if (price >= pos.tpPriceUsd) exit = 'TP_HIT';
  else if (price <= pos.slPriceUsd) exit = 'SL_HIT';
  else if (settings.trailingStopPercent > 0 && highPriceUsd > pos.buyPriceUsd) {
    const trail = highPriceUsd * (1 - settings.trailingStopPercent / 100);
    if (price <= trail && trail > pos.buyPriceUsd) exit = 'TRAILING_STOP';
  }
  if (exit) store.closePosition(positionId, exit).catch(() => {});
}

async function openPosition(
  coin: CoinData,
  amountUsd: number,
  opts: { tp: number; sl: number; decision?: AiDecision; reason: string }
): Promise<{ success: boolean; message: string }> {
  const store = useBotStore.getState();
  const { settings } = store;
  const live = !settings.paperTrading;
  const solPrice = store.solPriceUsd || SolPriceService.getCached();
  const priceUsd = coin.priceUsd || (coin.priceSol && solPrice ? coin.priceSol * solPrice : 0);
  if (!priceUsd) return { success: false, message: `${coin.symbol}: no price available.` };

  let position = BotService.createPosition({ ...coin, priceUsd }, { ...settings, buyAmountUsd: amountUsd, takeProfitPercent: opts.tp, stopLossPercent: opts.sl });
  position = { ...position, isLive: live, mint: isSolana(coin) ? mintOf(coin) : undefined, aiDecision: opts.decision, priceSource: (coin.source as BotPosition['priceSource']) || undefined };

  if (live) {
    const addr = settings.connectedWalletAddress!;
    store.log('tx', `[LIVE BUY] Sending swap for ${coin.symbol} ($${amountUsd} ≈ ${(amountUsd / (solPrice || 1)).toFixed(4)} SOL)...`, { coinSymbol: coin.symbol });
    const result = await TradeService.executeBuy({ ...coin, priceUsd }, amountUsd, settings, addr);
    if (!result.success) {
      store.log('warning', `[BUY FAILED] ${coin.symbol}: ${result.message}`, { coinSymbol: coin.symbol, txSignature: result.signature });
      useBotStore.setState({ latestToastNotification: { title: 'Buy failed', description: result.message, type: 'error', coinSymbol: coin.symbol } });
      return { success: false, message: result.message };
    }
    const fill = result.fillPriceUsd || priceUsd;
    const targets = BotService.calculateTargets(fill, opts.tp, opts.sl);
    position = {
      ...position,
      buyPriceUsd: fill,
      currentPriceUsd: fill,
      highPriceUsd: fill,
      amountUsd: result.usdSpent || amountUsd,
      tokensBought: result.tokensReceived || position.tokensBought,
      tokenAmountRaw: result.tokenAmountRaw,
      decimals: result.decimals,
      buyTxSignature: result.signature,
      tpPriceUsd: targets.tpPriceUsd,
      slPriceUsd: targets.slPriceUsd,
    };
    store.refreshWalletBalance();
  }

  useBotStore.setState((s) => ({
    walletBalance: live ? s.walletBalance : s.walletBalance - amountUsd,
    positions: [position, ...s.positions],
    latestToastNotification: {
      title: `${live ? 'LIVE ' : ''}BUY: ${coin.symbol}`,
      description: `$${position.amountUsd.toFixed(2)} @ $${position.buyPriceUsd.toPrecision(4)} (${opts.reason})${position.buyTxSignature ? ' - tx ' + position.buyTxSignature.slice(0, 8) : ''}`,
      type: 'buy',
      coinSymbol: coin.symbol,
    },
  }));

  if (settings.soundAlerts) AudioService.playSnipeSound();
  store.log(
    'buy',
    `[${live ? 'LIVE' : 'PAPER'} BUY] ${position.tokensBought.toLocaleString('en-US', { maximumFractionDigits: 0 })} ${coin.symbol} for $${position.amountUsd.toFixed(2)} @ $${position.buyPriceUsd.toPrecision(4)} | TP +${opts.tp}% SL -${opts.sl}% (${opts.reason})`,
    { coinSymbol: coin.symbol, chainId: coin.chainId, txSignature: position.buyTxSignature }
  );

  if (isSolana(coin)) {
    wsService.connect();
    wsService.subscribeTokenTrades([mintOf(coin)]);
  }

  return { success: true, message: `Bought ${coin.symbol} for $${position.amountUsd.toFixed(2)} (${live ? 'live' : 'paper'}).` };
}
