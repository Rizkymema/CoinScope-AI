# CoinScope AI

Memecoin intelligence terminal with one auto-trading bot, a Claude trade review / copilot and non-custodial Solana execution.

## Stack

- Next.js 15 / React 19 (App Router, route handlers for server-side proxies + AI)
- TypeScript, Tailwind CSS, Zustand (persisted), Lucide
- `@solana/web3.js` (transactions, keypairs), Phantom / Solflare wallet adapters via `window.solana`
- `@anthropic-ai/sdk` (Claude Opus 5.5 by default; Sonnet 5.5, Haiku 5.5 and Fable 5.1 selectable in Settings)

## What works

| Area | Source / mechanism |
| --- | --- |
| New Pump.fun mints (sub-second) | PumpPortal WebSocket `subscribeNewToken` (free, no key) |
| Per-token price ticks for open positions | PumpPortal `subscribeTokenTrade` (price = vSol / vTokens × SOL/USD) |
| New DEX pools on Solana / Base / ETH / BSC ... | GeckoTerminal `new_pools` + DexScreener token profiles |
| Trending / search / quotes | DexScreener |
| SOL/USD | DexScreener wSOL pair (Jupiter price API fallback) |
| Wallet | Phantom or Solflare extension, live SOL + SPL balances via JSON-RPC. The header and wallet dialog show which account is connected (wallet, full address, balance, Solscan link) |
| Solana RPC | Browser calls go through `/api/rpc`, a server-side proxy with an allow-list of methods and fallback across endpoints (the public mainnet RPC refuses browser requests with 403) |
| Bot wallet | Optional in-browser keypair that signs live trades without a wallet prompt, so auto-entry and take-profit work unattended. Encrypted with your password (PBKDF2 + AES-GCM); fund / withdraw / export from Settings |
| Live swaps (Solana only) | Jupiter aggregator (routes Pump.fun bonding curves, PumpSwap, Raydium, ...) with PumpPortal as fallback. Tx is built server-side, **signed in the wallet**, confirmed via RPC |
| Live pipeline dry run | Settings → *Test live pipeline*: builds the real swap for your address and runs `simulateTransaction` on the RPC. No signature, no funds |
| Paper trading | Virtual $1,000 balance. Fills come from a real Jupiter quote of the same size (price impact + venue fee + network fee), or a pool-depth model for tokens Jupiter has not indexed yet |
| Guardrails | Daily loss limit pauses the auto-bot; failed exits back off instead of retrying every tick; a late-landing transaction is detected from the balance change instead of being reported as failed |
| Auto trade | **Auto Trade** tab: one switch. Every minute the setup scanner (RugCheck gates, clone filter, breakout / flag / pullback / RSI-rebound / momentum setups, Jupiter sell-back test) finds Ready signals; Claude reviews each one against the entry procedure in `skill memcoin.md`; approved signals are bought with the signal's stop and target and managed with TP / SL / profit lock. Daily loss limit pauses it |
| AI scorecard | `POST /api/ai/analyze` – structured JSON from Claude, heuristic fallback without a key |
| Convergence AI gate | `POST /api/ai/convergence` - stage-4 reviewer of the smart-wallet convergence flow: ENTRY / WATCH / SKIP + confidence, red flags, reasons, what must happen to reach ENTRY, missing data |
| AI trade gate | `POST /api/ai/decide` – `{signal}` → BUY/SKIP + confidence + stop/target (tighten only) + size factor, for every Ready signal before auto trade buys it |
| Auto Trade desk | Live chart of the focused token (open position, the candidate Claude is reviewing, or a Ready signal) with entry / stop / target / profit-lock lines and fill markers; a pipeline panel that shows each scan stage with how many tokens survived it, the Claude review and the entry; position cards with live price, sparkline and stop-to-target bar; realized P&L curve. The chart reuses candles the scanner and launch watcher already hold, so it adds almost no API calls |
| AI copilot chat | `POST /api/ai/chat` – Claude with tools (`get_new_coins`, `snipe_token`, `sell_position`, `update_settings`, `start_bot`, ...). Tools execute in the browser against the bot store |
| Exits | Take-profit, stop-loss, trailing stop, manual / AI partial sells |

## Smart-wallet convergence flow (default entry strategy)

Auto trade's default entry policy. The bot enters a token only after it passes four gates in order; exits run on their own. Every threshold below is a starting point to test in paper mode (Auto Trade → *Convergence thresholds*), not a proven value.

