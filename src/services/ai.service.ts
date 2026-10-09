import type Anthropic from '@anthropic-ai/sdk';
import { CoinAnalysis, CoinData } from '../types/coin';
import { AiDecision, BotSettings, BotStats } from '../types/bot';

/** Compact scanner signal sent to the gate (mirrors ScannerSignalBrief plus the gate facts). */
export interface SignalForGate {
  symbol: string;
  name: string;
  mint: string;
  setup?: string;
  reason: string;
  priceUsd: number;
  liquidityUsd: number;
  marketCapUsd: number;
  ageHours: number;
  volume1hUsd: number;
  buys1h: number;
  sells1h: number;
  rsi?: number;
  entryLow?: number;
  entryHigh?: number;
  stopPrice?: number;
  targetPrice?: number;
  slPercent?: number;
  tpPercent?: number;
  invalidation?: string;
  costPercent?: number;
  netRewardRisk?: number;
  smartWallets?: number;
  gates?: { top10Pct: number; maxHolderPct: number; insiderPct: number; devPct: number; holders: number };
  score?: { safety: number; holders: number; liquidity: number; momentum: number; social: number; total: number };
  sellBack?: { sellable: boolean; roundTripPct?: number };
}

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
  async analyzeCoin(coin: CoinData, model?: string): Promise<CoinAnalysis & { source?: 'ai' | 'heuristic'; note?: string }> {
    const data = await postJson<{ analysis: CoinAnalysis; source?: 'ai' | 'heuristic'; note?: string }>('/api/ai/analyze', { coin, model }, 45_000);
    return { ...data.analysis, source: data.source, note: data.note };
  },

  /** Buy / skip decision used by the bot's AI gate. */
  async decideSnipe(
    coin: CoinData,
    settings: BotSettings,
    context: { openPositions: number; stats: BotStats }
  ): Promise<AiDecision> {
    try {
      const data = await postJson<{ decision: AiDecision; note?: string }>('/api/ai/decide', { coin, settings, context, model: settings.aiModel }, 25_000);
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

  /**
   * Buy / skip review of a scanner signal before the auto-buy. Unlike decideSnipe, a transport
   * failure returns `null` so the caller can decide whether to trade on the scanner alone.
   */
  async decideSignal(
    signal: SignalForGate,
    settings: BotSettings,
    context: { openPositions: number; stats: BotStats; todayPnlUsd: number; capitalUsd: number | null }
  ): Promise<(AiDecision & { sizeFactor?: number; available: boolean }) | null> {
    try {
      const data = await postJson<{ decision: AiDecision & { sizeFactor?: number }; note?: string; available?: boolean }>(
        '/api/ai/decide',
        { signal, settings, context, model: settings.aiModel },
        25_000
      );
      if (!data?.decision) return null;
      if (data.note) data.decision.reason = `${data.decision.reason} (${data.note})`;
      return { ...data.decision, available: data.available !== false };
    } catch {
      return null;
    }
  },

  /** One model turn of the control chat. The caller executes any tool_use blocks and calls again. */
  async chatTurn(messages: ChatMessageParam[], snapshot: unknown, model?: string): Promise<ChatTurnResult> {
    try {
      const data = await postJson<ChatTurnResult>('/api/ai/chat', { messages, snapshot, model }, 90_000);
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
