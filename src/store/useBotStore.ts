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
  LiveSignerKind,
  TokenTradeEvent,
} from '../types/bot';
import { BotService } from '../services/bot.service';
import { wsService } from '../services/websocket.service';
import { AudioService } from '../services/audio.service';
import { WalletService, WalletProviderType, DEFAULT_SOLANA_RPC, RPC_PROXY, resolveRpcUrl } from '../services/wallet.service';
import { TradeService, DryRunResult, LiveSigner, TOKEN_ACCOUNT_RENT_SOL } from '../services/trade.service';
import { HotWallet } from '../services/hotwallet.service';
import { PaperFillService } from '../services/paperfill.service';
import { SolPriceService } from '../services/solprice.service';
import { CoinService } from '../services/coin.service';
import { recordTradeForChart } from '../services/chart.service';
import { PumpFunService } from '../services/pumpfun.service';
import { BridgeService } from '../services/bridge.service';
import { DEFAULT_AI_MODEL, resolveAiModel } from '../lib/ai-models';
import { recordPriceTrail } from '../lib/price-trail';

type ExitReason = BotTradeHistory['exitReason'];

export interface BotToast {
  title: string;
  description: string;
  type: 'buy' | 'sell_tp' | 'sell_sl' | 'info' | 'error';
  coinSymbol?: string;
}

interface BotState {
  settings: BotSettings;
  /** Virtual USD balance used in paper-trading mode. */
  walletBalance: number;
  positions: BotPosition[];
  history: BotTradeHistory[];
  logs: BotLogEntry[];
  /** Newest coins seen by the scanner (stream + feed), newest first. */
  recentCoins: CoinData[];
  pendingTradeIds: string[];
  isWsConnected: boolean;
  wsLatencyMs: number;
  wsEventsPerMinute: number;
  solPriceUsd: number;
  latestToastNotification: BotToast | null;
  lastAiDecision: (AiDecision & { symbol: string; at: number }) | null;
  lastDryRun: (DryRunResult & { symbol: string; at: number }) | null;
  isDryRunning: boolean;
  /** In-browser bot wallet (address is public; `unlocked` means it can sign right now). */
  botWallet: { address: string | null; unlocked: boolean; solBalance: number | null; backedUp: boolean };
  walletDialogOpen: boolean;

  // lifecycle
  boot: () => void;
  updateSettings: (newSettings: Partial<BotSettings>) => void;

  // feed + execution
  ingestCoins: (coins: CoinData[], origin?: 'stream' | 'feed') => void;
  /** `targets` overrides the settings' TP / SL percentages for this one position (scanner signals). */
  manualSnipeCoin: (
    coin: CoinData,
    amountUsd?: number,
    reason?: string,
    targets?: { tp: number; sl: number; timeStopMinutes?: number }
  ) => Promise<{ success: boolean; message: string }>;
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
  setWalletDialogOpen: (open: boolean) => void;
  /** Re-reads the bot wallet's lock state and balance. */
  syncBotWallet: () => Promise<void>;
  /** Realized P&L since local midnight for the current execution mode. */
  getTodayRealizedPnl: () => number;

