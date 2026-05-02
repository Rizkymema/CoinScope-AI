import { CoinAnalysis, CoinData } from '../types/coin';

const API_BASE_URL = process.env.NEXT_PUBLIC_AI_API_URL || 'https://api.coinscope.ai/v1';

export const AIService = {
  /**
   * Analyzes an asset globally using AI models
   * Returns Score, Sentiment, Categorization & Analysis string
   */
  async analyzeCoin(symbol: string): Promise<CoinAnalysis> {
    try {
      // Future API Layer Integration:
      // const response = await fetch(`${API_BASE_URL}/analyze/${symbol}`);
      // return await response.json();
      
      // Mock Response for currently requested dev states
      return new Promise((resolve) => {
        setTimeout(() => resolve({
          symbol: symbol.toUpperCase(),
          score: 78,
          category: "Watchlist",
          analysis: "Strong volume but high whale concentration across active derivatives.",
          risk_protocol: {
            flags: ["Low liquidity", "Whale dominance"],
            level: "High"
          },
          breakdown: {
            fundamental: 65,
            technical: 82,
            sentiment: 75,
            risk: 90
          },
          generated_at: new Date().toISOString()
        }), 1200);
      });
    } catch (error) {
      console.error(`[AIService] Failed to analyze ${symbol}:`, error);
      throw new Error(`AI Analysis unavailable for ${symbol}`);
    }
  },

  /**
   * Handles user-provided prompts regarding assets and responds via streaming
   * @param prompt User's question or context
   * @param onChunk Callback for the readable stream frames chunking in
   */
  async judgeCoin(
    prompt: string,
    onChunk: (text: string) => void,
    context?: { coin?: CoinData | null; aiAnalysis?: CoinAnalysis | null }
  ): Promise<void> {
    try {
      // Future Real Streaming Connection:
      /* 
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      const reader = response.body?.getReader();
      // standard reader streaming loop
      */

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
        // Fallback: no selected coin context
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
        const txLine = (buys !== undefined && sells !== undefined)
          ? `Txns 24h: ${buys} buys / ${sells} sells`
          : `Txns 24h: not available`;

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
        ].filter(Boolean).join('\n');
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
          onChunk(reply.slice(index, index + 3)); // simulate chunks
          index += 3;
        }, 30);
      });
    } catch (error) {
      console.error(`[AIService] Chat error:`, error);
      throw new Error('AI Judge temporarily unavailable');
    }
  }
};
