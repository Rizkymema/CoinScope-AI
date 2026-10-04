/**
 * Paper fills that cost what a real fill would.
 *
 * Filling paper trades at the last tick price makes a strategy look far better than it is: on a
 * fresh bonding curve a $25 buy can move the price several percent, and the venue takes its fee
 * on both sides. For Solana tokens the fill comes from a real Jupiter quote of the same size;
 * otherwise (EVM, or tokens Jupiter has not indexed yet - typically the first minute after a
 * Pump.fun launch) from a constant-product model of the pool's depth.
 * Network + priority fees are charged on top either way.
 */
import { CoinData } from '../types/coin';
import { BotSettings } from '../types/bot';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const BASE_FEE_SOL = 0.000005;
const QUOTE_TIMEOUT_MS = 4_000;

export interface PaperFill {
  /** Effective price per token, fees included. */
  priceUsd: number;
  /** Buy: tokens received. Sell: tokens sold. */
  tokens: number;
  /** Sell only: USD received after fees. */
  proceedsUsd?: number;
  /** How far the effective price is from the reference price, in percent (positive = worse). */
  costPercent: number;
  source: 'jupiter' | 'model';
}

const decimalsCache = new Map<string, number>();
const mintOf = (coin: CoinData) => coin.mint || (coin.id.includes(':') ? coin.id.split(':')[1] : coin.id);
const isSolana = (coin: CoinData) => (coin.chainId || '').toLowerCase() === 'solana';
const isPumpFamily = (coin: CoinData) => !!coin.isPumpFun || /pump|bonk/i.test(coin.poolType || coin.dexId || '');

async function fetchJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), QUOTE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    return res.ok ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function mintDecimals(coin: CoinData): Promise<number | null> {
  const mint = mintOf(coin);
  const cached = decimalsCache.get(mint);
  if (cached !== undefined) return cached;
  // Pump.fun and LetsBonk mints are always 6 decimals.
  if (coin.isPumpFun || /(pump|bonk)$/.test(mint)) {
    decimalsCache.set(mint, 6);
    return 6;
  }
  const info = await fetchJson(`/api/token/safety?mint=${mint}`);
  if (typeof info?.decimals !== 'number') return null;
  decimalsCache.set(mint, info.decimals);
  return info.decimals;
}

async function jupiterOut(inputMint: string, outputMint: string, amountRaw: string, slippagePct: number): Promise<number | null> {
  const q = await fetchJson(
    `/api/jupiter?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountRaw}&slippageBps=${Math.round(Math.max(1, slippagePct) * 100)}`
  );
  const out = Number(q?.outAmount);
  return Number.isFinite(out) && out > 0 ? out : null;
}

function venueFee(coin: CoinData): number {
  if (!isSolana(coin)) return 0.003;
  return isPumpFamily(coin) ? 0.0125 : 0.0025;
}

/** Virtual SOL every Pump.fun bonding curve starts with; it sets the price depth on top of real SOL. */
const PUMP_VIRTUAL_SOL = 30;

/**
 * Quote-side reserve that prices a trade, in USD. A 50/50 AMM pool holds half its liquidity on the
 * quote side; a Pump.fun bonding curve trades against real SOL plus 30 virtual SOL, so a brand-new
 * curve with $0 of real liquidity still has ~30 SOL of depth.
 */
function quoteReserveUsd(coin: CoinData, solPrice: number): number {
  const tvl = Number(coin.fundamentals?.tvl) || 0;
  if (isSolana(coin) && isPumpFamily(coin) && !coin.graduated && solPrice > 0) return tvl + PUMP_VIRTUAL_SOL * solPrice;
  return tvl > 0 ? tvl / 2 : 0;
}

function txFeeUsd(settings: BotSettings, solPrice: number, coin: CoinData): number {
  if (!isSolana(coin)) return 0;
  return (Math.max(0, settings.priorityFeeSol) + BASE_FEE_SOL) * (solPrice || 0);
}

/** A quote this far from the reference is a decimals or routing problem, not a real price. */
const plausible = (price: number, ref: number) => price > 0 && ref > 0 && price / ref < 20 && price / ref > 0.05;

export const PaperFillService = {
  async buy(coin: CoinData, amountUsd: number, refPriceUsd: number, settings: BotSettings, solPrice: number): Promise<PaperFill> {
    const feeUsd = txFeeUsd(settings, solPrice, coin);
    const spendUsd = Math.max(0, amountUsd - feeUsd);

    if (isSolana(coin) && solPrice > 0) {
      const decimals = await mintDecimals(coin);
      const lamports = Math.round((spendUsd / solPrice) * 1e9);
      const out = decimals !== null && lamports > 0 ? await jupiterOut(WSOL_MINT, mintOf(coin), String(lamports), settings.slippagePercent) : null;
      if (out && decimals !== null) {
        const tokens = out / 10 ** decimals;
        const priceUsd = amountUsd / tokens;
        if (plausible(priceUsd, refPriceUsd)) {
          return { priceUsd, tokens, costPercent: (priceUsd / refPriceUsd - 1) * 100, source: 'jupiter' };
        }
      }
    }

    // Constant product: buying Δ into a quote reserve R pays on average spot × (1 + Δ / R).
    const reserve = quoteReserveUsd(coin, solPrice);
    const impact = reserve > 0 ? spendUsd / reserve : 0.02;
    const cost = Math.min(0.5, venueFee(coin) + impact);
    const tokens = spendUsd / (refPriceUsd * (1 + cost));
    const priceUsd = amountUsd / tokens;
    return { priceUsd, tokens, costPercent: (priceUsd / refPriceUsd - 1) * 100, source: 'model' };
  },

  async sell(coin: CoinData, tokens: number, refPriceUsd: number, settings: BotSettings, solPrice: number): Promise<PaperFill> {
    const feeUsd = txFeeUsd(settings, solPrice, coin);
    const grossAtRef = tokens * refPriceUsd;

    if (isSolana(coin) && solPrice > 0 && tokens > 0) {
      const decimals = await mintDecimals(coin);
      const raw = decimals !== null ? Math.floor(tokens * 10 ** decimals) : 0;
      const out = raw > 0 ? await jupiterOut(mintOf(coin), WSOL_MINT, String(raw), settings.slippagePercent) : null;
      if (out) {
        const proceedsUsd = Math.max(0, (out / 1e9) * solPrice - feeUsd);
        const priceUsd = proceedsUsd / tokens;
        if (plausible(priceUsd, refPriceUsd)) {
          return { priceUsd, tokens, proceedsUsd, costPercent: (1 - priceUsd / refPriceUsd) * 100, source: 'jupiter' };
        }
      }
    }

    // Constant product: selling value V into a quote reserve R returns spot × R / (R + V).
    const reserve = quoteReserveUsd(coin, solPrice);
    const impact = reserve > 0 ? grossAtRef / (reserve + grossAtRef) : 0.02;
    const cost = Math.min(0.9, venueFee(coin) + impact);
    const proceedsUsd = Math.max(0, grossAtRef * (1 - cost) - feeUsd);
    const priceUsd = tokens > 0 ? proceedsUsd / tokens : 0;
    return { priceUsd, tokens, proceedsUsd, costPercent: refPriceUsd > 0 ? (1 - priceUsd / refPriceUsd) * 100 : 0, source: 'model' };
  },
};
