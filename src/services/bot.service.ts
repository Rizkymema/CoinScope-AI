import { CoinData } from '../types/coin';
import { BotSettings, BotPosition, RiskLevel } from '../types/bot';

const RISK_LEVEL_ORDER: Record<RiskLevel, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
};

export const BotService = {
  /**
   * Evaluates if a coin matches all auto-snipe safety criteria set by the user.
   */
  evaluateCoinForSnipe(
    coin: CoinData,
    settings: BotSettings,
    activePositionsCount: number
  ): { pass: boolean; reason: string; category: string } {
    // 1. Max positions check
    if (activePositionsCount >= settings.maxPositions) {
      return { pass: false, reason: `Max positions limit (${settings.maxPositions}) reached.`, category: 'Max positions reached' };
    }

    // 2. Chain filter check
    if (settings.targetChain !== 'all') {
      const coinChain = (coin.chainId || '').toLowerCase();
      if (coinChain !== settings.targetChain.toLowerCase()) {
        return { pass: false, reason: `Chain '${coin.chainId}' does not match target chain '${settings.targetChain}'.`, category: 'Wrong chain' };
      }
    }

    // 3. Platform filter check (Pump.fun vs DexScreener)
    if (settings.launchPlatform === 'pumpfun' && !coin.isPumpFun) {
      return { pass: false, reason: 'Token is not from Pump.fun launchpad.', category: 'Wrong source' };
    }
    if (settings.launchPlatform === 'dexscreener' && coin.isPumpFun) {
      return { pass: false, reason: 'Token is from Pump.fun (DEX-only mode enabled).', category: 'Wrong source' };
    }

    // 4. Bonding curve filter (for Pump.fun coins)
    if (coin.isPumpFun && coin.bondingCurve !== undefined && settings.minBondingCurvePercent > 0) {
      if (coin.bondingCurve < settings.minBondingCurvePercent) {
        return {
          pass: false,
          reason: `Bonding curve (${coin.bondingCurve}%) is below the ${settings.minBondingCurvePercent}% minimum.`,
          category: 'Bonding curve too low',
        };
      }
    }

    // 5. Minimum Liquidity check (bonding-curve tokens report the SOL collected so far as liquidity)
    const tvl = coin.fundamentals?.tvl || 0;
    if (tvl < settings.minLiquidityUsd) {
      return {
        pass: false,
        reason: `Liquidity ($${Math.round(tvl).toLocaleString()}) is below the $${settings.minLiquidityUsd.toLocaleString()} minimum.`,
        category: 'Liquidity below minimum',
      };
    }

    // 6. Token Age check (if createdAt available)
    if (coin.createdAt && settings.maxTokenAgeMinutes > 0) {
      const ageMs = Date.now() - coin.createdAt;
      const ageMinutes = ageMs / (1000 * 60);
      if (ageMinutes > settings.maxTokenAgeMinutes) {
        return {
          pass: false,
          reason: `Token age (${Math.round(ageMinutes)}m) exceeds the ${settings.maxTokenAgeMinutes}m maximum.`,
          category: 'Too old',
        };
      }
    }

    // 7. Basic Price Check
    if (!coin.priceUsd || coin.priceUsd <= 0) {
      return { pass: false, reason: 'Invalid or zero token price.', category: 'No usable price' };
    }

    return { pass: true, reason: 'All filters passed.', category: 'passed' };
  },

  /**
   * Calculates Take-Profit and Stop-Loss prices.
   */
  calculateTargets(
    buyPriceUsd: number,
    tpPercent: number,
    slPercent: number
  ): { tpPriceUsd: number; slPriceUsd: number } {
    const tpPriceUsd = buyPriceUsd * (1 + tpPercent / 100);
    const slPriceUsd = buyPriceUsd * (1 - slPercent / 100);
    return { tpPriceUsd, slPriceUsd };
  },

  /**
   * Simulates/Executes a Buy Order for a position.
   */
  createPosition(coin: CoinData, settings: BotSettings): BotPosition {
    const buyPriceUsd = Number(coin.priceUsd) || 0.00001;
    const amountUsd = settings.buyAmountUsd;
    const tokensBought = amountUsd / buyPriceUsd;

    const { tpPriceUsd, slPriceUsd } = this.calculateTargets(
      buyPriceUsd,
      settings.takeProfitPercent,
      settings.stopLossPercent
    );

    return {
      id: `pos-${coin.id}-${Date.now()}`,
      coin,
      buyPriceUsd,
      currentPriceUsd: buyPriceUsd,
      amountUsd,
      tokensBought,
      boughtAt: Date.now(),
      pnlUsd: 0,
      pnlPercent: 0,
      highPriceUsd: buyPriceUsd,
      status: 'OPEN',
      tpPriceUsd,
      slPriceUsd,
      isLive: !settings.paperTrading,
      mint: (coin.chainId || '').toLowerCase() === 'solana' ? coin.mint || coin.id.split(':')[1] : undefined,
    };
  },
};
