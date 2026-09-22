import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import {
  AI_MODEL,
  TRADING_SYSTEM_PROMPT,
  describeCoin,
  extractText,
  getAnthropic,
  hasAnthropicCredentials,
  heuristicDecision,
  heuristicScore,
  parseJsonObject,
} from '@/lib/ai-server';
import type { CoinData } from '@/types/coin';
import type { AiDecision, BotSettings } from '@/types/bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'confidence', 'reason', 'risk_level', 'take_profit_percent', 'stop_loss_percent'],
  properties: {
    action: { type: 'string', enum: ['buy', 'skip'] },
    confidence: { type: 'integer', minimum: 0, maximum: 100, description: 'Confidence that buying now is +EV' },
    reason: { type: 'string', description: 'One or two sentences with the deciding numbers and the main risk (e.g. liquidity/mcap ratio, buy/sell flow, age, momentum).' },
    risk_level: { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'] },
    take_profit_percent: { type: 'integer', minimum: 10, maximum: 1000 },
    stop_loss_percent: { type: 'integer', minimum: 5, maximum: 90 },
  },
} as const;

/**
 * POST /api/ai/decide { coin, settings, context? } -> { decision: AiDecision }
 * Called by the bot before an automatic buy when the AI gate is enabled.
 */
export async function POST(req: NextRequest) {
  let coin: Partial<CoinData>;
  let settings: Partial<BotSettings>;
  let context: Record<string, unknown> | undefined;
  try {
    const body = await req.json();
    coin = body?.coin || {};
    settings = body?.settings || {};
    context = body?.context;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!coin?.symbol) return NextResponse.json({ error: 'coin.symbol is required' }, { status: 400 });

  const minConfidence = Number(settings.aiMinConfidence) || 60;
  if (!hasAnthropicCredentials()) {
    return NextResponse.json({ decision: heuristicDecision(coin, minConfidence) });
  }

  const baseline = heuristicScore(coin);
  try {
    const client = getAnthropic();
    const response = await client.messages.create(
      {
        model: AI_MODEL,
        max_tokens: 1024,
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
      { timeout: 20_000 }
    );

    if (response.stop_reason === 'refusal') {
      return NextResponse.json({ decision: heuristicDecision(coin, minConfidence), note: 'AI declined' });
    }

    const parsed = parseJsonObject<any>(extractText(response));
    if (!parsed) return NextResponse.json({ decision: heuristicDecision(coin, minConfidence), note: 'Unparseable AI output' });

    const decision: AiDecision = {
      action: parsed.action === 'buy' ? 'buy' : 'skip',
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
      reason: String(parsed.reason || ''),
      riskLevel: parsed.risk_level || baseline.riskLevel,
      suggestedTakeProfitPercent: Number(parsed.take_profit_percent) || undefined,
      suggestedStopLossPercent: Number(parsed.stop_loss_percent) || undefined,
      source: 'ai',
      model: response.model,
    };
    return NextResponse.json({ decision });
  } catch (error) {
    const note =
      error instanceof Anthropic.AuthenticationError
        ? 'Invalid ANTHROPIC_API_KEY'
        : error instanceof Anthropic.RateLimitError
        ? 'Anthropic rate limit hit'
        : error instanceof Anthropic.APIError
        ? `Anthropic API error ${error.status}: ${error.message}`
        : (error as Error)?.message || 'AI decision failed';
    return NextResponse.json({ decision: heuristicDecision(coin, minConfidence), note });
  }
}