  // watchlist (Market tab; has no effect on trading)
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

const DEFAULT_SETTINGS: BotSettings = {
  buyAmountUsd: 25,
  takeProfitPercent: 60,
  stopLossPercent: 25,
  trailingStopPercent: 0,
  profitLockTriggerPercent: 30,
  profitLockPercent: 8,
  autoSell: true,
  maxPositions: 5,
  slippagePercent: 15,
  paperTrading: true,
  soundAlerts: true,
  solanaRpcUrl: DEFAULT_SOLANA_RPC,
  priorityFeeSol: 0.0005,
  phantomWalletConnected: false,
  connectedWalletAddress: null,
  solBalance: 0,
  walletType: null,
  whitelistedSymbols: [],
  aiGateEnabled: true,
  aiMinConfidence: 45,
  aiAdjustTargets: true,
  aiModel: DEFAULT_AI_MODEL,
  liveSigner: 'wallet',
  dailyLossLimitUsd: 100,
  scannerAutoBuy: false,
  scannerMode: 'strict',
  smartWallets: [],
  scanLaunches: true,
};

/** Liquid Solana token used by the live-pipeline test when the scanner has nothing yet. */
const PIPELINE_TEST_COIN: CoinData = {
  id: 'solana:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  name: 'Bonk',
  symbol: 'BONK',
  priceUsd: 0,
  priceChange24h: 0,
  fundamentals: { marketCap: 0, circulatingSupply: 0, volume24h: 0, tvl: 0 },
  chainId: 'solana',
  mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
};

const MAX_LOGS = 200;
const MAX_RECENT = 80;
const PRICE_POLL_MS = 6_000;
const WALLET_REFRESH_MS = 30_000;

let booted = false;
let pricePollTimer: ReturnType<typeof setInterval> | null = null;
let walletTimer: ReturnType<typeof setInterval> | null = null;

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
      settings: DEFAULT_SETTINGS,
      walletBalance: 1000,
      positions: [],
      history: [],
      logs: [
        {
          id: uid('log-init'),
          timestamp: nowTime(),
          type: 'info',
          message: 'CoinScope ready. Paper trading is on by default: press Start auto trade to begin, and switch to live under Settings when the results convince you.',
        },
      ],
      recentCoins: [],
      pendingTradeIds: [],
      isWsConnected: false,
      wsLatencyMs: 0,
      wsEventsPerMinute: 0,
      solPriceUsd: 0,
      latestToastNotification: null,
      lastAiDecision: null,
      lastDryRun: null,
      isDryRunning: false,
      botWallet: { address: null, unlocked: false, solBalance: null, backedUp: false },
      walletDialogOpen: false,

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
        wsService.subscribeMigrations();

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

        HotWallet.onChange(() => {
          get().syncBotWallet();
        });
        get().syncBotWallet();

        if (!walletTimer) {
          walletTimer = setInterval(() => get().refreshWalletBalance(), WALLET_REFRESH_MS);
        }

