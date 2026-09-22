import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';
import { BridgeStore, bridgeBackend } from '@/lib/bridge-store';
import { authRequired, getAccessKey, keysMatch } from '@/lib/server-auth';
import { getNewCoinsServer, getSolPriceServer, getTokenServer, getTrendingServer, searchCoinsServer, summarizeCoin } from '@/lib/server-data';
import { heuristicScore, heuristicDecision, hasAnthropicCredentials } from '@/lib/ai-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * CoinScope MCP server (Streamable HTTP).
 *   URL:   https://<host>/api/mcp
 *   Auth:  Authorization: Bearer <COINSCOPE_ACCESS_KEY>   (only enforced when the env var is set)
 *
 * Market tools run entirely on the server. Bot tools are forwarded to the browser dashboard
 * through the bridge (the bot engine + wallet live in the browser), so the dashboard tab must be open.
 */

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });

async function viaBridge(tool: string, input: Record<string, unknown>, timeoutMs = 20_000) {
  const r = await BridgeStore.execute(tool, input, timeoutMs);
  let parsed: unknown = r.result;
  try {
    parsed = JSON.parse(r.result);
  } catch {
    // keep raw text
  }
  return { content: [{ type: 'text' as const, text: typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2) }], isError: !r.ok };
}

const handler = createMcpHandler(
  (server) => {
    /* ----------------------------- market data (server-side) ----------------------------- */
    server.registerTool(
      'get_new_coins',
      {
        title: 'Newest memecoins',
        description:
          'Freshly launched tokens: Pump.fun mints plus new DEX pools on Solana, Base, Ethereum, BSC (newest first) with price, liquidity, market cap, momentum and age.',
        inputSchema: z.object({
          limit: z.number().int().min(1).max(50).optional().describe('Default 20'),
          chain: z.string().optional().describe("Filter by chain id: solana, base, ethereum, bsc, arbitrum"),
          pumpfun_only: z.boolean().optional(),
          max_age_minutes: z.number().int().min(1).optional(),
        }),
      },
      async ({ limit, chain, pumpfun_only, max_age_minutes }) => {
        const coins = await getNewCoinsServer({ limit: limit || 20, chain, pumpfunOnly: pumpfun_only, maxAgeMinutes: max_age_minutes });
        return text({ count: coins.length, coins: coins.map(summarizeCoin) });
      }
    );

    server.registerTool(
      'get_trending_coins',
      { title: 'Trending coins', description: 'Top boosted / most active tokens on DexScreener across chains.', inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }) },
      async ({ limit }) => text({ coins: (await getTrendingServer(limit || 20)).map(summarizeCoin) })
    );

    server.registerTool(
      'search_coins',
      { title: 'Search tokens', description: 'Search DexScreener by name, symbol or contract address.', inputSchema: z.object({ query: z.string().min(1) }) },
      async ({ query }) => text({ results: (await searchCoinsServer(query)).map(summarizeCoin) })
    );

    server.registerTool(
      'get_token',
      {
        title: 'Token quote',
        description: 'Latest market data for one token (best pair) by chain + contract/mint address.',
        inputSchema: z.object({ chain: z.string().default('solana'), address: z.string().min(20) }),
      },
      async ({ chain, address }) => {
        const c = await getTokenServer(chain, address);
        return c ? text(summarizeCoin(c)) : { ...text({ error: 'Token not found on DexScreener' }), isError: true };
      }
    );

    server.registerTool(
      'analyze_token',
      {
        title: 'Analyze token',
        description:
          'Rule-based scorecard (0-100), risk level, flags and a buy/skip decision for a token by chain + address. Deterministic; combine with your own judgement.',
        inputSchema: z.object({ chain: z.string().default('solana'), address: z.string().min(20), min_confidence: z.number().min(0).max(100).optional() }),
      },
      async ({ chain, address, min_confidence }) => {
        const c = await getTokenServer(chain, address);
        if (!c) return { ...text({ error: 'Token not found' }), isError: true };
        return text({ token: summarizeCoin(c), score: heuristicScore(c), decision: heuristicDecision(c, min_confidence ?? 60), claudeConfigured: hasAnthropicCredentials() });
      }
    );

    server.registerTool('get_sol_price', { title: 'SOL price', description: 'Current SOL/USD price.', inputSchema: z.object({}) }, async () => text({ solUsd: await getSolPriceServer() }));

    /* ----------------------------- bot control (via browser bridge) ----------------------------- */
    server.registerTool(
      'get_bot_status',
      {
        title: 'Bot status',
        description: 'Live bot state from the dashboard: running/paused, execution mode (paper/live), wallet, settings, stats, last AI decision. Requires the dashboard tab to be open.',
        inputSchema: z.object({}),
      },
      async () => {
        const state = await BridgeStore.getState();
        const online = await BridgeStore.isDashboardOnline();
        if (!state) return { ...text({ dashboardOnline: false, error: 'No dashboard has synced yet. Open the CoinScope web app and enter the access key.' }), isError: true };
        return text({ dashboardOnline: online, lastSyncSecondsAgo: Math.round((Date.now() - state.updatedAt) / 1000), bridgeBackend, ...state.snapshot });
      }
    );

    server.registerTool(
      'get_positions',
      { title: 'Open positions', description: 'Open bot positions with entry, current price, PnL, TP/SL.', inputSchema: z.object({}) },
      async () => viaBridge('get_positions', {})
    );

    server.registerTool(
      'get_trade_history',
      { title: 'Trade history', description: 'Closed trades with realized PnL.', inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }) },
      async ({ limit }) => viaBridge('get_trade_history', { limit: limit || 20 })
    );

    server.registerTool(
      'get_bot_logs',
      { title: 'Bot logs', description: 'Most recent bot log lines (skips, AI decisions, buys, sells, tx).', inputSchema: z.object({ limit: z.number().int().min(1).max(40).optional() }) },
      async ({ limit }) => {
        const state = await BridgeStore.getState();
        return text({ logs: (state?.logs || []).slice(0, limit || 20) });
      }
    );

    server.registerTool('start_bot', { title: 'Start bot', description: 'Start the auto-snipe bot in the dashboard.', inputSchema: z.object({}) }, async () => viaBridge('start_bot', {}));
    server.registerTool('stop_bot', { title: 'Pause bot', description: 'Pause the auto-snipe bot (positions stay monitored).', inputSchema: z.object({}) }, async () => viaBridge('stop_bot', {}));

    server.registerTool(
      'update_settings',
      {
        title: 'Update bot settings',
        description: 'Change strategy settings. paperTrading=false enables REAL on-chain trades - only on explicit user instruction.',
        inputSchema: z.object({
          buyAmountUsd: z.number().min(1).optional(),
          takeProfitPercent: z.number().min(5).max(2000).optional(),
          stopLossPercent: z.number().min(5).max(95).optional(),
          trailingStopPercent: z.number().min(0).max(90).optional(),
          minLiquidityUsd: z.number().min(0).optional(),
          maxTokenAgeMinutes: z.number().min(0).optional(),
          maxPositions: z.number().int().min(1).max(50).optional(),
          slippagePercent: z.number().min(0.5).max(50).optional(),
          minBondingCurvePercent: z.number().min(0).max(100).optional(),
          targetChain: z.enum(['all', 'solana', 'ethereum', 'base', 'bsc', 'arbitrum']).optional(),
          launchPlatform: z.enum(['all', 'pumpfun', 'dexscreener']).optional(),
          autoSell: z.boolean().optional(),
          paperTrading: z.boolean().optional(),
          targetOnlyMode: z.boolean().optional(),
          aiGateEnabled: z.boolean().optional(),
          aiMinConfidence: z.number().min(0).max(100).optional(),
          aiAdjustTargets: z.boolean().optional(),
          soundAlerts: z.boolean().optional(),
          priorityFeeSol: z.number().min(0).max(0.1).optional(),
        }),
      },
      async (input) => viaBridge('update_settings', input as Record<string, unknown>)
    );

    server.registerTool(
      'snipe_token',
      {
        title: 'Buy token',
        description: 'Buy a token through the bot (paper or live per settings). Identify by coin id (chain:address), mint address or symbol seen in get_new_coins.',
        inputSchema: z.object({ token: z.string().min(1), amountUsd: z.number().min(1).optional(), reason: z.string().optional() }),
      },
      async (input) => viaBridge('snipe_token', input, 45_000)
    );

    server.registerTool(
      'sell_position',
      {
        title: 'Sell position',
        description: 'Sell all or part of an open position (by position id or symbol).',
        inputSchema: z.object({ position: z.string().min(1), percent: z.number().min(1).max(100).optional(), reason: z.string().optional() }),
      },
      async (input) => viaBridge('sell_position', input, 45_000)
    );

    server.registerTool(
      'set_position_targets',
      {
        title: 'Set TP/SL',
        description: 'Update take-profit / stop-loss percent for an open position.',
        inputSchema: z.object({ position: z.string().min(1), takeProfitPercent: z.number().min(1).optional(), stopLossPercent: z.number().min(1).max(99).optional() }),
      },
      async (input) => viaBridge('set_position_targets', input)
    );

    server.registerTool(
      'manage_targets',
      {
        title: 'Manage target list',
        description: 'Add/remove symbols or addresses in the bot whitelist (used with targetOnlyMode).',
        inputSchema: z.object({ add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() }),
      },
      async (input) => viaBridge('manage_targets', input)
    );

    server.registerTool(
      'dry_run_live_trade',
      {
        title: 'Dry-run live pipeline',
        description: 'Builds a real swap for the connected wallet and simulates it on the RPC (no signature, no funds). Proves live execution works.',
        inputSchema: z.object({ token: z.string().optional(), amountUsd: z.number().min(1).optional() }),
      },
      async (input) => viaBridge('dry_run_live_trade', input, 45_000)
    );
  },
  {
    serverInfo: { name: 'coinscope-ai', version: '1.0.0' },
    instructions:
      'CoinScope AI memecoin sniper. Market tools (get_new_coins, search_coins, get_token, analyze_token, get_sol_price) work anytime. Bot tools need the CoinScope dashboard open in a browser (the bot + wallet run there). Most new memecoins go to zero - treat every trade as speculative and prefer paper mode until the user explicitly asks for live trading.',
  }
);

const authed = withMcpAuth(
  handler,
  (_req, bearerToken) => {
    if (!authRequired()) return { token: bearerToken || 'open', clientId: 'coinscope-open', scopes: ['bot'] };
    if (!bearerToken || !keysMatch(bearerToken, getAccessKey())) return undefined;
    return { token: bearerToken, clientId: 'coinscope', scopes: ['bot'] };
  },
  { required: authRequired() }
);

export { authed as GET, authed as POST, authed as DELETE };
