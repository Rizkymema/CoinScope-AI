# CoinScope AI

Memecoin intelligence terminal with a real-time auto-snipe bot, AI trade gate / copilot (Claude) and non-custodial Solana execution.

## Stack

- Next.js 14 (App Router, route handlers for server-side proxies + AI)
- TypeScript, Tailwind CSS, Zustand (persisted), Lucide
- `@solana/web3.js` (transaction deserialization), Phantom / Solflare wallet adapters via `window.solana`
- `@anthropic-ai/sdk` (Claude Opus 5 by default)

## What works

| Area | Source / mechanism |
| --- | --- |
| New Pump.fun mints (sub-second) | PumpPortal WebSocket `subscribeNewToken` (free, no key) |
| Per-token price ticks for open positions | PumpPortal `subscribeTokenTrade` (price = vSol / vTokens × SOL/USD) |
| New DEX pools on Solana / Base / ETH / BSC ... | GeckoTerminal `new_pools` + DexScreener token profiles |
| Trending / search / quotes | DexScreener |
| SOL/USD | DexScreener wSOL pair (Jupiter price API fallback) |
| Wallet | Phantom or Solflare extension, live SOL + SPL balances via JSON-RPC |
| Live swaps (Solana only) | Jupiter aggregator (routes Pump.fun bonding curves, PumpSwap, Raydium, ...) with PumpPortal as fallback. Tx is built server-side, **signed in the wallet**, confirmed via RPC |
| Live pipeline dry run | Settings → *Test live pipeline*: builds the real swap for your address and runs `simulateTransaction` on the RPC. No signature, no funds |
| Paper trading | Same real prices, virtual $1,000 balance (default mode) |
| AI scorecard | `POST /api/ai/analyze` – structured JSON from Claude, heuristic fallback without a key |
| AI trade gate | `POST /api/ai/decide` – BUY/SKIP + confidence + suggested TP/SL before every automatic buy |
| AI copilot chat | `POST /api/ai/chat` – Claude with tools (`get_new_coins`, `snipe_token`, `sell_position`, `update_settings`, `start_bot`, ...). Tools execute in the browser against the bot store |
| Exits | Take-profit, stop-loss, trailing stop, manual / AI partial sells |

## Quick start

```bash
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY (and ideally a private Solana RPC)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → **Auto Bot** tab → *Start Auto-Sniper* (paper mode).

## Going live (real funds)

1. Install Phantom or Solflare and connect it (header button or bot banner).
2. Bot → *Pump.fun & Safety Strategy* → toggle **Live trading** (only enabled when a wallet is connected).
3. Set a private RPC (`NEXT_PUBLIC_SOLANA_RPC_URL`) – the public endpoint is heavily rate-limited.
4. Click **Test live pipeline (dry run)** in the same panel. It builds the real swap for your address and simulates it on the RPC; a green result means price oracle, routing, wallet address and RPC all work.
5. Every buy/sell opens a wallet signing prompt. Nothing is sent without your signature and no private key ever leaves the extension.

Live execution is Solana-only. Tokens on EVM chains are always paper-traded.

## MCP server - connect any AI

The app exposes a Model Context Protocol server at **`/api/mcp`** (Streamable HTTP). Any MCP client
(Claude Desktop, Claude Code, Cursor, Windsurf, ChatGPT connectors, custom agents) can read the market feed and drive the bot.

| Tool | Runs where |
| --- | --- |
| `get_new_coins`, `get_trending_coins`, `search_coins`, `get_token`, `analyze_token`, `get_sol_price` | server (always available) |
| `get_bot_status`, `get_positions`, `get_trade_history`, `get_bot_logs`, `start_bot`, `stop_bot`, `update_settings`, `snipe_token`, `sell_position`, `set_position_targets`, `manage_targets`, `dry_run_live_trade` | forwarded to the **open dashboard tab** through the bridge (`/api/bridge/sync`) - the bot engine and the wallet live in the browser |

Setup:

1. Set `COINSCOPE_ACCESS_KEY` on the server (`.env.local` or Vercel env).
2. Open the dashboard → **Login / Connect Wallet → MCP Access Key** → paste the same key. The bot banner shows *MCP secured* when the bridge is connected.
3. Add the server to your client:

```bash
# Claude Code
claude mcp add --transport http coinscope https://<your-domain>/api/mcp --header "Authorization: Bearer <COINSCOPE_ACCESS_KEY>"
```

```json
// Cursor / Windsurf / Claude Desktop (remote MCP) - mcp.json
{
  "mcpServers": {
    "coinscope": {
      "url": "https://<your-domain>/api/mcp",
      "headers": { "Authorization": "Bearer <COINSCOPE_ACCESS_KEY>" }
    }
  }
}
```

```json
// Clients that only support stdio servers: bridge with mcp-remote
{
  "mcpServers": {
    "coinscope": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-domain>/api/mcp", "--header", "Authorization:Bearer <COINSCOPE_ACCESS_KEY>"]
    }
  }
}
```

On Vercel add **Upstash Redis** from the Marketplace (free tier) so bridge state is shared across serverless instances; the env vars are injected automatically. Without it the bridge falls back to process memory, which is fine locally but unreliable on serverless.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | for AI features | Claude scoring, trade gate and copilot chat (server-side only) |
| `ANTHROPIC_MODEL` | no | Override model id (default `claude-opus-5`) |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | recommended | Balance / confirmation RPC |
| `JUPITER_API_KEY` | no | Uses `lite-api.jup.ag` free tier when empty |
| `COINSCOPE_ACCESS_KEY` | for MCP | Shared secret for `/api/mcp` and the browser bridge |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Vercel | Upstash Redis for the bridge (auto-injected by the Marketplace integration) |

## Project structure

```
src/
├── app/
│   ├── api/ai/{analyze,decide,chat}/   # Claude routes
│   ├── api/trade/                       # PumpPortal local-trade proxy (unsigned tx)
│   ├── api/jupiter/                     # Jupiter quote + swap proxy
│   ├── api/pumpfun/latest/              # pump.fun REST proxy (CORS)
│   ├── api/metadata/                    # IPFS token metadata resolver
│   ├── api/mcp/                         # MCP server (Streamable HTTP) for external AI clients
│   └── api/bridge/sync/                 # dashboard <-> server bridge used by the MCP bot tools
├── components/                          # UI (bot/ = dashboard panels)
├── lib/                                 # ai-server, bot-tool-executor, bridge-store, server-data, server-auth
├── services/                            # websocket, pumpfun, coin, trade, wallet, solprice, ai
├── store/                               # Zustand stores (useBotStore is persisted)
└── types/
```

## Risk notice

Memecoin sniping is extremely high risk; most new tokens lose all value. The AI gate reduces obvious rugs but cannot see contract-level risks (mint authority, freeze, honeypots). Start in paper mode, use small sizes and a private RPC.
