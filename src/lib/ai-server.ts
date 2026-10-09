/**
 * Server-only helpers shared by the /api/ai/* routes.
 * Never import this from client components.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { CoinData } from '../types/coin';
import type { AiDecision, RiskLevel } from '../types/bot';
import { DEFAULT_AI_MODEL, resolveAiModel } from './ai-models';

/** Server default; the dashboard can pick another model per request (validated against the list). */
export const AI_MODEL = resolveAiModel(process.env.ANTHROPIC_MODEL, DEFAULT_AI_MODEL);

/** Model for one request: the dashboard's pick when it is on the list, else the server default. */
export const modelFor = (requested: unknown) => resolveAiModel(requested, AI_MODEL);

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
  const curve = coin.bondingCurve ?? 0;
  const onCurve = !!coin.isPumpFun && !coin.graduated;
  const flags: string[] = [];
  const positives: string[] = [];

  // --- Fundamental: liquidity depth at launch scale, plus liquidity/market-cap ratio ---
  let fundamental = 30;
  if (liq >= 20_000) fundamental += 32;
  else if (liq >= 5_000) fundamental += 24;
  else if (liq >= 1_000) fundamental += 14;
  else if (liq >= 300) fundamental += 6;
  else flags.push('Very thin liquidity');

  if (mcap > 0 && liq > 0) {
    const ratio = liq / mcap;
    if (ratio >= 0.15) {
      fundamental += 15;
      positives.push('Healthy liquidity / market-cap ratio');
    } else if (ratio >= 0.05) fundamental += 6;
    else if (ratio < 0.02) flags.push('Liquidity is tiny relative to market cap');
  }
  if (mcap > 0 && mcap < 4_000) flags.push('Micro market cap');
  if (coin.websites?.length) {
    fundamental += 8;
    positives.push('Has website');
  }
  if (coin.socials?.length) {
    fundamental += 7;
    positives.push('Has socials');
  }

  // --- Technical: momentum. Fresh mints have no candle history, so curve progress
  //     stands in for it: filling the curve means real SOL is flowing in right now. ---
  let technical = 40;
  const c5 = coin.priceChange5m ?? 0;
  const c1 = coin.priceChange1h ?? 0;
  const hasCandles = c5 !== 0 || c1 !== 0;

  if (hasCandles) {
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
  } else if (onCurve) {
    if (curve >= 40) {
      technical += 22;
      positives.push('Bonding curve filling fast');
    } else if (curve >= 15) technical += 14;
    else if (curve >= 5) technical += 6;
    else flags.push('Curve has barely moved');
  }

  if (vol > 0 && mcap > 0) {
    const turnover = vol / mcap;
    if (turnover > 0.5) {
      technical += 15;
      positives.push('Strong volume turnover');
    } else if (turnover < 0.05) flags.push('Low trading volume');
  }

  // --- Sentiment: order flow, or curve traction when there are no trade counts yet ---
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
  } else if (onCurve) {
    if (curve >= 50) {
      sentiment += 14;
      positives.push('Bonding curve well advanced');
    } else if (curve >= 20) sentiment += 8;
    else if (curve < 3) sentiment -= 10;
  }

  // --- Risk (higher = safer).
  //     Calibrated for the launch market: a brand-new Pump.fun mint is inherently risky,
  //     but it must still be scored against its peers rather than floored at Critical,
  //     otherwise the gate can never approve the only category this bot trades. ---
  let risk = 62;
  if (ageMin !== null) {
    if (ageMin < 1) {
      risk -= 14;
      flags.push('Launched under a minute ago');
    } else if (ageMin < 10) risk -= 6;
    else if (ageMin > 60 * 24) risk += 8;
  }

  if (liq >= 10_000) risk += 12;
  else if (liq >= 2_000) risk += 6;
  else if (liq >= 500) risk += 0;
  else if (liq >= 100) risk -= 10;
  else {
    risk -= 22;
    flags.push('Almost no liquidity to exit into');
  }

  if (onCurve) {
    if (curve >= 50) risk += 8;
    else if (curve >= 15) risk += 2;
    else risk -= 8;
  }
  if (coin.graduated) {
    risk += 10;
    positives.push('Migrated to a DEX pool');
  }
  if (!coin.websites?.length && !coin.socials?.length) {
    risk -= 6;
    flags.push('No website or socials');
  }

  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const breakdown = {
    fundamental: clamp(fundamental),
    technical: clamp(technical),
    sentiment: clamp(sentiment),
    risk: clamp(risk),
  };
  const score = clamp(breakdown.fundamental * 0.3 + breakdown.technical * 0.25 + breakdown.sentiment * 0.2 + breakdown.risk * 0.25);
  const riskLevel: RiskLevel = breakdown.risk >= 70 ? 'Low' : breakdown.risk >= 50 ? 'Medium' : breakdown.risk >= 28 ? 'High' : 'Critical';

  return { score, riskLevel, flags, positives, breakdown };
}

