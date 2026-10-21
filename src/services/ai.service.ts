import type Anthropic from '@anthropic-ai/sdk';
import { CoinAnalysis, CoinData } from '../types/coin';
import { AiDecision, BotSettings, BotStats } from '../types/bot';
import type { LaunchFacts } from './scanner.service';

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
  buys5m: number;
  sells5m: number;
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
  /** New launches only: what the launch watcher measured on the trade stream. */
  launch?: LaunchFacts;
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

/** What a non-JSON failure means for the user (Vercel answers timeouts and crashes with HTML pages). */
function statusNote(status: number): string {
  if (status === 401) return 'Login session expired - reload the page and log in again.';
  if (status === 504) return 'The AI server timed out (the hosting limit is 60 s). Try again, or pick a faster model (Sonnet / Haiku) in Settings.';
  if (status === 413) return 'The request was too large. Start a new chat and try again.';
  if (status >= 500) return `The AI server failed (HTTP ${status}). Try again in a moment.`;
  return `AI request failed (HTTP ${status})`;
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
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      // The rate limiter and the login check answer { error: code, message }; the AI routes answer { error }.
      throw new Error(data?.message || data?.error || statusNote(res.status));
    }
    if (!data) throw new Error(statusNote(res.status));
    return data as T;
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error(`No answer from the AI within ${Math.round(timeoutMs / 1000)} s. Try again.`);
    if (err instanceof TypeError) throw new Error('Network error - check your internet connection.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const AIService = {
  /** Full scorecard for a coin. Uses Claude when the server has credentials, heuristics otherwise. */
  async analyzeCoin(coin: CoinData, model?: string): Promise<CoinAnalysis & { source?: 'ai' | 'heuristic'; note?: string }> {
    const data = await postJson<{ analysis: CoinAnalysis; source?: 'ai' | 'heuristic'; note?: string }>('/api/ai/analyze', { coin, model }, 58_000);
    return { ...data.analysis, source: data.source, note: data.note };
  },

  /**
   * Buy / skip review of a Ready signal before auto trade buys it. A transport failure comes back
   * as `available: false` so the caller can decide whether to trade on the scanner alone.
   */
  async decideSignal(
    signal: SignalForGate,
    settings: BotSettings,
    context: { openPositions: number; stats: BotStats; todayPnlUsd: number; capitalUsd: number | null }
  ): Promise<(AiDecision & { sizeFactor?: number; available: boolean; configured?: boolean; permanent?: boolean }) | null> {
    try {
      const data = await postJson<{ decision: AiDecision & { sizeFactor?: number }; note?: string; available?: boolean; configured?: boolean; permanent?: boolean }>(
        '/api/ai/decide',
        { signal, settings, context, model: settings.aiModel },
        50_000
      );
      if (!data?.decision) return null;
      if (data.note && data.decision.reason !== data.note) data.decision.reason = `${data.decision.reason} (${data.note})`;
      return { ...data.decision, available: data.available !== false, configured: data.configured !== false, permanent: !!data.permanent };
    } catch (err: any) {
      const reason = err?.message || 'network error';
      // An expired login is not a passing failure either: nothing gets through until the user logs in.
      return { action: 'skip', confidence: 0, reason, source: 'heuristic', available: false, permanent: /log in again/i.test(reason) };
    }
  },

  /** One model turn of the control chat. The caller executes any tool_use blocks and calls again. */
  async chatTurn(messages: ChatMessageParam[], model?: string): Promise<ChatTurnResult> {
    try {
      const data = await postJson<ChatTurnResult>('/api/ai/chat', { messages, model }, 75_000);
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
