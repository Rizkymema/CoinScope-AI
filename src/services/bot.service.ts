import { CoinData } from '../types/coin';
import { BotSettings, BotPosition } from '../types/bot';

export const BotService = {
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