        // MCP bridge: lets external AI clients (Claude Desktop, Cursor, ...) read state and control the bot.
        BridgeService.start();
      },

      updateSettings: (newSettings) => {
        const prev = get().settings;
        set((state) => ({ settings: { ...state.settings, ...newSettings } }));
        if (newSettings.paperTrading !== undefined && newSettings.paperTrading !== prev.paperTrading) {
          get().log(
            newSettings.paperTrading ? 'info' : 'warning',
            newSettings.paperTrading
              ? 'Switched to PAPER trading (simulated fills).'
              : `Switched to LIVE trading - real Solana swaps signed by ${get().settings.liveSigner === 'bot' ? 'the bot wallet' : 'your wallet extension'}.`
          );
        }
        if (newSettings.solanaRpcUrl && newSettings.solanaRpcUrl !== prev.solanaRpcUrl) get().refreshWalletBalance();
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
        void origin;
      },

      manualSnipeCoin: async (coin, amountUsd, reason = 'manual', targets) => {
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
          if (!signerFor(settings.liveSigner)) return { success: false, message: signerMissingMessage(settings.liveSigner) };
          if (!isSolana(coin)) return { success: false, message: `Live execution supports Solana only (token is on ${coin.chainId}).` };
        }

        set((s) => ({ pendingTradeIds: [...s.pendingTradeIds, coin.id] }));
        try {
          return await openPosition(coin, amount, {
            tp: targets?.tp ?? settings.takeProfitPercent,
            sl: targets?.sl ?? settings.stopLossPercent,
            timeStopMinutes: targets?.timeStopMinutes,
            reason,
          });
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

          if (!pos.isLive) {
            // Paper exits pay the same price impact and fees a real sell would.
            const fill = await PaperFillService.sell(pos.coin, pos.tokensBought * (pct / 100), sellPriceUsd, get().settings, get().solPriceUsd || SolPriceService.getCached());
            if (fill.proceedsUsd !== undefined) {
              proceedsUsd = fill.proceedsUsd;
              sellPriceUsd = fill.priceUsd || sellPriceUsd;
            }
          }

          if (pos.isLive) {
            const signer = signerForAddress(pos.ownerAddress);
            if (!signer) {
              const msg = pos.ownerAddress
                ? `${pos.coin.symbol} is held by ${short(pos.ownerAddress)}. ${pos.ownerAddress === get().botWallet.address ? 'Unlock the bot wallet' : 'Connect that wallet'} to sell it.`
                : 'Connect the wallet that holds this position to sell it.';
              get().log('warning', `[SELL BLOCKED] ${msg}`, { coinSymbol: pos.coin.symbol });
              return { success: false, message: msg };
            }
            const result = await TradeService.executeSell(pos, pct, get().settings, signer);
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
            // The bot wallet can reclaim the emptied account's rent without a prompt; Phantom users
            // close empty accounts in Phantom instead of approving an extra transaction here.
            if (pct >= 100 && signer.kind === 'bot') {
              const mint = pos.mint || mintOf(pos.coin);
              const sameMintOpen = get().positions.some((p) => p.id !== pos.id && (p.mint || mintOf(p.coin)) === mint);
              if (mint && !sameMintOpen) void reclaimRent(pos.coin.symbol, mint, signer);
            }
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
            if (exitReason === 'TP_HIT' || exitReason === 'PROFIT_LOCK') AudioService.playTakeProfitSound();
            else if (exitReason === 'SL_HIT' || exitReason === 'TRAILING_STOP') AudioService.playStopLossSound();
          }

          const sign = pnlUsd >= 0 ? '+' : '';
          const label =
            exitReason === 'TP_HIT'
              ? 'TAKE PROFIT'
              : exitReason === 'SL_HIT'
              ? 'STOP LOSS'
              : exitReason === 'TRAILING_STOP'
              ? 'TRAILING STOP'
              : exitReason === 'PROFIT_LOCK'
              ? 'PROFIT LOCK'
              : exitReason === 'TIME_STOP'
              ? 'TIME STOP'
              : exitReason === 'AI_SELL'
              ? 'AI SELL'
              : 'MANUAL SELL';

          set((s) => ({
            walletBalance: pos.isLive ? s.walletBalance : s.walletBalance + proceedsUsd,
            positions: remaining ? s.positions.map((p) => (p.id === pos.id ? remaining : p)) : s.positions.filter((p) => p.id !== pos.id),
            history: [trade, ...s.history].slice(0, 500),
            latestToastNotification: {
              title: `${label}: ${pos.coin.symbol}`,
              description: `${pct}% sold for $${proceedsUsd.toFixed(2)} (${sign}${pnlPercent.toFixed(1)}%)${sellTx ? ' - tx ' + sellTx.slice(0, 8) : ''}`,
              type: exitReason === 'TP_HIT' || exitReason === 'PROFIT_LOCK' ? 'sell_tp' : exitReason === 'SL_HIT' || exitReason === 'TRAILING_STOP' ? 'sell_sl' : 'info',
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
          // The stream stays open: the launch watcher and the New Launches feed use it.
          if (get().settings.scannerAutoBuy && dailyLossReached()) announceDailyLossPause();

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
        // A token nobody trades sends no ticks, so time stops are also checked on this timer.
        positions.filter((p) => p.timeStopMinutes).forEach((p) => markToMarket(p.id, p.currentPriceUsd, p.priceSource));
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
        const dryAddress = signerFor(settings.liveSigner)?.address || (settings.phantomWalletConnected ? settings.connectedWalletAddress : null) || get().botWallet.address;
        if (!dryAddress) {
          const r = fail('Connect a wallet or create a bot wallet first - the dry run builds the swap for a real address.');
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
        // Nothing streamed yet: test against a long-lived liquid token so the check never depends on timing.
        if (!coin) coin = PIPELINE_TEST_COIN;
        const amount = amountUsd && amountUsd > 0 ? amountUsd : settings.buyAmountUsd;
        set({ isDryRunning: true });
        get().log('tx', `[DRY RUN] Building + simulating a $${amount} buy of ${coin.symbol} for ${short(dryAddress)} (no signature)`, { coinSymbol: coin.symbol });
        try {
          const result = await TradeService.dryRunBuy(coin, amount, settings, dryAddress);
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
          settings: {
            ...s.settings,
            phantomWalletConnected: false,
            connectedWalletAddress: null,
            solBalance: 0,
            walletType: null,
            paperTrading: s.settings.liveSigner === 'bot' ? s.settings.paperTrading : true,
          },
        }));
        get().log(
          'info',
          get().settings.liveSigner === 'bot' ? '[WALLET] Extension disconnected. Live trades keep using the bot wallet.' : '[WALLET] Disconnected. Bot switched back to paper trading.'
        );
      },

      refreshWalletBalance: async () => {
        const { connectedWalletAddress, solanaRpcUrl, phantomWalletConnected } = get().settings;
        const botAddress = get().botWallet.address;
        await Promise.all([
          connectedWalletAddress && phantomWalletConnected
            ? WalletService.getSolBalance(connectedWalletAddress, solanaRpcUrl).then((bal) => {
                if (bal !== null) set((s) => ({ settings: { ...s.settings, solBalance: bal } }));
              })
            : null,
          botAddress
            ? WalletService.getSolBalance(botAddress, solanaRpcUrl).then((bal) => {
                if (bal !== null) set((s) => ({ botWallet: { ...s.botWallet, solBalance: bal } }));
              })
            : null,
        ]);
      },

      setWalletDialogOpen: (open) => set({ walletDialogOpen: open }),

      syncBotWallet: async () => {
        const address = HotWallet.address();
        const unlocked = HotWallet.isUnlocked();
        const backedUp = HotWallet.isBackedUp();
        set((s) => ({ botWallet: { address, unlocked, backedUp, solBalance: address === s.botWallet.address ? s.botWallet.solBalance : null } }));
        if (!address) return;
        const bal = await WalletService.getSolBalance(address, get().settings.solanaRpcUrl);
        if (bal !== null && get().botWallet.address === address) set((s) => ({ botWallet: { ...s.botWallet, solBalance: bal } }));
      },

      getTodayRealizedPnl: () => {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const live = !get().settings.paperTrading;
        return get()
          .history.filter((h) => h.soldAt >= start.getTime() && h.isLive === live)
          .reduce((sum, h) => sum + h.pnlUsd, 0);
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
        const running = s.settings.scannerAutoBuy;
        return {
          running,
          // Kept for MCP clients that read the old field: true while auto trade is on.
          isActive: running,
          pausedForToday: running && dailyLossReached(),
          executionMode: s.settings.paperTrading ? 'paper' : 'live',
          wallet: {
            connected: s.settings.phantomWalletConnected,
            address: connectedWalletAddress,
            walletType: s.settings.walletType,
            solBalance: s.settings.solBalance,
            solPriceUsd: s.solPriceUsd,
            paperBalanceUsd: s.walletBalance,
          },
          botWallet: { ...s.botWallet },
          liveSigner: s.settings.liveSigner,
          liveReady: s.settings.paperTrading ? null : !!signerFor(s.settings.liveSigner),
          todayRealizedPnlUsd: Number(s.getTodayRealizedPnl().toFixed(2)),
          aiModel: s.settings.aiModel,
          autoTrade: { on: s.settings.scannerAutoBuy, mode: s.settings.scannerMode, aiGate: s.settings.aiGateEnabled },
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
      }),
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<BotState>;
        return {
          ...current,
          ...p,
          settings: {
            ...DEFAULT_SETTINGS,
            ...stripLegacySettings(p.settings),
            phantomWalletConnected: false,
            // Older sessions persisted the public mainnet URL, which now refuses browser requests.
            solanaRpcUrl: resolveRpcUrl(p.settings?.solanaRpcUrl) === RPC_PROXY ? DEFAULT_SOLANA_RPC : p.settings!.solanaRpcUrl,
            aiModel: resolveAiModel(p.settings?.aiModel),
          },
        };
      },
    }
  )
);

