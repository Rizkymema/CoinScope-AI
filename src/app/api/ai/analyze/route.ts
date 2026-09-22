import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import {
  AI_MODEL,
  TRADING_SYSTEM_PROMPT,
  describeCoin,
  extractText,
  getAnthropic,
  hasAnthropicCredentials,
  heuristicScore,
  parseJsonObject,
} from '@/lib/ai-server';
import type { CoinAnalysis, CoinData } from '@/types/coin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'category', 'analysis', 'risk_level', 'risk_flags', 'breakdown'],
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    category: { type: 'string', enum: ['Buy', 'Watchlist', 'Hold', 'Avoid'] },
    analysis: { type: 'string', description: 'Desk note, 3-6 sentences: verdict, the 2-4 numbers that drove it, main risk, concrete plan (size / TP-SL / invalidation).' },
    risk_level: { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'] },
    risk_flags: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    breakdown: {
      type: 'object',
      additionalProperties: false,
      required: ['fundamental', 'technical', 'sentiment', 'risk'],
      properties: {
        fundamental: { type: 'integer', minimum: 0, maximum: 100 },
        technical: { type: 'integer', minimum: 0, maximum: 100 },
        sentiment: { type: 'integer', minimum: 0, maximum: 100 },
        risk: { type: 'integer', minimum: 0, maximum: 100, description: 'Higher = safer' },
      },
    },
  },
} as const;

function heuristicAnalysis(coin: Partial<CoinData>): CoinAnalysis {
  const h = heuristicScore(coin);
  const category: CoinAnalysis['category'] = h.score >= 70 ? 'Buy' : h.score >= 50 ? 'Watchlist' : h.score >= 35 ? 'Hold' : 'Avoid';
  return {
    symbol: (coin.symbol || '?').toUpperCase(),
    score: h.score,
    category,
    analysis: `Rule-based score ${h.score}/100 (${h.riskLevel} risk, no AI key configured). ${
      h.positives.length ? `Positives: ${h.positives.join(', ')}. ` : ''
    }${h.flags.length ? `Watch out for: ${h.flags.join(', ')}.` : ''}`,
    risk_protocol: { flags: h.flags, level: h.riskLevel },
    breakdown: h.breakdown,
    generated_at: new Date().toISOString(),
  };
}

export async function POST(req: NextRequest) {
  let coin: Partial<CoinData>;
  try {
    const body = await req.json();
    coin = body?.coin || {};
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!coin?.symbol) return NextResponse.json({ error: 'coin.symbol is required' }, { status: 400 });

  if (!hasAnthropicCredentials()) {
    return NextResponse.json({ analysis: heuristicAnalysis(coin), source: 'heuristic' });
  }

  const baseline = heuristicScore(coin);
  try {
    const client = getAnthropic();
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 2048,
      system: TRADING_SYSTEM_PROMPT,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: ANALYSIS_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `Produce a professional scorecard for this token for a short-term memecoin trader. Work through the analytical framework (liquidity & structure, order flow, momentum & timing, tokenomics & legitimacy, risk class) and write the analysis as a desk note: verdict first, then the key numbers, the main risk, and a concrete plan (size relative to default, TP/SL logic, invalidation).\n\nMarket data:\n${JSON.stringify(
            describeCoin(coin),
            null,
            2
          )}\n\nRule-based baseline (for reference only): ${JSON.stringify(baseline)}\n\nReturn the JSON analysis.`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      return NextResponse.json({ analysis: heuristicAnalysis(coin), source: 'heuristic', note: 'AI declined' });
    }

    const parsed = parseJsonObject<any>(extractText(response));
    if (!parsed) return NextResponse.json({ analysis: heuristicAnalysis(coin), source: 'heuristic', note: 'Unparseable AI output' });

    const analysis: CoinAnalysis = {
      symbol: (coin.symbol || '?').toUpperCase(),
      score: Number(parsed.score) || baseline.score,
      category: parsed.category || 'Watchlist',
      analysis: String(parsed.analysis || ''),
      risk_protocol: { flags: Array.isArray(parsed.risk_flags) ? parsed.risk_flags : [], level: parsed.risk_level || baseline.riskLevel },
      breakdown: {
        fundamental: Number(parsed.breakdown?.fundamental) || baseline.breakdown.fundamental,
        technical: Number(parsed.breakdown?.technical) || baseline.breakdown.technical,
        sentiment: Number(parsed.breakdown?.sentiment) || baseline.breakdown.sentiment,
        risk: Number(parsed.breakdown?.risk) || baseline.breakdown.risk,
      },
      generated_at: new Date().toISOString(),
    };
    return NextResponse.json({ analysis, source: 'ai', model: response.model });
  } catch (error) {
    const message =
      error instanceof Anthropic.AuthenticationError
        ? 'Invalid ANTHROPIC_API_KEY'
        : error instanceof Anthropic.RateLimitError
        ? 'Anthropic rate limit hit'
        : error instanceof Anthropic.APIError
        ? `Anthropic API error ${error.status}: ${error.message}`
        : (error as Error)?.message || 'AI analysis failed';
    return NextResponse.json({ analysis: heuristicAnalysis(coin), source: 'heuristic', note: message });
  }
}
