import { CoinData } from '../types/coin';
import { TokenTradeEvent } from '../types/bot';
import { ChartService } from './chart.service';
import { SolPriceService } from './solprice.service';

/**
 * Recent trades for a token.
 *
 * History comes from GeckoTerminal (indexed pools); new rows arrive from the PumpPortal
 * WebSocket, which is also the only source for tokens still on a bonding curve.
 */

const GECKO = 'https://api.geckoterminal.com/api/v2';
const HEADERS = { Accept: 'application/json;version=20230302' };

export interface TokenTrade {
  id: string;
  /** Unix milliseconds. */
  time: number;
  side: 'buy' | 'sell';
  valueUsd: number;
  tokenAmount: number;
  priceUsd: number;
  trader?: string;
  txHash?: string;
  source: 'pool' | 'stream';
}

export const TradesService = {
  /** Recent trades from the token's deepest indexed pool, newest first. */
  async getRecentTrades(coin: CoinData, limit = 60): Promise<TokenTrade[]> {
    const chain = String(coin.chainId || '').toLowerCase();
    // Base58 Solana addresses are case-sensitive, so the original casing goes to the API
    // and only the comparison copy is lowercased.
    const token = coin.mint || (coin.id.includes(':') ? coin.id.split(':')[1] : '');
    const tokenKey = token.toLowerCase();
    const network = ChartService.networkFor(chain);
    if (!network || !token) return [];

    const pool = await ChartService.resolvePool(chain, token);
    if (!pool) return [];

    try {
      const res = await fetch(`${GECKO}/networks/${network}/pools/${pool}/trades?trade_volume_in_usd_greater_than=0`, {
        headers: HEADERS,
      });
      if (!res.ok) return [];
      const data = await res.json();
      const rows: any[] = Array.isArray(data?.data) ? data.data : [];

      return rows
        .map((row, i) => {
          const a = row?.attributes ?? {};
          const time = a.block_timestamp ? new Date(a.block_timestamp).getTime() : 0;
          // `kind` is expressed from the pool's base token; our token may be either side.
          const toAddr = String(a.to_token_address || '').toLowerCase();
          const receivesOurToken = toAddr === tokenKey;
          const side: 'buy' | 'sell' = receivesOurToken ? 'buy' : 'sell';
          const tokenAmount = Number(receivesOurToken ? a.to_token_amount : a.from_token_amount) || 0;
          const valueUsd = Number(a.volume_in_usd) || 0;

          return {
            id: String(a.tx_hash || `${time}-${i}`),
            time,
            side,
            valueUsd,
            tokenAmount,
            priceUsd: tokenAmount > 0 ? valueUsd / tokenAmount : 0,
            trader: a.tx_from_address ? String(a.tx_from_address) : undefined,
            txHash: a.tx_hash ? String(a.tx_hash) : undefined,
            source: 'pool' as const,
          };
        })
        .filter((t) => t.time > 0 && t.valueUsd > 0)
        .sort((a, b) => b.time - a.time)
        .slice(0, limit);
    } catch {
      return [];
    }
  },

  /** Converts a PumpPortal stream event into the same row shape. */
  fromStream(evt: TokenTradeEvent, solPriceUsd = SolPriceService.getCached()): TokenTrade | null {
    if (!evt?.mint || !solPriceUsd) return null;
    const valueUsd = (evt.solAmount || 0) * solPriceUsd;
    const tokenAmount = evt.tokenAmount || 0;
    if (valueUsd <= 0) return null;

    return {
      id: evt.signature || `${evt.mint}-${evt.timestamp}`,
      time: evt.timestamp,
      side: evt.txType === 'sell' ? 'sell' : 'buy',
      valueUsd,
      tokenAmount,
      priceUsd: evt.priceSol ? evt.priceSol * solPriceUsd : tokenAmount > 0 ? valueUsd / tokenAmount : 0,
      trader: evt.traderPublicKey,
      txHash: evt.signature,
      source: 'stream',
    };
  },
};
