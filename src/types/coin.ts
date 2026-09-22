export interface CoinFundamental {
  marketCap: number;
  circulatingSupply: number;
  volume24h: number;
  tvl?: number;
}

export interface AIScoreBreakdown {
  fundamental: number;
  technical: number;
  sentiment: number;
  risk: number;
}

export interface AIRiskProtocol {
  flags: string[];
  level: "Low" | "Medium" | "High" | "Critical";
}

export interface CoinAnalysis { // AI Score object
  symbol: string;
  score: number;
  category: "Buy" | "Watchlist" | "Hold" | "Avoid";
  analysis: string;
  risk_protocol: AIRiskProtocol;
  breakdown: AIScoreBreakdown;
  generated_at: string;
}

export interface CoinData {
  id: string;
  name: string;
  symbol: string;
  priceUsd: number;
  priceChange24h: number;
  priceChange5m?: number;
  priceChange1h?: number;
  priceChange6h?: number;
  fundamentals: CoinFundamental;
  imageUrl?: string;
  headerUrl?: string;
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  url?: string;
  createdAt?: number;
  txns24h?: { buys: number; sells: number };
  websites?: { label: string; url: string }[];
  socials?: { type: string; url: string }[];
  isPumpFun?: boolean;
  bondingCurve?: number;
  pumpFunUrl?: string;
  /** Solana mint / token contract address (base token). */
  mint?: string;
  /** Where this coin record came from. */
  source?: 'pumpportal' | 'pumpfun' | 'dexscreener' | 'gecko';
  /** Price denominated in SOL (Pump.fun bonding-curve tokens). */
  priceSol?: number;
  /** Metaplex metadata URI (Pump.fun tokens) - used to lazily resolve the image. */
  metadataUri?: string;
  /** Pool / launchpad type reported by the stream (pump, pump-amm, raydium, bonk, ...). */
  poolType?: string;
  description?: string;
  /** True when the token has migrated off the bonding curve. */
  graduated?: boolean;
}
