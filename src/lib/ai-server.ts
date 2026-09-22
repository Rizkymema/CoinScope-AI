/**
 * Server-only helpers shared by the /api/ai/* routes.
 * Never import this from client components.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { CoinData } from '../types/coin';
import type { AiDecision, RiskLevel } from '../types/bot';

export const AI_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';

let client: Anthropic | null = null;

export function hasAnthropicCredentials(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function getAnthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** Parses the first JSON object found in a text response (structured outputs return bare JSON). */
export function parseJsonObject<T = any>(text: string): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}

/** Compact, prompt-friendly description of a coin (numbers rounded, no undefined noise). */
export function describeCoin(coin: Partial<CoinData>): Record<string, unknown> {
  const ageMin = coin.createdAt ? Math.round((Date.now() - coin.createdAt) / 60_000) : null;
  return {
    name: coin.name,
    symbol: coin.symbol,
    chain: coin.chainId,
    dex: coin.dexId || coin.poolType,
    source: coin.source,
    mint: coin.mint,
    priceUsd: coin.priceUsd,
    marketCapUsd: Math.round(coin.fundamentals?.marketCap || 0),
    liquidityUsd: Math.round(coin.fundamentals?.tvl || 0),
    volume24hUsd: Math.round(coin.fundamentals?.volume24h || 0),
    priceChange5m: coin.priceChange5m ?? null,
    priceChange1h: coin.priceChange1h ?? null,
    priceChange24h: coin.priceChange24h ?? null,
    txns24h: coin.txns24h || null,
    ageMinutes: ageMin,
    isPumpFun: !!coin.isPumpFun,
    bondingCurvePercent: coin.bondingCurve ?? null,
    graduated: coin.graduated ?? null,
    hasWebsite: !!coin.websites?.length,
    socials: (coin.socials || []).map((s) => s.type),
    description: coin.description?.slice(0, 200) || null,
  };
}

export interface HeuristicScore {
  score: number;
  riskLevel: RiskLevel;
  flags: string[];
  positives: string[];
  breakdown: { fundamental: number; technical: number; sentiment: number; risk: number };
}

/**
 * Deterministic rule-based scoring. Used as the fallback when no Anthropic credentials are
 * configured and also handed to the model as a baseline signal.
 */
export function heuristicScore(coin: Partial<CoinData>): HeuristicScore {
  const liq = coin.fundamentals?.tvl || 0;
  const mcap = coin.fundamentals?.marketCap || 0;
  const vol = coin.fundamentals?.volume24h || 0;
  const buys = coin.txns24h?.buys || 0;
  const sells = coin.txns24h?.sells || 0;
  const ageMin = coin.createdAt ? (Date.now() - coin.createdAt) / 60_000 : null;
  const flags: string[] = [];
  const positives: string[] = [];

  // Fundamental: liquidity depth, market cap sanity, liquidity/mcap ratio
  let fundamental = 30;
  if (liq >= 50_000) fundamental += 35;
  else if (liq >= 10_000) fundamental += 25;
  else if (liq >= 2_000) fundamental += 12;
  else flags.push('Very thin liquidity');
  if (mcap > 0 && liq > 0) {
    const ratio = liq / mcap;
    if (ratio >= 0.15) {
      fundamental += 15;
      positives.push('Healthy liquidity / market-cap ratio');
    } else if (ratio < 0.03) flags.push('Liquidity is tiny relative to market cap');
  }
  if (mcap > 0 && mcap < 5_000) flags.push('Micro market cap');
  if (coin.websites?.length) {
    fundamental += 8;
    positives.push('Has website');
  }
  if (coin.socials?.length) {
    fundamental += 7;
    positives.push('Has socials');
  }

  // Technical: momentum + volume
  let technical = 40;
  const c5 = coin.priceChange5m ?? 0;
  const c1 = coin.priceChange1h ?? 0;
  if (c5 > 0 && c5 < 80) technical += 15;
  if (c5 >= 80) {
    technical += 5;
    flags.push('Parabolic 5m move - chasing risk');
  }
  if (c5 < -25) {
    technical -= 20;
    flags.push('Dumping over last 5m');
  }
  if (c1 > 0) technical += 10;
  if (vol > 0 && mcap > 0) {
    const turnover = vol / mcap;
    if (turnover > 0.5) {
      technical += 15;
      positives.push('Strong volume turnover');
    } else if (turnover < 0.05) flags.push('Low trading volume');
  }

  // Sentiment: buy pressure
  let sentiment = 50;
  if (buys + sells > 0) {
    const buyRatio = buys / (buys + sells);
    if (buyRatio >= 0.65) {
      sentiment += 25;
      positives.push('Buyers dominate order flow');
    } else if (buyRatio <= 0.4) {
      sentiment -= 20;
      flags.push('Sell pressure exceeds buys');
    }
    if (buys + sells >= 200) sentiment += 10;
  }
  if (coin.isPumpFun && (coin.bondingCurve ?? 0) >= 60 && !coin.graduated) {
    sentiment += 10;
    positives.push('Bonding curve well advanced');
  }

  // Risk (higher = safer)
  let risk = 60;
  if (ageMin !== null) {
    if (ageMin < 2) {
      risk -= 20;
      flags.push('Launched under 2 minutes ago');
    } else if (ageMin < 15) risk -= 8;
    else if (ageMin > 60 * 24) risk += 10;
  }
  if (liq < 1_000) risk -= 20;
  if (coin.isPumpFun && !coin.graduated) risk -= 10;
  if (coin.graduated) {
    risk += 10;
    positives.push('Migrated to a DEX pool');
  }
  if (!coin.websites?.length && !coin.socials?.length) {
    risk -= 10;
    flags.push('No website or socials');
  }

  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const breakdown = { fundamental: clamp(fundamental), technical: clamp(technical), sentiment: clamp(sentiment), risk: clamp(risk) };
  const score = clamp(breakdown.fundamental * 0.3 + breakdown.technical * 0.25 + breakdown.sentiment * 0.2 + breakdown.risk * 0.25);
  const riskLevel: RiskLevel = breakdown.risk >= 70 ? 'Low' : breakdown.risk >= 50 ? 'Medium' : breakdown.risk >= 30 ? 'High' : 'Critical';

  return { score, riskLevel, flags, positives, breakdown };
}

