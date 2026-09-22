import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL, TRADING_SYSTEM_PROMPT, getAnthropic, hasAnthropicCredentials } from '@/lib/ai-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Chat endpoint with bot-control tools.
 * The model runs server-side; tool calls are executed CLIENT-side (the bot state lives in the
 * browser store), so this route returns the raw assistant content and the client loops:
 *   POST -> tool_use blocks -> client executes -> POST again with tool_result blocks -> ... -> end_turn
 */
const BOT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_bot_status',
    description: 'Current bot status: running or paused, settings, wallet, execution mode, open positions summary and performance stats.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_new_coins',
    description: 'Newest tokens detected by the live scanner (Pump.fun stream + new DEX pools), newest first, with price, liquidity, market cap, age and momentum.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 40, description: 'How many coins to return (default 15).' },
        chain: { type: 'string', description: "Filter by chain id, e.g. 'solana', 'base', 'ethereum'." },
        pumpfun_only: { type: 'boolean', description: 'Only Pump.fun launches.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_positions',
    description: 'Open positions with entry price, current price, PnL, TP/SL targets and whether they are live on-chain or paper.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_trade_history',
    description: 'Closed trades with realized PnL and exit reason.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } },
      additionalProperties: false,
    },
  },
  {
    name: 'start_bot',
    description: 'Start the auto-snipe bot (connects the real-time stream and begins evaluating new launches).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'stop_bot',
    description: 'Pause the auto-snipe bot. Open positions are kept and still monitored.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'update_settings',
    description:
      'Change bot strategy settings. Only include the fields you want to change. Switching paperTrading to false enables REAL on-chain trades with the connected wallet - only do this when the user explicitly asks.',
    input_schema: {
      type: 'object',
      properties: {
        buyAmountUsd: { type: 'number', minimum: 1 },
        takeProfitPercent: { type: 'number', minimum: 5, maximum: 2000 },
        stopLossPercent: { type: 'number', minimum: 5, maximum: 95 },
        trailingStopPercent: { type: 'number', minimum: 0, maximum: 90 },
        minLiquidityUsd: { type: 'number', minimum: 0 },
        maxTokenAgeMinutes: { type: 'number', minimum: 0 },
        maxPositions: { type: 'integer', minimum: 1, maximum: 50 },
        slippagePercent: { type: 'number', minimum: 0.5, maximum: 50 },
        minBondingCurvePercent: { type: 'number', minimum: 0, maximum: 100 },
        targetChain: { type: 'string', enum: ['all', 'solana', 'ethereum', 'base', 'bsc', 'arbitrum'] },
        launchPlatform: { type: 'string', enum: ['all', 'pumpfun', 'dexscreener'] },
        autoSell: { type: 'boolean' },
        paperTrading: { type: 'boolean' },
        targetOnlyMode: { type: 'boolean' },
        aiGateEnabled: { type: 'boolean' },
        aiMinConfidence: { type: 'number', minimum: 0, maximum: 100 },
        aiAdjustTargets: { type: 'boolean' },
        soundAlerts: { type: 'boolean' },
        priorityFeeSol: { type: 'number', minimum: 0, maximum: 0.1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'snipe_token',
    description:
      'Buy a token now using the bot (paper or live depending on settings). Identify it by coin id (chain:address), mint address or symbol from get_new_coins. Optional custom USD amount.',
    input_schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Coin id, mint/contract address, or symbol.' },
        amountUsd: { type: 'number', minimum: 1 },
        reason: { type: 'string', description: 'Short rationale that will be written to the bot log.' },
      },
      required: ['token'],
      additionalProperties: false,
    },
  },
  {
    name: 'sell_position',
    description: 'Sell (close) an open position, fully or partially. Identify by position id or token symbol.',
    input_schema: {
      type: 'object',
      properties: {
        position: { type: 'string', description: 'Position id or token symbol.' },
        percent: { type: 'number', minimum: 1, maximum: 100, description: 'Percent to sell (default 100).' },
        reason: { type: 'string' },
      },
      required: ['position'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_position_targets',
    description: 'Update take-profit / stop-loss prices for an open position (as percent from entry).',
    input_schema: {
      type: 'object',
      properties: {
        position: { type: 'string', description: 'Position id or token symbol.' },
        takeProfitPercent: { type: 'number', minimum: 1 },
        stopLossPercent: { type: 'number', minimum: 1, maximum: 99 },
      },
      required: ['position'],
      additionalProperties: false,
    },
  },
  {
    name: 'manage_targets',
    description: 'Add or remove symbols / addresses in the bot target whitelist (used when targetOnlyMode is on).',
    input_schema: {
      type: 'object',
      properties: {
        add: { type: 'array', items: { type: 'string' } },
        remove: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'connect_wallet',
    description: 'Prompt the user to connect their Phantom / Solflare wallet (opens the extension popup).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

const CONTROL_PROMPT = `${TRADING_SYSTEM_PROMPT}

## Operating the bot (tools)
You are also the user's trading desk: you read live state and execute through tools.
- Always call tools before answering questions about coins, positions, balances or settings; never guess numbers. get_new_coins for launches, get_positions / get_trade_history for the book, get_bot_status for configuration.
- When asked to trade, change strategy, or start/stop the bot, do it with the tools, then report exactly what happened: fills, amounts, tx signatures, rejections and errors. Never claim a trade executed unless the tool result says success.
- When asked for a recommendation, deliver a professional desk note: (1) verdict, (2) key metrics, (3) risk grade and what could go wrong, (4) concrete plan - size, TP/SL, invalidation, (5) what you would monitor next. Offer to execute the plan; execute immediately only when the user has asked for action.
- Manage the portfolio like a risk manager: flag over-exposure (too many open positions, oversized buys vs. balance), stale positions with fading flow, positions near TP/SL, and settings that are inconsistent (e.g. tight SL on illiquid curve tokens, 0 minimum liquidity, AI gate off in live mode). Suggest specific corrections with numbers.
- Switching paperTrading to false puts real funds at risk. Do that only on an explicit instruction, confirm the wallet is connected first, and state the risk in one sentence. Prefer conservative sizes for a first live run.
- Educate briefly when useful (what a bonding curve is, why liquidity/mcap matters, why slippage is set high for new launches), but keep answers tight.
- Reply in the user's language (Indonesian when they write Indonesian; keep crypto terms like liquidity, market cap, TP/SL, bonding curve in English). Use short bullet lists for multiple coins. Format prices with sensible precision (e.g. $0.00001234, MCap $12.5K).`;

export async function POST(req: NextRequest) {
  if (!hasAnthropicCredentials()) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured on the server. Add it to .env.local to enable AI chat and control.' },
      { status: 503 }
    );
  }

  let messages: Anthropic.MessageParam[];
  let snapshot: unknown;
  try {
    const body = await req.json();
    messages = Array.isArray(body?.messages) ? body.messages : [];
    snapshot = body?.snapshot;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (messages.length === 0) return NextResponse.json({ error: 'messages is required' }, { status: 400 });

  try {
    const client = getAnthropic();
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 4096,
      system: [
        { type: 'text', text: CONTROL_PROMPT, cache_control: { type: 'ephemeral' } },
        {
          type: 'text',
          text: `Bot snapshot at ${new Date().toISOString()} (use get_bot_status for the live version):\n${JSON.stringify(snapshot ?? {}, null, 1)}`,
        },
      ],
      tools: BOT_TOOLS,
      output_config: { effort: 'high' },
      messages,
    });

    return NextResponse.json({
      content: response.content,
      stop_reason: response.stop_reason,
      stop_details: response.stop_reason === 'refusal' ? response.stop_details : null,
      model: response.model,
      usage: response.usage,
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: 'Invalid ANTHROPIC_API_KEY' }, { status: 401 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'Anthropic rate limit reached, try again shortly.' }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Anthropic API error ${error.status}: ${error.message}` }, { status: 502 });
    }
    return NextResponse.json({ error: (error as Error)?.message || 'AI chat failed' }, { status: 500 });
  }
}