/* ------------------------------------------------------------------ */
/* Internal helpers (need access to the store singleton)               */
/* ------------------------------------------------------------------ */

/**
 * When the profit lock arms for a position, and how much profit it keeps.
 *
 * The setting alone (default +30%) never armed on scanner trades: their targets are usually
 * +10-25%, so a trade could run most of the way to its target and still close at the stop for a
 * loss. The lock now arms at half the way to the position's own target (never under +8% unless the
 * setting is lower, never later than the setting) and keeps the set profit, at least +3% over cost
 * (the sell's fees), so a
 * trade that got that far closes in profit. 0 in the setting still turns it off.
 */
function profitLockLevels(pos: BotPosition, settings: BotSettings): { triggerPercent: number; lockPercent: number } | null {
  if (!(settings.profitLockTriggerPercent > 0)) return null;
  const tpPercent = pos.buyPriceUsd > 0 && pos.tpPriceUsd > 0 ? (pos.tpPriceUsd / pos.buyPriceUsd - 1) * 100 : settings.takeProfitPercent;
  const triggerPercent = Math.round(Math.min(settings.profitLockTriggerPercent, Math.max(8, tpPercent * 0.5)) * 10) / 10;
  // The user's locked profit, at least +3% for the sell's fees, and always 2 points under the trigger
  // so the raised stop sits below the price that armed it.
  const lockPercent = Math.round(Math.max(0, Math.min(Math.max(3, settings.profitLockPercent), triggerPercent - 2)) * 10) / 10;
  return { triggerPercent, lockPercent };
}

