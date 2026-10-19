import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import {
  AI_MODEL,
  ENTRY_RULES_PROMPT,
  GATE_MAX_TOKENS,
  aiErrorNote,
  isPermanentAiError,
  TRADING_SYSTEM_PROMPT,
  describeCoin,
  extractText,
  getAnthropic,
  hasAnthropicCredentials,
  heuristicDecision,
  heuristicScore,
  modelFor,
  parseJsonObject,
} from '@/lib/ai-server';
import type { CoinData } from '@/types/coin';
import type { AiDecision, BotSettings } from '@/types/bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
/** One Claude attempt that ends well before the 60 s function limit. */
const GATE_TIMEOUT_MS = 40_000;

/** GET /api/ai/decide -> whether the server has a Claude key, and its default model. */
export async function GET() {
  return NextResponse.json({ configured: hasAnthropicCredentials(), defaultModel: AI_MODEL });
}

const DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'confidence', 'reason', 'risk_level', 'take_profit_percent', 'stop_loss_percent', 'size_factor'],
  properties: {
    action: { type: 'string', enum: ['buy', 'skip'] },
    // Structured outputs reject numeric minimum/maximum; the ranges are enforced in toDecision().
    confidence: { type: 'integer', description: 'Confidence (0-100) that buying now is +EV' },
    reason: { type: 'string', description: 'One or two sentences with the deciding numbers and the main risk (e.g. liquidity/mcap ratio, buy/sell flow, age, momentum).' },
    risk_level: { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'] },
    take_profit_percent: { type: 'integer', description: 'Take-profit distance from entry in percent (10-1000)' },
    stop_loss_percent: { type: 'integer', description: 'Stop-loss distance from entry in percent (4-90)' },
    size_factor: { type: 'string', enum: ['full', 'half'], description: 'full = full buy size (score >= 80), half = half size (score 70-79).' },
  },
} as const;

interface Parsed {
  action?: string;
  confidence?: number;
  reason?: string;
  risk_level?: AiDecision['riskLevel'];
  take_profit_percent?: number;
  stop_loss_percent?: number;
  size_factor?: string;
}

const clampInt = (v: unknown, lo: number, hi: number): number | undefined => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.max(lo, Math.min(hi, n)) : undefined;
};

const errorNote = aiErrorNote;