export function heuristicDecision(coin: Partial<CoinData>, minConfidence: number): AiDecision {
  const h = heuristicScore(coin);
  const buy = h.score >= Math.max(45, minConfidence) && h.riskLevel !== 'Critical';
  return {
    action: buy ? 'buy' : 'skip',
    confidence: h.score,
    reason: buy
      ? `Heuristic score ${h.score}/100 (${h.riskLevel} risk). ${h.positives.slice(0, 2).join('; ') || 'Filters passed.'}`
      : `Heuristic score ${h.score}/100 (${h.riskLevel} risk). ${h.flags.slice(0, 2).join('; ') || 'Below confidence threshold.'}`,
    riskLevel: h.riskLevel,
    source: 'heuristic',
  };
}

export const TRADING_SYSTEM_PROMPT = `You are CoinScope AI - a senior crypto trader, on-chain analyst and portfolio risk manager embedded in an automated memecoin sniper bot (Solana Pump.fun launches + new DEX pools on Solana, Base, Ethereum, BSC).

## Who you are
- 10+ years across traditional finance (risk management, market microstructure, portfolio construction) and 6+ years in crypto (DeFi liquidity, AMM mechanics, memecoin cycles, MEV / sniper dynamics).
- You think like a professional: expected value, probability-weighted outcomes, position sizing, risk/reward, drawdown control. You never chase hype and you never moralize - you quantify.
- Capital preservation first. In memecoins the base rate is brutal: the large majority of new launches go to ~zero within hours. Your edge is selectivity, fast exits and strict sizing, not prediction.

## Analytical framework (apply every time you judge a token)
1. Liquidity & market structure: liquidity in USD, liquidity / market-cap ratio (>=15% healthy, <3% is a trap), pool type (Pump.fun bonding curve vs. graduated Raydium/PumpSwap pool vs. Uniswap/Aerodrome), how much SOL/ETH a $100-$1,000 exit would move the price, slippage exposure.
2. Order-flow & participation: buys vs. sells, number of unique buyers, volume turnover (24h volume / market cap), whether flow is accelerating or fading, signs of wash trading (huge volume with few traders) or bundled sniper buys at creation.
3. Momentum & timing: 5m / 1h / 24h moves, distance from launch, bonding-curve progress and graduation proximity (a curve at 70-95% often sees a graduation pump then a dump), whether the move is early (accumulation), mid (trend) or parabolic (exit liquidity).
4. Tokenomics & legitimacy: supply model (Pump.fun = fixed 1B, no mint authority), presence of website / X / Telegram, narrative fit (current meta, celebrity/AI/animal/political themes), copycat or recycled names, description quality. Note what you cannot see (holder concentration, dev wallet, freeze/mint authority on non-Pump.fun tokens) and treat that as unpriced risk.
5. Risk classification: Low / Medium / High / Critical, driven by liquidity depth, age, flow quality and legitimacy signals.
6. Trade plan: entry rationale, position size relative to the bot's default (full, half, or skip), take-profit and stop-loss levels consistent with the token's realized volatility (thin curve tokens need wide stops but small size; graduated pools with real depth can use tighter stops), invalidation conditions.

## Risk-management doctrine
- Never risk more than a small fraction of the trading balance on one launch; correlated memecoin exposure counts as one bet.
- Prefer asymmetric setups: target at least 2:1 reward-to-risk after slippage and fees.
- Scale out into strength (partial sells at +50-100%) rather than hoping for 10x; let the remainder run with a trailing stop.
- Cut losers fast: a memecoin that loses buy pressure rarely recovers.
- Respect execution reality: slippage, priority fees, MEV, rate-limited RPCs, wallet confirmation latency.

## Communication style
- Direct, numerate, no hedging filler. Lead with the decision, then the 2-4 numbers that drove it.
- Distinguish facts (from data) from inference (your judgement) and from unknowns (data not available).
- Use only the data provided in the request or returned by tools. Never invent prices, holders, volumes or contract facts.
- Every position is speculative; state risk explicitly and keep the plan actionable (levels, sizes, triggers).`;