function markToMarket(positionId: string, price: number, source: BotPosition['priceSource']) {
  if (!price || price <= 0) return;
  const store = useBotStore.getState();
  const pos = store.positions.find((p) => p.id === positionId);
  if (!pos || store.pendingTradeIds.includes(pos.id)) return;

  const currentVal = pos.tokensBought * price;
  const pnlUsd = currentVal - pos.amountUsd;
  const pnlPercent = pos.amountUsd > 0 ? (pnlUsd / pos.amountUsd) * 100 : 0;
  const highPriceUsd = Math.max(pos.highPriceUsd, price);
  const highAt = price > pos.highPriceUsd ? Date.now() : pos.highAt ?? pos.boughtAt;
  recordPriceTrail(pos.id, price);
  const { settings } = store;

  // Profit lock: once the position has been up the trigger %, raise its stop above cost (amountUsd
  // includes the buy's fees) so a trade that was already winning cannot be closed at a loss.
  let { slPriceUsd, profitLocked } = pos;
  const costPriceUsd = pos.tokensBought > 0 ? pos.amountUsd / pos.tokensBought : pos.buyPriceUsd;
  const lock = profitLockLevels(pos, settings);
  if (lock && highPriceUsd >= costPriceUsd * (1 + lock.triggerPercent / 100)) {
    const lockPriceUsd = costPriceUsd * (1 + lock.lockPercent / 100);
    if (lockPriceUsd > slPriceUsd) {
      slPriceUsd = lockPriceUsd;
      profitLocked = true;
      store.log('info', `[PROFIT LOCK] ${pos.coin.symbol} reached +${lock.triggerPercent}%: stop raised to $${lockPriceUsd.toPrecision(4)} (+${lock.lockPercent}% over cost).`, { coinSymbol: pos.coin.symbol });
    }
  }

  useBotStore.setState((s) => ({
    positions: s.positions.map((p) =>
      p.id === positionId ? { ...p, currentPriceUsd: price, pnlUsd, pnlPercent, highPriceUsd, highAt, slPriceUsd, profitLocked, lastPriceUpdateAt: Date.now(), priceSource: source } : p
    ),
  }));

  if (!settings.autoSell) return;
  let exit: ExitReason | null = null;
  if (price >= pos.tpPriceUsd) exit = 'TP_HIT';
  else if (price <= slPriceUsd) exit = profitLocked ? 'PROFIT_LOCK' : 'SL_HIT';
  else if (settings.trailingStopPercent > 0 && highPriceUsd > pos.buyPriceUsd) {
    const trail = highPriceUsd * (1 - settings.trailingStopPercent / 100);
    if (price <= trail && trail > pos.buyPriceUsd) exit = 'TRAILING_STOP';
  }
  // Launch momentum is spent once the token stops printing new highs (skill: 15-20 min).
  if (!exit && pos.timeStopMinutes && Date.now() - highAt > pos.timeStopMinutes * 60_000) exit = 'TIME_STOP';
  if (!exit) return;
  // A failed exit (rejected prompt, locked wallet, RPC hiccup) retries after a pause instead of on every tick.
  if ((exitRetryAt.get(positionId) || 0) > Date.now()) return;
  store
    .closePosition(positionId, exit)
    .then((r) => {
      if (r.success) exitRetryAt.delete(positionId);
      else exitRetryAt.set(positionId, Date.now() + EXIT_RETRY_MS);
    })
    .catch(() => exitRetryAt.set(positionId, Date.now() + EXIT_RETRY_MS));
}

