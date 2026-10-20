import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import {
  ANALYZE_MAX_TOKENS,
  aiErrorNote,
  modelFor,
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

/**
 * Structured outputs reject numeric minimum/maximum and maxItems with a 400, which made every
 * scorecard request fail and fall back to the rule-based score. Ranges are described instead and
 * clamped after parsing.
 */
const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'category', 'analysis', 'risk_level', 'risk_flags', 'breakdown'],
  properties: {
    score: { type: 'integer', description: 'Overall score 0-100' },
    category: { type: 'string', enum: ['Buy', 'Watchlist', 'Hold', 'Avoid'] },
    analysis: { type: 'string', description: 'Desk note, 3-6 sentences: verdict, the 2-4 numbers that drove it, main risk, concrete plan (size / TP-SL / invalidation).' },
    risk_level: { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'] },
    risk_flags: { type: 'array', items: { type: 'string' }, description: 'Up to 6 short risk flags' },
    breakdown: {
      type: 'object',
      additionalProperties: false,
      required: ['fundamental', 'technical', 'sentiment', 'risk'],
      properties: {
        fundamental: { type: 'integer', description: '0-100' },
        technical: { type: 'integer', description: '0-100' },
        sentiment: { type: 'integer', description: '0-100' },
        risk: { type: 'integer', description: '0-100, higher = safer' },
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
  const limited = rateLimit(req, 'ai-analyze', 60, 60_000);
  if (limited) return limited;
  let coin: Partial<CoinData>;
  let model: string;
  try {
    const body = await req.json();
    coin = body?.coin || {};
    model = modelFor(body?.model);
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
    const response = await client.messages.create(
      {
        model,
        max_tokens: ANALYZE_MAX_TOKENS,
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
      },
      { timeout: 50_000, maxRetries: 0 }
    );

    if (response.stop_reason === 'refusal') {
      return NextResponse.json({ analysis: heuristicAnalysis(coin), source: 'heuristic', note: 'AI declined' });
    }

    const parsed = response.stop_reason === 'max_tokens' ? null : parseJsonObject<any>(extractText(response));
    if (!parsed) return NextResponse.json({ analysis: heuristicAnalysis(coin), source: 'heuristic', note: 'Unparseable AI output' });

    const pct = (v: unknown, fallback: number) => {
      const n = Math.round(Number(v));
      return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback;
    };
    const analysis: CoinAnalysis = {
      symbol: (coin.symbol || '?').toUpperCase(),
      score: pct(parsed.score, baseline.score),
      category: parsed.category || 'Watchlist',
      analysis: String(parsed.analysis || ''),
      risk_protocol: { flags: Array.isArray(parsed.risk_flags) ? parsed.risk_flags.slice(0, 6).map(String) : [], level: parsed.risk_level || baseline.riskLevel },
      breakdown: {
        fundamental: pct(parsed.breakdown?.fundamental, baseline.breakdown.fundamental),
        technical: pct(parsed.breakdown?.technical, baseline.breakdown.technical),
        sentiment: pct(parsed.breakdown?.sentiment, baseline.breakdown.sentiment),
        risk: pct(parsed.breakdown?.risk, baseline.breakdown.risk),
      },
      generated_at: new Date().toISOString(),
    };
    return NextResponse.json({ analysis, source: 'ai', model: response.model });
  } catch (error) {
    return NextResponse.json({ analysis: heuristicAnalysis(coin), source: 'heuristic', note: aiErrorNote(error) });
  }
}