| Stage | What runs | Defaults |
| --- | --- | --- |
| 0 · Smart wallets | Wallet list with tier (A/B), source, cluster and notes. *Verify on-chain* reads the wallet's last 150 transactions: tokens traded, win rate, realized profit, best-trade share, average hold, deployer flag and the funding wallet (wallets funded from one non-exchange source become one cluster). 30/90-day profit can be typed in from Kolscan / GMGN / Nansen | ≥ 20 tokens / 30d, win rate ≥ 40%, profit > 0 at 30d and 90d, best trade < 50% of profit, hold > 2 min, inactive after 14 days |
| 1 · Convergence | `walletwatch.service` polls each wallet through Solana RPC (`getSignaturesForAddress` → `getTransaction`, parsed into swaps) plus PumpPortal's account-trade stream. Tier points per buy, each cluster counted once | A = 2, B = 1, ≥ 3 points in 15 min, buys < 0.2 SOL ignored, too late above 3x the first trigger wallet's price or once it sold |
| 2 · Safety (hard gate) | RugCheck report, on-chain mint/freeze read, Jupiter buy + sell-back quote. Bonding-curve tokens check curve progress instead of LP | authorities revoked, LP burned/locked and ≥ $10K, top 10 ≤ 30%, dev ≤ 5%, no rugged-token history, insider/bundle networks ≤ 20%, sellable with 0% tax and round trip ≤ 12% |
| 3 · Momentum 0-100 | GeckoTerminal 15-minute pool stats and trade list | holders 25 · unique buyers:sellers 20 · top-5 wallet volume share 20 · trigger wallet buys again 15 · social 10 · narrative 10; ≥ 60 → AI, 40-59 → watchlist (re-checked for 30 min), < 40 dropped; wash trading zeroes the two volume metrics |
| 4 · AI | `POST /api/ai/convergence` with the document's system prompt (rejection-seeking reviewer, JSON verdict). Code-detected critical red flags skip before the AI | only `ENTRY` with confidence ≥ 70 trades; unparseable = SKIP |
| 5 · Execution | Paper or live, through the same buy path as the rest of the bot | 1.5% of trading capital per entry, max 5 open, daily loss 5% of capital, price impact ≤ 3%, slippage ≤ 15%, cancelled after a +30% run since the signal, never averaging down |
| 6 · Exits | Per-position exit plan (`lib/exit-plan.ts`), emergency exits watched by the convergence store and retried every tick until filled | 50% at 2x, 25% of the original at 5x, moonbag trails 40% under the high, stop −35%, 60-min time stop without +30%; emergency when 2 trigger wallets sell > 50%, the dev sells, or liquidity drops 50% |
| 7 · Journal | Every signal, rejected ones too, with the gate it stopped at, the snapshot the AI saw, price at +5m / +1h / +6h / +24h (backfilled from candles when the tab was closed) and the net result. *Weekly review*: wallet win/loss with tier suggestions, gates that dropped later 2x runners, AI vs momentum-only, win rate / average win / average loss / max drawdown / expectancy. CSV and JSON export | |

Notes and limits:

- The monitor makes one RPC call per wallet per cycle plus one per new trade. Set a private RPC (`SOLANA_RPC_URL`, or the RPC field in Settings); the public endpoint rate-limits quickly.
- Like the rest of the engine it runs in the open dashboard tab. *Observe: on* in the convergence panel records signals while auto trade is off.
- Social activity and mention growth are not measured (link presence only, up to 5 of 10 points); the week's narratives are a keyword list you set.
- "Bundle in early blocks" uses RugCheck's insider networks; dev rug history uses RugCheck's creator risks and token count. KOL and insider-bundle wallets in the list are not detected automatically - pause or remove them.
- Without `ANTHROPIC_API_KEY` no convergence entry is taken unless *AI verdict required* is switched off (then only momentum ≥ 75 may trade).
- *Chart setups* and *Both* keep the original setup scanner and launch watcher as entry sources. Sessions saved before this change had auto trade switched off once so the new strategy is armed with a fresh Start.

## Quick start