/**
 * POST /api/ai/decide
 *   { coin, settings, context?, model? }   -> { decision }  launch sniper gate (new mints)
 *   { signal, settings, context?, model? } -> { decision }  scanner gate (confirmed setups)
 * Without credentials the sniper gate falls back to the rule-based scorer; the scanner gate
 * answers `available: false` so the caller can trade on the scanner's own checks.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, 'ai-decide', 120, 60_000);
  if (limited) return limited;
  let coin: Partial<CoinData> | undefined;
  let signal: Record<string, unknown> | undefined;
  let settings: Partial<BotSettings>;
  let context: Record<string, unknown> | undefined;
  let model: string;
  try {
    const body = await req.json();
    coin = body?.coin;
    signal = body?.signal;
    settings = body?.settings || {};
    context = body?.context;
    model = modelFor(body?.model);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (signal) return decideSignal(signal, settings, context, model);
  if (!coin?.symbol) return NextResponse.json({ error: 'coin.symbol or signal is required' }, { status: 400 });

  const minConfidence = Number(settings.aiMinConfidence) || 60;
  if (!hasAnthropicCredentials()) {
    return NextResponse.json({ decision: heuristicDecision(coin, minConfidence) });
  }

  const baseline = heuristicScore(coin);
  try {
    const client = getAnthropic();
    const response = await client.messages.create(
      {
        model,
        // Thinking is always on and counts toward max_tokens; 1024 left no room for the JSON, so
        // most answers came back empty and every token was skipped as "unparseable".
        max_tokens: GATE_MAX_TOKENS,
        system: TRADING_SYSTEM_PROMPT,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: DECISION_SCHEMA } },
        messages: [
          {
            role: 'user',
            content: `The sniper bot wants to buy this token right now. Act as the desk's risk manager: apply the analytical framework and risk doctrine, then decide BUY or SKIP. Confidence is your probability-weighted view that this entry is positive expected value after slippage and fees. Only approve setups with an asymmetric reward/risk profile; skip anything with trap-like liquidity, fading or wash-like flow, or a move that is already parabolic.

Bot parameters: buy size $${settings.buyAmountUsd ?? 0}, default TP +${settings.takeProfitPercent ?? 0}%, default SL -${settings.stopLossPercent ?? 0}%, open positions ${context?.openPositions ?? 'n/a'}/${settings.maxPositions ?? 'n/a'}, paper trading: ${settings.paperTrading ? 'yes' : 'NO - real money'}.
Recent bot performance: ${JSON.stringify(context?.stats ?? {})}

Token data:
${JSON.stringify(describeCoin(coin), null, 2)}

Rule-based baseline: score ${baseline.score}/100, risk ${baseline.riskLevel}, flags ${JSON.stringify(baseline.flags)}, positives ${JSON.stringify(baseline.positives)}.

Return the JSON decision. Suggest take_profit_percent / stop_loss_percent that fit this token's structure: thin bonding-curve tokens need wider stops and smaller size, deep graduated pools can use tighter stops; keep reward/risk at least 2:1.`,
          },
        ],
      },
      { timeout: GATE_TIMEOUT_MS, maxRetries: 0 }
    );

    if (response.stop_reason === 'refusal') {
      return NextResponse.json({ decision: heuristicDecision(coin, minConfidence), note: 'AI declined' });
    }
    if (response.stop_reason === 'max_tokens') {
      return NextResponse.json({ decision: heuristicDecision(coin, minConfidence), note: 'AI answer cut off' });
    }

    const parsed = parseJsonObject<Parsed>(extractText(response));
    if (!parsed) return NextResponse.json({ decision: heuristicDecision(coin, minConfidence), note: 'Unparseable AI output' });
    return NextResponse.json({ decision: toDecision(parsed, baseline.riskLevel, response.model) });
  } catch (error) {
    return NextResponse.json({ decision: heuristicDecision(coin, minConfidence), note: errorNote(error) });
  }
}

function toDecision(parsed: Parsed, fallbackRisk: AiDecision['riskLevel'], model: string): AiDecision & { sizeFactor?: number } {
  return {
    action: parsed.action === 'buy' ? 'buy' : 'skip',
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
    reason: String(parsed.reason || ''),
    riskLevel: parsed.risk_level || fallbackRisk,
    suggestedTakeProfitPercent: clampInt(parsed.take_profit_percent, 10, 1000),
    suggestedStopLossPercent: clampInt(parsed.stop_loss_percent, 4, 90),
    sizeFactor: parsed.size_factor === 'half' ? 0.5 : 1,
    source: 'ai',
    model,
  };
}

async function decideSignal(signal: Record<string, unknown>, settings: Partial<BotSettings>, context: Record<string, unknown> | undefined, model: string) {
  if (!hasAnthropicCredentials()) {
    return NextResponse.json({
      available: false,
      configured: false,
      decision: { action: 'skip', confidence: 0, reason: 'No ANTHROPIC_API_KEY on the server', source: 'heuristic' } satisfies AiDecision,
    });
  }

  try {
    const client = getAnthropic();
    const response = await client.messages.create(
      {
        model,
        max_tokens: GATE_MAX_TOKENS,
        system: [
          { type: 'text', text: TRADING_SYSTEM_PROMPT },
          { type: 'text', text: ENTRY_RULES_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: DECISION_SCHEMA } },
        messages: [
          {
            role: 'user',
            content: `The setup scanner has a Ready signal and the auto-buy is about to fire. Review it against the entry procedure and decide BUY or SKIP.

The scanner has already enforced every hard gate (contract authorities, holder count and concentration, insiders, dev bag, liquidity, clone ticker, parabolic move) and passed a real Jupiter buy + sell-back quote; it also computed the stop, the target and the reward/risk after fees. Do not re-check those gates or skip for data that is not in the signal - missing extras are normal. BUY when the setup is valid and nothing in the numbers contradicts it. SKIP only for a specific red flag you can name from this data, for example: the last 5 minutes are clearly sell-dominated (buys5m/sells5m under ~0.8), price already left the entry zone, the net reward/risk is under 1, or the account is over-exposed. Calibrate confidence honestly: 50 means even odds of hitting the target before the stop, which with reward above risk is already positive expected value; 60-75 for a clean setup with supportive flow.

Account: ${settings.paperTrading ? 'paper trading' : 'LIVE - real money'}, buy size $${settings.buyAmountUsd ?? 0}, trading capital ${context?.capitalUsd != null ? `$${context.capitalUsd}` : 'n/a'}, open positions ${context?.openPositions ?? 'n/a'}/${settings.maxPositions ?? 'n/a'}, today's realized P&L $${context?.todayPnlUsd ?? 0}, daily loss limit $${settings.dailyLossLimitUsd ?? 0}, profit lock +${settings.profitLockTriggerPercent ?? 0}% -> +${settings.profitLockPercent ?? 0}%.
Recent performance: ${JSON.stringify(context?.stats ?? {})}

Signal (all numbers measured by the scanner; gates already passed RugCheck; the sell-back quote is included):
${JSON.stringify(signal, null, 2)}

Return the JSON decision. stop_loss_percent must be <= the scanner's slPercent (tighter is allowed, wider is not). take_profit_percent should stay near the scanner's tpPercent unless the structure clearly supports more. size_factor "half" when the score is 70-79 or the setup is the weak one, "full" otherwise.`,
          },
        ],
      },
      { timeout: GATE_TIMEOUT_MS, maxRetries: 0 }
    );

    if (response.stop_reason === 'refusal') {
      return NextResponse.json({ available: true, decision: { action: 'skip', confidence: 0, reason: 'AI declined to review this token', source: 'ai', model: response.model } satisfies AiDecision });
    }
    // A cut-off or unreadable answer is not a verdict on the token: report it as unavailable so the
    // signal is not put on the skip cooldown.
    const parsed = response.stop_reason === 'max_tokens' ? null : parseJsonObject<Parsed>(extractText(response));
    if (!parsed) {
      const note = response.stop_reason === 'max_tokens' ? 'AI answer cut off (token limit)' : 'Unparseable AI output';
      return NextResponse.json({ available: false, note, decision: { action: 'skip', confidence: 0, reason: note, source: 'ai', model: response.model } satisfies AiDecision });
    }
    return NextResponse.json({ available: true, decision: toDecision(parsed, 'High', response.model) });
  } catch (error) {
    // A transport or quota problem is not a verdict on the token: report it as unavailable.
    // `permanent`: a bad key, a model the key cannot use - retrying will not help until it is fixed.
    return NextResponse.json({
      available: false,
      permanent: isPermanentAiError(error),
      note: errorNote(error),
      decision: { action: 'skip', confidence: 0, reason: errorNote(error), source: 'heuristic' } satisfies AiDecision,
    });
  }
}