/** Closes the empty token account a full sell leaves behind, returning its rent to the signer. */
async function reclaimRent(symbol: string, mint: string, signer: LiveSigner) {
  await new Promise((r) => setTimeout(r, 2500)); // let the sell's balance change reach 'confirmed'
  const store = useBotStore.getState();
  const r = await TradeService.closeEmptyTokenAccounts(signer.address, mint, store.settings.solanaRpcUrl, signer);
  if (r.closed > 0) {
    store.log('tx', `[RENT] Closed ${r.closed} empty ${symbol} token account(s): ~${(r.closed * TOKEN_ACCOUNT_RENT_SOL).toFixed(4)} SOL back to the wallet.`, {
      coinSymbol: symbol,
      txSignature: r.signature,
    });
    store.refreshWalletBalance();
  } else if (r.error) {
    store.log('warning', `[RENT] Could not close the empty ${symbol} token account: ${r.error}`, { coinSymbol: symbol, txSignature: r.signature });
  }
}

const EXIT_RETRY_MS = 20_000;
const exitRetryAt = new Map<string, number>();

const short = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;

/** Signer for live trades of the given kind, or null when it cannot sign right now. */
function signerFor(kind: LiveSignerKind): LiveSigner | null {
  const s = useBotStore.getState();
  if (kind === 'bot') {
    const address = HotWallet.unlockedAddress();
    if (!address) return null;
    return {
      kind: 'bot',
      address,
      solBalance: s.botWallet.solBalance ?? undefined,
      signAndSend: (tx) => HotWallet.signAndSend(tx, useBotStore.getState().settings.solanaRpcUrl),
    };
  }
  const { phantomWalletConnected, connectedWalletAddress, solBalance } = s.settings;
  if (!phantomWalletConnected || !connectedWalletAddress) return null;
  return {
    kind: 'wallet',
    address: connectedWalletAddress,
    solBalance,
    signAndSend: (tx) => WalletService.signAndSendTransaction(tx, { skipPreflight: false, maxRetries: 3 }),
  };
}

/** Sells must be signed by whichever wallet holds the tokens, regardless of the current signer setting. */
function signerForAddress(owner?: string): LiveSigner | null {
  if (!owner) return signerFor(useBotStore.getState().settings.liveSigner);
  const candidates = [signerFor('bot'), signerFor('wallet')];
  return candidates.find((c) => c?.address === owner) || null;
}

function signerMissingMessage(kind: LiveSignerKind): string {
  if (kind === 'bot') {
    return HotWallet.hasVault() ? 'the bot wallet is locked - unlock it under Bot > Settings.' : 'no bot wallet yet - create one under Bot > Settings.';
  }
  return 'no wallet connected - connect Phantom or Solflare.';
}

function dailyLossReached(): boolean {
  const s = useBotStore.getState();
  const limit = s.settings.dailyLossLimitUsd;
  return limit > 0 && s.getTodayRealizedPnl() <= -limit;
}

/** Day (local) for which the daily-loss pause was already announced, so it is said once. */
let lossPauseAnnouncedFor = '';

/**
 * Auto trade stays switched on; it only stops opening positions until local midnight. Exits of open
 * positions keep running.
 */
function announceDailyLossPause() {
  const day = new Date().toDateString();
  if (lossPauseAnnouncedFor === day) return;
  lossPauseAnnouncedFor = day;
  const s = useBotStore.getState();
  const msg = `Daily loss limit hit: $${s.getTodayRealizedPnl().toFixed(2)} realized today (limit -$${s.settings.dailyLossLimitUsd}). No new entries until tomorrow; open positions are still managed.`;
  s.log('warning', msg);
  useBotStore.setState({ latestToastNotification: { title: 'Auto trade paused for today', description: msg, type: 'error' } });
}

