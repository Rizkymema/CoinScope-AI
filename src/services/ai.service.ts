import type Anthropic from '@anthropic-ai/sdk';
import { CoinAnalysis, CoinData } from '../types/coin';
import { AiDecision, BotSettings, BotStats } from '../types/bot';

export type ChatMessageParam = Anthropic.MessageParam;
export type ChatContentBlock = Anthropic.ContentBlock;
export type ChatToolUseBlock = Anthropic.ToolUseBlock;
export type ChatToolResultParam = Anthropic.ToolResultBlockParam;

export interface ChatTurnResult {
  content: ChatContentBlock[];
  stop_reason: string | null;
  error?: string;
  model?: string;
}

async function postJson<T>(url: string, body: unknown, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `${url} failed (${res.status})`);
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

export const AIService = {
  /** Full scorecard for a coin. Uses Claude when the server has credentials, heuristics otherwise. */
  async analyzeCoin(coin: CoinData): Promise<CoinAnalysis & { source?: 'ai' | 'heuristic'; note?: string }> {
    const data = await postJson<{ analysis: CoinAnalysis; source?: 'ai' | 'heuristic'; note?: string }>('/api/ai/analyze', { coin }, 45_000);
    return { ...data.analysis, source: data.source, note: data.note };
  },

  /** Buy / skip decision used by the bot's AI gate. */
  async decideSnipe(
    coin: CoinData,
    settings: BotSettings,
    context: { openPositions: number; stats: BotStats }
  ): Promise<AiDecision> {
    try {
      const data = await postJson<{ decision: AiDecision; note?: string }>('/api/ai/decide', { coin, settings, context }, 25_000);
      if (data?.note && data.decision) data.decision.reason = `${data.decision.reason} (${data.note})`;
      return data.decision;
    } catch (err: any) {
      return {
        action: 'skip',
        confidence: 0,
        reason: `AI gate unavailable: ${err?.message || 'network error'}`,
        source: 'heuristic',
      };
    }
  },

  /** One model turn of the control chat. The caller executes any tool_use blocks and calls again. */
  async chatTurn(messages: ChatMessageParam[], snapshot: unknown): Promise<ChatTurnResult> {
    try {
      const data = await postJson<ChatTurnResult>('/api/ai/chat', { messages, snapshot }, 90_000);
      return data;
    } catch (err: any) {
      return { content: [], stop_reason: null, error: err?.message || 'AI chat failed' };
    }
  },

  /** Local fallback answer when the AI backend is not configured. */
  localReply(prompt: string, coin?: CoinData | null, analysis?: CoinAnalysis | null): string {
    if (!coin) {
      return `AI backend belum dikonfigurasi (tambahkan ANTHROPIC_API_KEY di .env.local untuk mengaktifkan chat & kontrol bot via AI).\n\nPertanyaan Anda: "${prompt}". Pilih coin di dashboard untuk melihat data pasar dan skor heuristiknya.`;
    }
    const fmt = (v: number) => (v >= 1_000_000 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1_000 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(2)}`);
    return [
      `Ringkasan ${coin.name} (${coin.symbol}) di ${coin.chainId || 'DEX'}:`,
      `Harga $${coin.priceUsd} | 24h ${coin.priceChange24h >= 0 ? '+' : ''}${coin.priceChange24h.toFixed(1)}%`,
      `MCap ${fmt(coin.fundamentals.marketCap)} | Likuiditas ${fmt(coin.fundamentals.tvl || 0)} | Vol 24h ${fmt(coin.fundamentals.volume24h)}`,
      analysis ? `Skor: ${analysis.score}/100 (${analysis.category}, risiko ${analysis.risk_protocol.level})` : '',
      '',
      'AI backend belum aktif - set ANTHROPIC_API_KEY untuk analisis dan kontrol bot dengan Claude.',
    ]
      .filter(Boolean)
      .join('\n');
  },
};
