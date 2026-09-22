import { CoinData } from './coin';

export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';
export type ChainOption = 'all' | 'solana' | 'ethereum' | 'base' | 'bsc' | 'arbitrum';

export type LaunchPlatform = 'all' | 'pumpfun' | 'dexscreener';
export type ScanSpeed = 'websocket' | '1s' | '3s' | '5s';
export type ExecutionMode = 'paper' | 'live';
export type StrategyPreset = 'conservative' | 'balanced' | 'aggressive' | 'custom';

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

export interface BotSettings {
  buyAmountUsd: number;
  minLiquidityUsd: number;
  maxRiskLevel: RiskLevel;
  minAiScore: number;
  targetChain: ChainOption;
  launchPlatform: LaunchPlatform;
  scanSpeed: ScanSpeed;
  minBondingCurvePercent: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  /** 0 disables the trailing stop. Otherwise the position closes when price falls X% from its high. */
  trailingStopPercent: number;
  autoSell: boolean;
  maxPositions: number;
  slippagePercent: number;
  /** true = simulated fills with a virtual USD balance; false = real on-chain swaps through the connected wallet. */
  paperTrading: boolean;
  maxTokenAgeMinutes: number;
  soundAlerts: boolean;
  solanaRpcUrl: string;
  /** Priority fee (in SOL) attached to live Solana swaps. */
  priorityFeeSol: number;
  phantomWalletConnected: boolean;
  connectedWalletAddress: string | null;
  solBalance: number;
  walletType: 'phantom' | 'solflare' | null;
  targetOnlyMode: boolean;
  whitelistedSymbols: string[];
  /** Ask the AI advisor before every automatic buy. */
  aiGateEnabled: boolean;
  /** Minimum AI confidence (0-100) required for the gate to approve a buy. */
  aiMinConfidence: number;
  /** Let the AI override TP / SL with its suggested values. */
  aiAdjustTargets: boolean;
  /** Which risk preset the filters came from ('custom' once the user edits a field). */
  preset: StrategyPreset;
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
  /** true when the position was opened by a real on-chain swap. */
  isLive: boolean;
  /** Solana mint address (live positions). */
  mint?: string;
  /** Raw token amount held (smallest units) for live positions. */
  tokenAmountRaw?: string;
  decimals?: number;
  buyTxSignature?: string;
  sellTxSignature?: string;
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
  exitReason: 'TP_HIT' | 'SL_HIT' | 'TRAILING_STOP' | 'MANUAL_SELL' | 'AI_SELL';
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
