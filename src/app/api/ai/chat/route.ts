import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import Anthropic from '@anthropic-ai/sdk';
import { CHAT_MAX_TOKENS, TRADING_SYSTEM_PROMPT, aiErrorNote, getAnthropic, hasAnthropicCredentials, modelFor } from '@/lib/ai-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
/** Ends the Claude call before Vercel's 60 s limit, so a slow answer still returns JSON. */
const CHAT_TIMEOUT_MS = 52_000;

/**
 * Chat endpoint with bot-control tools.
 * The model runs server-side; tool calls are executed CLIENT-side (the bot state lives in the
 * browser store), so this route returns the raw assistant content and the client loops:
 *   POST -> tool_use blocks -> client executes -> POST again with tool_result blocks -> ... -> end_turn
 *
 * The client sends Claude's thinking blocks back with the history, and each block is only valid
 * while the system prompt, the tools and every earlier message are byte-identical to when it was
 * written. So the system prompt here never changes, and the live bot snapshot travels inside each
 * user message instead (AIJudgeChat).
 */
const BOT_TOOLS: Anthropic.Beta.BetaTool[] = [
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
    name: 'get_scanner_signals',
    description:
      'Latest result of the Auto Trade setup scanner: Ready signals (setup confirmed, safety gates passed, sell-back tested) with entry zone, stop, target, score and net reward/risk; Watch signals with what they wait for; and the most common rejection reasons. Use it for "what can I enter now?" questions - snipe_token accepts these symbols or mints and then uses the signal\'s own stop and target.',
    input_schema: {
      type: 'object',
      properties: { include_watch: { type: 'boolean', description: 'Also list Watch signals (default true).' } },
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
    description: 'Switch on auto trade, the one bot: it scans every minute, has Claude review Ready signals and buys the approved ones. Real funds when paperTrading is false - only on explicit user instruction.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'stop_bot',
    description: 'Switch off auto trade. No new entries; open positions are kept and still managed.',
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
        profitLockTriggerPercent: { type: 'number', minimum: 0, maximum: 1000, description: 'Once a position is up this %, raise its stop above cost. 0 = off.' },
        profitLockPercent: { type: 'number', minimum: 0, maximum: 500, description: 'Profit the raised stop keeps, above cost (covers sell fees).' },
        dailyLossLimitUsd: { type: 'number', minimum: 0, description: "Pause the auto-bot once today's realized loss reaches this many USD. 0 = off." },
        scannerMode: {
          type: 'string',
          enum: ['strict', 'simple'],
          description: "Scanner entries: 'simple' also buys 5m momentum breakouts as they happen; 'strict' waits for retests and pullbacks.",
        },
        scannerAutoBuy: {
          type: 'boolean',
          description: 'Let the setup scanner buy Ready signals by itself (score >= 70, sell-back quote passed, within maxPositions and the daily loss limit). Spends real funds when paperTrading is false - only on explicit user instruction.',
        },
        scanLaunches: {
          type: 'boolean',
          description: 'Launch watcher: follow each new Pump.fun token for 30 min; auto trade may buy ones with fast buying, clean RugCheck holder checks and an RSI dip (stop <= 12%, 15-min time stop).',
        },
        aiModel: {
          type: 'string',
          enum: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
          description: 'Claude model used by the trade gate and this chat.',
        },
        maxPositions: { type: 'integer', minimum: 1, maximum: 50 },
        slippagePercent: { type: 'number', minimum: 0.5, maximum: 50 },
        autoSell: { type: 'boolean' },
        paperTrading: { type: 'boolean' },
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
        takeProfitPercent: { type: 'number', minimum: 1, maximum: 2000, description: 'Overrides the settings take-profit for this position only.' },
        stopLossPercent: { type: 'number', minimum: 1, maximum: 95, description: 'Overrides the settings stop-loss for this position only.' },
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
    description: 'Add or remove symbols / addresses on the Market-tab watchlist. It does not change what auto trade buys.',
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
- Always call tools before answering questions about coins, positions, balances or settings; never guess numbers. get_scanner_signals for what is ready to enter now, get_new_coins for launches, get_positions / get_trade_history for the book, get_bot_status for configuration.
- When the user asks what to buy, start from get_scanner_signals: Ready signals already passed the safety gates and the sell-back test and carry a stop and target whose reward beats the risk after fees. Buying one with snipe_token keeps those levels. No setup can guarantee a profit; say so plainly when asked, and explain the stop and target instead.
- When asked to trade, change strategy, or start/stop the bot, do it with the tools, then report exactly what happened: fills, amounts, tx signatures, rejections and errors. Never claim a trade executed unless the tool result says success.
- When asked for a recommendation, deliver a professional desk note: (1) verdict, (2) key metrics, (3) risk grade and what could go wrong, (4) concrete plan - size, TP/SL, invalidation, (5) what you would monitor next. Offer to execute the plan; execute immediately only when the user has asked for action.
- Manage the portfolio like a risk manager: flag over-exposure (too many open positions, oversized buys vs. balance), stale positions with fading flow, positions near TP/SL, and settings that are inconsistent (e.g. a buy size that is a large share of the balance, AI review off in live mode, a daily loss limit of 0). Suggest specific corrections with numbers.
- Switching paperTrading to false puts real funds at risk. Do that only on an explicit instruction, confirm the wallet is connected first, and state the risk in one sentence. Prefer conservative sizes for a first live run.
- Educate briefly when useful (what a bonding curve is, why liquidity/mcap matters, why slippage is set high for new launches), but keep answers tight.
- Reply in the user's language (Indonesian when they write Indonesian; keep crypto terms like liquidity, market cap, TP/SL, bonding curve in English). Use short bullet lists for multiple coins. Format prices with sensible precision (e.g. $0.00001234, MCap $12.5K).`;

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, 'ai-chat', 30, 60_000);
  if (limited) return limited;
  if (!hasAnthropicCredentials()) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured on the server. Add it to .env.local to enable AI chat and control.' },
      { status: 503 }
    );
  }

  let messages: Anthropic.Beta.BetaMessageParam[];
  let model: string;
  try {
    const body = await req.json();
    messages = Array.isArray(body?.messages) ? body.messages : [];
    model = modelFor(body?.model);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (messages.length === 0) return NextResponse.json({ error: 'messages is required' }, { status: 400 });

  try {
    const client = getAnthropic();
    const response = await client.beta.messages.create(
      {
        model,
        // Thinking is always on for these models and counts toward max_tokens: 4096 at high effort
        // could be spent entirely on thinking and come back with no answer at all.
        max_tokens: CHAT_MAX_TOKENS,
        betas: ['thinking-binding-controls-2026-08-01'],
        // A history that still breaks the binding (a tab from before this fix, a model switch) loses
        // the affected thinking blocks instead of failing the whole turn with a 400.
        thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
        system: [{ type: 'text', text: CONTROL_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: BOT_TOOLS,
        // 'high' regularly ran past the 60 s function limit on Vercel, which answers with an HTML 504
        // page instead of JSON - the "AI error" in the chat. 'medium' answers well inside it.
        output_config: { effort: 'medium' },
        messages,
      },
      // One attempt that ends before the platform kills the function, so the client always gets JSON.
      { timeout: CHAT_TIMEOUT_MS, maxRetries: 0 }
    );

    // Cut off by max_tokens: a trailing tool_use may hold half its input, and running a trade tool
    // on half an input is worse than asking again.
    if (response.stop_reason === 'max_tokens') {
      return NextResponse.json({ error: 'The AI answer was cut off (token limit). Ask again with a shorter or more specific instruction.' }, { status: 502 });
    }

    return NextResponse.json({
      content: response.content,
      stop_reason: response.stop_reason,
      stop_details: response.stop_reason === 'refusal' ? response.stop_details : null,
      model: response.model,
      usage: response.usage,
    });
  } catch (error) {
    const status =
      error instanceof Anthropic.APIConnectionTimeoutError
        ? 504
        : error instanceof Anthropic.RateLimitError
        ? 429
        : error instanceof Anthropic.APIError
        ? 502
        : 500;
    return NextResponse.json({ error: aiErrorNote(error) }, { status });
  }
}