export function heuristicDecision(coin: Partial<CoinData>, minConfidence: number): AiDecision {
  const h = heuristicScore(coin);
  // Critical risk is a hard veto; otherwise the user's confidence threshold decides.
  const buy = h.score >= minConfidence && h.riskLevel !== 'Critical';
  return {
    action: buy ? 'buy' : 'skip',
    confidence: h.score,
    reason: buy
      ? `Score ${h.score}/100, ${h.riskLevel.toLowerCase()} risk. ${h.positives.slice(0, 2).join('; ') || 'Filters passed.'}`
      : `Score ${h.score}/100, ${h.riskLevel.toLowerCase()} risk. ${h.flags.slice(0, 2).join('; ') || `Below the ${minConfidence}% threshold.`}`,
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

/**
 * The entry procedure the scanner implements ("Memecoin Entry Pro", skill memcoin.md), condensed for
 * the gate that reviews a scanner signal before the auto-buy. Sent as a cached system block.
 */
export const ENTRY_RULES_PROMPT = `## Entry procedure you enforce (non-negotiable)
1. Exits are decided before entry: no stop-loss and take-profit, no trade.
2. One failed safety gate = SKIP whatever the score: mint/freeze authority present, LP not burned or locked (non-Pump.fun pools), dev over 5% or already dumping, bundle or sniper cluster still holding 15-20%+, top-10 holders over 30%, a single wallet over 5%, fewer than 150 holders on a token older than an hour, liquidity under 2% of market cap, a ticker cloning a trending coin.
3. Never chase a parabolic candle (over +80% in 5 minutes). Entries happen on a pullback or retest, never mid green candle.
4. Unverifiable data counts as risk, not as safe.

## Score (0-100) - only after every gate passes
Safety & supply 30 · holder distribution 20 · liquidity & structure 20 (pool liquidity >= $10K and liquidity/mcap >= 10%) · momentum & order flow 20 (buys/sells >= 1.3 over the last 5-15 min, volume rising with price, higher highs and higher lows) · narrative & social 10.
>= 80 BUY full size · 70-79 BUY half size (or WAIT for confirmation) · 60-69 WAIT · < 60 SKIP.

## Setups the scanner reports (one must be present)
- Breakout-retest: 5m close above a 30-60 min range on >= 2x average volume; enter on the retest of the old resistance, not on the breakout candle. Stop below the retest low. Time stop 60-120 min.
- Flag: tight consolidation after an impulse, entry on the break of the flag high, stop below the flag low.
- Trend pullback: 5m and 15m uptrend, pullback to EMA20 / VWAP on shrinking sell volume, entry on the bullish candle that closes back above. Stop below the last swing low. Backtests show this is the weakest setup (33% win rate) - demand a clean structure.
- RSI rebound: 5m RSI(14) <= 25 with dip volume lower than the six candles before (selling exhausted), not in a downtrend below VWAP. Stop below the last 4 candles' low (4-12%).
- Momentum (simple mode): a breakout bought as it happens, only while 5m RSI <= 60. Chasing above RSI 60 lost money in backtests.

## Sizing and costs (micro accounts)
Round-trip costs are 2-4% on a $3-5 position, so the target must be >= +30% unless the setup allows a stop <= 12%. Net reward/risk after fees must be >= 1, and the sell-back quote must pass. Prefer graduated PumpSwap/Raydium pools over bonding curves (cheaper fees, calmer moves). Stop-loss hard cap 35%, and never more than a third of the balance in one token.

## Exit doctrine
One full take-profit for small positions (partial sells pay fees again). Profit lock raises the stop above cost once the trade is up. Time stop: no new high within 15-20 min (curve momentum) or 60-120 min (other setups) = exit. Emergency exit when dev/top holders sell big, liquidity is pulled, or a 5m candle closes below the invalidation level on volume.

## Your output
Decide BUY or SKIP for this exact signal. Confidence is your probability-weighted view that the entry is positive expected value after fees. Keep the scanner's stop unless a tighter structural stop exists; a wider stop than the scanner's is never allowed. Keep the take-profit within what the chart supports (the scanner already capped it under the 4h high). State the deciding numbers and the main risk in one or two sentences.`;