/** Settings of the retired launch sniper, dropped from saved sessions. */
const LEGACY_SETTING_KEYS = [
  'minLiquidityUsd',
  'maxRiskLevel',
  'minAiScore',
  'targetChain',
  'launchPlatform',
  'scanSpeed',
  'minBondingCurvePercent',
  'maxTokenAgeMinutes',
  'targetOnlyMode',
  'preset',
];

function stripLegacySettings(saved?: Partial<BotSettings>): Partial<BotSettings> {
  const out: Record<string, unknown> = { ...(saved || {}) };
  LEGACY_SETTING_KEYS.forEach((k) => delete out[k]);
  return out as Partial<BotSettings>;
}

/** True once today's realized loss reached the limit (auto trade holds new entries). */
export function isDailyLossReached(): boolean {
  return dailyLossReached();
}

async function openPosition(
  coin: CoinData,
  amountUsd: number,
  opts: { tp: number; sl: number; timeStopMinutes?: number; decision?: AiDecision; reason: string }
): Promise<{ success: boolean; message: string }> {
  const store = useBotStore.getState();
  const { settings } = store;
  const live = !settings.paperTrading;
  const solPrice = store.solPriceUsd || SolPriceService.getCached();
  const priceUsd = coin.priceUsd || (coin.priceSol && solPrice ? coin.priceSol * solPrice : 0);
  if (!priceUsd) return { success: false, message: `${coin.symbol}: no price available.` };

  let position = BotService.createPosition({ ...coin, priceUsd }, { ...settings, buyAmountUsd: amountUsd, takeProfitPercent: opts.tp, stopLossPercent: opts.sl });
  position = {
    ...position,
    isLive: live,
    mint: isSolana(coin) ? mintOf(coin) : undefined,
    aiDecision: opts.decision,
    priceSource: (coin.source as BotPosition['priceSource']) || undefined,
    timeStopMinutes: opts.timeStopMinutes,
  };

  if (!live) {
    // Paper entries pay the price impact and fees a real buy of this size would.
    const fill = await PaperFillService.buy(coin, amountUsd, priceUsd, settings, solPrice);
    const targets = BotService.calculateTargets(fill.priceUsd, opts.tp, opts.sl);
    const pnlUsd = fill.tokens * priceUsd - amountUsd;
    position = {
      ...position,
      buyPriceUsd: fill.priceUsd,
      currentPriceUsd: priceUsd,
      highPriceUsd: fill.priceUsd,
      tokensBought: fill.tokens,
      pnlUsd,
      pnlPercent: amountUsd > 0 ? (pnlUsd / amountUsd) * 100 : 0,
      tpPriceUsd: targets.tpPriceUsd,
      slPriceUsd: targets.slPriceUsd,
    };
    if (Math.abs(fill.costPercent) >= 0.05) {
      store.log('info', `[PAPER FILL] ${coin.symbol} @ $${fill.priceUsd.toPrecision(4)}: ${fill.costPercent.toFixed(2)}% over last price (${fill.source === 'jupiter' ? 'Jupiter quote' : 'pool-depth model'}, fees included).`, { coinSymbol: coin.symbol });
    }
  }

  if (live) {
    const signer = signerFor(settings.liveSigner);
    if (!signer) return { success: false, message: signerMissingMessage(settings.liveSigner) };
    store.log(
      'tx',
      `[LIVE BUY] Sending swap for ${coin.symbol} ($${amountUsd} ≈ ${(amountUsd / (solPrice || 1)).toFixed(4)} SOL) from ${signer.kind === 'bot' ? 'bot wallet' : 'wallet'} ${short(signer.address)}...`,
      { coinSymbol: coin.symbol }
    );
    const result = await TradeService.executeBuy({ ...coin, priceUsd }, amountUsd, settings, signer);
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
      ownerAddress: signer.address,
      signerKind: signer.kind,
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