```bash
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY (and ideally a private Solana RPC)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign in, then **Auto Trade** tab → *Start auto trade* (paper mode by default).

### Login

The dashboard and its API routes are behind a login page (`/login`). The default user is `user1`; the
default password is stored only as a hash. Because this repository is public, set your own credentials
on the server with `COINSCOPE_LOGIN_USER` / `COINSCOPE_LOGIN_PASSWORD` (Vercel → Settings → Environment
Variables). Sessions last 30 days and renew while the dashboard is in use; the log-out button is in the
header. `/api/mcp`, `/api/oauth/*` and `/api/bridge/*` keep their own `COINSCOPE_ACCESS_KEY` auth.

Tabs: **Market** (DexScreener-style list, chart, trades, safety check, buy), **New Launches**, **Auto Trade** (the one switch, signals, positions, log, history) and **Settings** (money and wallets, sizing, Claude model, RPC, MCP). There is one bot: the old launch sniper was folded into auto trade's launch watcher.

## Going live (real funds)

1. Run the bot on paper first and look at the results in History - paper fills include real price impact and fees.
2. Pick who signs live trades under **Bot > Settings > Execution mode**:
   - **Your wallet** (Phantom / Solflare): every buy and sell opens an approval prompt. Safe, but the bot cannot trade while you are away.
   - **Bot wallet**: create one (or import a dedicated key), back up the key with *Export key*, fund it with *Fund from wallet*, keep it unlocked. Trades are signed automatically. It is a hot wallet - keep only trading money in it and *Withdraw* the rest.
3. Set a private RPC (Helius, QuickNode, Triton) in Settings or as `SOLANA_RPC_URL` on the server. The built-in proxy falls back to public endpoints, which are rate-limited.
4. Click **Test live pipeline** in the same panel. It builds the real swap for the signing address and simulates it on the RPC; nothing is signed.
5. Set the **daily loss limit** and a small buy size, then toggle **Live trading** and press **Start auto trade**. Hitting the daily loss limit pauses new entries until midnight; open positions keep being managed.
6. Keep the tab open in the foreground on a PC that does not sleep (the page keeps the screen awake, plays an inaudible tone so the browser does not throttle it, and warns before closing). The engine runs in the browser: closing the tab stops entries, exits and the profit lock. A 24-hour run means a 24-hour open tab; there is no server-side engine (Vercel functions cannot run a loop).

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
2. Open the dashboard → **Bot → Strategy → MCP integration**. The panel shows the ready-to-copy server URL, the access-key field and copy-paste config for Claude Code, `mcp.json` clients and stdio clients. The bot banner shows *MCP secured* once the bridge connects.
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

### Clients that require OAuth instead of a Bearer token

Some connector forms (Google Gemini's is the one that prompted this) don't accept a pasted API
key or Bearer token - they only offer OAuth, asking for a Client ID and Client Secret. CoinScope
ships a minimal OAuth 2.0 `client_credentials` wrapper around the same access key:

1. Set `COINSCOPE_OAUTH_CLIENT_ID` and `COINSCOPE_OAUTH_CLIENT_SECRET` on the server (any values;
   the Settings panel displays them once both are set alongside `COINSCOPE_ACCESS_KEY`).
2. In the client's connector form, use `Bot > Settings > MCP integration > OAuth credentials` for
   the Client ID / Client Secret. If it asks for endpoints directly: Token URL
   `https://<domain>/api/oauth/token`, Discovery URL
   `https://<domain>/.well-known/oauth-authorization-server`.
3. The token endpoint exchanges those for a Bearer token equal to `COINSCOPE_ACCESS_KEY`, so
   `/api/mcp` needs no separate configuration - OAuth is just another door to the same secret.

This is a `client_credentials` (machine-to-machine) flow only, not a full user-consent
authorization-code flow - it has no login screen or redirect URI. If a client insists on the
latter, it needs its own implementation.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | for AI features | Claude scoring, trade gate and copilot chat (server-side only) |
| `ANTHROPIC_MODEL` | no | Server default model id (default `claude-opus-5-5`); the dashboard can pick another per request from the list in `src/lib/ai-models.ts` |
| `SOLANA_RPC_URL` | recommended (needed for the convergence monitor in practice) | Private RPC used by the `/api/rpc` proxy, the smart-wallet monitor and the token safety check (kept server-side) |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | no | RPC the browser calls directly instead of the proxy (exposed to the client) |
| `JUPITER_API_KEY` | no | Uses `lite-api.jup.ag` free tier when empty |
| `COINSCOPE_ACCESS_KEY` | for MCP | Shared secret for `/api/mcp` and the browser bridge |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Vercel | Upstash Redis for the bridge (auto-injected by the Marketplace integration) |

## Design system

One font family (Manrope), one accent (`#00d2ff`), solid obsidian surfaces, 1px hairline borders and a 12px card radius.
Tokens live on `:root` in `src/app/globals.css`; `.panel`, `.btn`, `.field`, `.chip`, `.tab`, `.row` and `.dot` are the shared
primitives. House rules: the accent is reserved for actions, shadows appear only on hover/focus/overlays, no glassmorphism or
gradient fills, icons are vector (Lucide) and never emoji, and motion stays in the 150-200ms range with
`prefers-reduced-motion` honoured.

## Project structure

```
src/
├── app/
│   ├── api/ai/{analyze,decide,chat}/   # Claude routes
│   ├── api/trade/                       # PumpPortal local-trade proxy (unsigned tx)
│   ├── api/jupiter/                     # Jupiter quote + swap proxy
│   ├── api/rpc/                         # Solana JSON-RPC proxy (allow-listed methods, endpoint fallback)
│   ├── api/token/safety/                # on-chain mint / freeze authority check
│   ├── api/pumpfun/latest/              # pump.fun REST proxy (CORS)
│   ├── api/metadata/                    # IPFS token metadata resolver
│   ├── api/mcp/                         # MCP server (Streamable HTTP) for external AI clients
│   └── api/bridge/sync/                 # dashboard <-> server bridge used by the MCP bot tools
├── components/                          # UI (bot/ = dashboard panels)
├── hooks/                               # useKeepAlive (wake lock + close warning while trading)
├── lib/                                 # ai-server, bot-tool-executor, bridge-store, server-data, server-auth, solana-rpc, rate-limit
├── services/                            # websocket, pumpfun, coin, trade, wallet, hotwallet, paperfill, solprice, ai
├── store/                               # Zustand stores (useBotStore is persisted)
└── types/
```

## Risk notice

Memecoin sniping is extremely high risk; most new tokens lose all value. The AI gate and the on-chain mint/freeze-authority check reduce obvious rugs but cannot see every contract-level risk. Start in paper mode, use small sizes, a daily loss limit and a private RPC.
