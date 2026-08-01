import { CoinAnalysis, CoinData } from '../types/coin';

export const AIService = {
  /**
   * Placeholder analysis until a real AI backend is wired up.
   * Always returns mock scoring for the selected symbol.
   */
  async analyzeCoin(symbol: string): Promise<CoinAnalysis> {
    await new Promise((resolve) => setTimeout(resolve, 1200));

    return {
      symbol: symbol.toUpperCase(),
      score: 78,
      category: 'Watchlist',
      analysis: 'Strong volume but high whale concentration across active derivatives.',
      risk_protocol: {
        flags: ['Low liquidity', 'Whale dominance'],
        level: 'High',
      },
      breakdown: {
        fundamental: 65,
        technical: 82,
        sentiment: 75,
        risk: 90,
      },
      generated_at: new Date().toISOString(),
    };
  },

  /**
   * Rule-based chat reply using selected coin context.
   * Simulates streaming until a real LLM endpoint is connected.
   */
  async judgeCoin(
    prompt: string,
    onChunk: (text: string) => void,
    context?: { coin?: CoinData | null; aiAnalysis?: CoinAnalysis | null }
  ): Promise<void> {
    const coin = context?.coin || null;
    const ai = context?.aiAnalysis || null;

    const formatUsd = (value: number) => {
      const safe = Number.isFinite(value) ? value : 0;
      const maxFractionDigits = safe !== 0 && Math.abs(safe) < 1 ? 6 : 2;
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: maxFractionDigits,
      }).format(safe);
    };

    const formatCompact = (value: number) => {
      const safe = Number.isFinite(value) ? value : 0;
      return new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 2,
      }).format(safe);
    };

    const buildReply = () => {
      if (!coin) {
        return `Based on the latest data for your query "${prompt}", the technicals suggest a short-term volatility spike. However, fundamental adoption remains strong. I'd rate the conviction as moderate risk. Wait for support levels before considering positions.`;
      }

      const change24h = Number(coin.priceChange24h) || 0;
      const changePrefix = change24h >= 0 ? '+' : '';
      const mcap = Number(coin.fundamentals?.marketCap) || 0;
      const vol24h = Number(coin.fundamentals?.volume24h) || 0;
      const liquidity = Number(coin.fundamentals?.tvl) || 0;
      const buys = coin.txns24h?.buys;
      const sells = coin.txns24h?.sells;
      const txLine =
        buys !== undefined && sells !== undefined
          ? `Txns 24h: ${buys} buys / ${sells} sells`
          : 'Txns 24h: not available';
      const aiLine = ai
        ? `AI Score: ${ai.score}/100 (${ai.category}) | Risk: ${ai.risk_protocol.level}${ai.risk_protocol.flags?.length ? ` | Flags: ${ai.risk_protocol.flags.join(', ')}` : ''}`
        : 'AI Score: not available';

      return [
        `Analisis cepat untuk ${coin.name} (${coin.symbol})${coin.chainId ? ` — chain ${coin.chainId}` : ''}.`,
        '',
        `Harga: ${formatUsd(Number(coin.priceUsd) || 0)} (24h ${changePrefix}${change24h.toFixed(2)}%)`,
        `MCap: ${formatCompact(mcap)} | Vol 24h: ${formatCompact(vol24h)} | Liquidity: ${formatCompact(liquidity)}`,
        txLine,
        coin.url ? `DexScreener: ${coin.url}` : '',
        '',
        aiLine,
        '',
        `Pertanyaan Anda: "${prompt}"`,
        'Sebut timeframe (5m/1h/4h/1D) + gaya risk (rendah/sedang/tinggi) kalau mau analisis entry/exit lebih spesifik.',
      ]
        .filter(Boolean)
        .join('\n');
    };

    const reply = buildReply();
    let index = 0;

    return new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (index >= reply.length) {
          clearInterval(interval);
          resolve();
          return;
        }
        onChunk(reply.slice(index, index + 3));
        index += 3;
      }, 30);
    });
  },
};
