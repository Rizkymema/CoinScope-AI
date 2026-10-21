import { CoinData } from './coin';

export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';
export type ExecutionMode = 'paper' | 'live';
/** 'wallet' = Phantom/Solflare signs (one approval per trade); 'bot' = the in-browser bot wallet signs unattended. */
export type LiveSignerKind = 'wallet' | 'bot';

/** Decision returned by the AI gate (or the heuristic fallback when no API key is configured). */
export interface AiDecision {
  action: 'buy' | 'skip';
  /** 0 - 100 */
  confidence: number;
  reason: string;
  suggestedTakeProfitPercent?: number;
  suggestedStopLossPercent?: number;
  riskLevel?: RiskLevel;
  source: 'ai' | 'heuristic';
  model?: string;
}

/**
 * Settings of the one trading bot (auto trade). Auto trade buys with each signal's own stop and
 * target; takeProfitPercent / stopLossPercent are the defaults for manual buys from the Market tab
 * and the copilot.
 */
export interface BotSettings {
  buyAmountUsd: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  /** 0 disables the trailing stop. Otherwise the position closes when price falls X% from its high. */
  trailingStopPercent: number;
  /**
   * 0 disables the profit lock. Once a position has been up this many percent over its cost,
   * its stop-loss is raised to cost + profitLockPercent so a winning trade cannot close at a loss.
   */
  profitLockTriggerPercent: number;
  /** Profit the raised stop keeps, above cost. Covers the sell's fees and slippage. */
  profitLockPercent: number;
  autoSell: boolean;
  maxPositions: number;
  slippagePercent: number;
  /** true = simulated fills with a virtual USD balance; false = real on-chain swaps through the connected wallet. */
  paperTrading: boolean;
  soundAlerts: boolean;
  solanaRpcUrl: string;
  /** Priority fee (in SOL) attached to live Solana swaps. */
  priorityFeeSol: number;
  phantomWalletConnected: boolean;
  connectedWalletAddress: string | null;
  solBalance: number;
  walletType: 'phantom' | 'solflare' | null;
  /** Watchlist on the Market tab. It does not affect what auto trade buys. */
  whitelistedSymbols: string[];
  /** Ask Claude before every automatic buy. */
  aiGateEnabled: boolean;
  /** Minimum AI confidence (0-100) required for the gate to approve a buy. */
  aiMinConfidence: number;
  /** Let the AI override TP / SL with its suggested values. */
  aiAdjustTargets: boolean;
  /** Claude model id used for the gate, the scorecard and the copilot (see lib/ai-models.ts). */
  aiModel: string;
  /** Which wallet signs live trades. */
  liveSigner: LiveSignerKind;
  /** Pause the auto-bot once today's realized loss reaches this many USD. 0 disables the limit. */
  dailyLossLimitUsd: number;
  /**
   * Auto trade on/off - the bot's one switch. While on, Ready signals that scored at least the
   * entry threshold and passed the sell-back quote are bought one at a time, within maxPositions
   * and the daily loss limit. Off by default.
   */
  scannerAutoBuy: boolean;
  /** 'simple' also buys 5m momentum breakouts as they happen; 'strict' waits for retests and pullbacks. */
  scannerMode: 'strict' | 'simple';
  /**
   * Wallets of traders worth following (KOLs, leaderboard accounts). The scanner adds the tokens
   * they hold to its candidates and shows how many of them hold each signal.
   */
  smartWallets: string[];
  /**
   * Watch every new Pump.fun launch for its first 30 minutes and let auto trade buy the ones that
   * draw buyers fast, pass the holder checks and dip on RSI (the launch watcher).
   */
  scanLaunches: boolean;
}

export interface BotPosition {
  id: string;
  coin: CoinData;
  buyPriceUsd: number;
  currentPriceUsd: number;
  amountUsd: number;
  tokensBought: number;
  boughtAt: number;
  pnlUsd: number;
  pnlPercent: number;
  highPriceUsd: number;
  status: 'OPEN' | 'CLOSED_TP' | 'CLOSED_SL' | 'CLOSED_MANUAL';
  tpPriceUsd: number;
  slPriceUsd: number;
  /** Set once the profit lock has raised slPriceUsd above the position's cost. */
  profitLocked?: boolean;
  /** Close the position when it has made no new high for this many minutes (new launches). */
  timeStopMinutes?: number;
  /** When highPriceUsd was last raised. */
  highAt?: number;
  /** true when the position was opened by a real on-chain swap. */
  isLive: boolean;
  /** Solana mint address (live positions). */
  mint?: string;
  /** Raw token amount held (smallest units) for live positions. */
  tokenAmountRaw?: string;
  decimals?: number;
  buyTxSignature?: string;
  sellTxSignature?: string;
  /** Live positions: the wallet that holds the tokens, so the sell is signed by the same wallet. */
  ownerAddress?: string;
  signerKind?: LiveSignerKind;
  aiDecision?: AiDecision;
  lastPriceUpdateAt?: number;
  priceSource?: 'pumpportal' | 'dexscreener' | 'gecko' | 'pumpfun';
}

export interface BotLogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'buy' | 'sell' | 'warning' | 'skip' | 'ai' | 'tx';
  message: string;
  coinSymbol?: string;
  chainId?: string;
  txSignature?: string;
}

export interface BotTradeHistory {
  id: string;
  coinSymbol: string;
  coinName: string;
  chainId?: string;
  buyPriceUsd: number;
  sellPriceUsd: number;
  amountUsd: number;
  pnlUsd: number;
  pnlPercent: number;
  boughtAt: number;
  soldAt: number;
  exitReason: 'TP_HIT' | 'SL_HIT' | 'TRAILING_STOP' | 'PROFIT_LOCK' | 'TIME_STOP' | 'MANUAL_SELL' | 'AI_SELL';
  isLive: boolean;
  buyTxSignature?: string;
  sellTxSignature?: string;
}

export interface BotStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalProfitUsd: number;
  totalInvestedUsd: number;
}

/** Real-time trade tick coming from the PumpPortal WebSocket stream. */
export interface TokenTradeEvent {
  mint: string;
  txType: 'buy' | 'sell' | string;
  solAmount: number;
  tokenAmount: number;
  priceSol: number;
  marketCapSol: number;
  vSolInBondingCurve?: number;
  vTokensInBondingCurve?: number;
  pool?: string;
  traderPublicKey?: string;
  signature?: string;
  timestamp: number;
}
