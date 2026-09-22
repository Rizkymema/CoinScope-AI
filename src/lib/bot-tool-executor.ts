/**
 * Executes the AI control-chat tools against the browser-side bot store.
 * Every tool returns a JSON string that is sent back to the model as a tool_result.
 */
import { useBotStore } from '../store/useBotStore';
import { CoinData } from '../types/coin';
import { BotPosition, BotSettings } from '../types/bot';

const SETTABLE_KEYS: (keyof BotSettings)[] = [
  'buyAmountUsd',
  'takeProfitPercent',
  'stopLossPercent',
  'trailingStopPercent',
  'minLiquidityUsd',
  'maxTokenAgeMinutes',
  'maxPositions',
  'slippagePercent',
  'minBondingCurvePercent',
  'targetChain',
  'launchPlatform',
  'autoSell',
  'paperTrading',
  'targetOnlyMode',
  'aiGateEnabled',
  'aiMinConfidence',
  'aiAdjustTargets',
  'soundAlerts',
  'priorityFeeSol',
];

function coinSummary(c: CoinData) {
  return {
    id: c.id,
    symbol: c.symbol,
    name: c.name,
    chain: c.chainId,
    mint: c.mint,
    priceUsd: c.priceUsd,
    marketCapUsd: Math.round(c.fundamentals.marketCap),
    liquidityUsd: Math.round(c.fundamentals.tvl || 0),
    volume24hUsd: Math.round(c.fundamentals.volume24h),
    change5m: c.priceChange5m ?? null,
    change1h: c.priceChange1h ?? null,
    change24h: c.priceChange24h,
    ageMinutes: c.createdAt ? Math.round((Date.now() - c.createdAt) / 60_000) : null,
    isPumpFun: !!c.isPumpFun,
    bondingCurvePercent: c.bondingCurve ?? null,
    graduated: c.graduated ?? null,
    txns24h: c.txns24h || null,
    socials: (c.socials || []).map((s) => s.type),
    source: c.source,
  };
}

function positionSummary(p: BotPosition) {
  return {
    id: p.id,
    symbol: p.coin.symbol,
    name: p.coin.name,
    chain: p.coin.chainId,
    mode: p.isLive ? 'live' : 'paper',
    entryPriceUsd: p.buyPriceUsd,
    currentPriceUsd: p.currentPriceUsd,
    investedUsd: p.amountUsd,
    valueUsd: p.tokensBought * p.currentPriceUsd,
    pnlUsd: Number(p.pnlUsd.toFixed(2)),
    pnlPercent: Number(p.pnlPercent.toFixed(1)),
    tpPriceUsd: p.tpPriceUsd,
    slPriceUsd: p.slPriceUsd,
    highPriceUsd: p.highPriceUsd,
    openedMinutesAgo: Math.round((Date.now() - p.boughtAt) / 60_000),
    buyTx: p.buyTxSignature,
    aiDecision: p.aiDecision ? { action: p.aiDecision.action, confidence: p.aiDecision.confidence, reason: p.aiDecision.reason } : null,
  };
}

function findPosition(query: string): BotPosition | undefined {
  const q = String(query || '').trim().toLowerCase().replace(/^\$/, '');
  const { positions } = useBotStore.getState();
  return positions.find((p) => p.id.toLowerCase() === q) || positions.find((p) => p.coin.symbol.toLowerCase() === q) || positions.find((p) => (p.mint || '').toLowerCase() === q);
}

export async function executeBotTool(name: string, input: any): Promise<{ result: string; isError?: boolean }> {
  const store = useBotStore.getState();
  const ok = (data: unknown) => ({ result: JSON.stringify(data) });
  const fail = (message: string) => ({ result: JSON.stringify({ error: message }), isError: true });

  try {
    switch (name) {
      case 'get_bot_status':
        return ok(store.getSnapshot());

      case 'get_new_coins': {
        const limit = Math.min(40, Math.max(1, Number(input?.limit) || 15));
        let coins = store.recentCoins;
        if (input?.chain) coins = coins.filter((c) => (c.chainId || '').toLowerCase() === String(input.chain).toLowerCase());
        if (input?.pumpfun_only) coins = coins.filter((c) => c.isPumpFun);
        return ok({ count: coins.length, coins: coins.slice(0, limit).map(coinSummary) });
      }

      case 'get_positions':
        return ok({ count: store.positions.length, positions: store.positions.map(positionSummary) });

      case 'get_trade_history': {
        const limit = Math.min(50, Math.max(1, Number(input?.limit) || 20));
        return ok({ stats: store.getStats(), trades: store.history.slice(0, limit) });
      }

      case 'start_bot': {
        if (store.isActive) return ok({ status: 'already running' });
        store.toggleBot(true);
        const after = useBotStore.getState();
        return after.isActive ? ok({ status: 'started', mode: after.settings.paperTrading ? 'paper' : 'live' }) : fail('Bot did not start (live mode needs a connected wallet).');
      }

      case 'stop_bot': {
        if (!store.isActive) return ok({ status: 'already paused' });
        store.toggleBot(false);
        return ok({ status: 'paused', openPositions: useBotStore.getState().positions.length });
      }

      case 'update_settings': {
        const patch: Partial<BotSettings> = {};
        SETTABLE_KEYS.forEach((k) => {
          if (input && input[k] !== undefined && input[k] !== null) (patch as any)[k] = input[k];
        });
        if (Object.keys(patch).length === 0) return fail('No valid settings supplied.');
        if (patch.paperTrading === false && !store.settings.phantomWalletConnected) {
          return fail('Cannot enable live trading: no wallet connected. Ask the user to connect Phantom/Solflare first.');
        }
        store.updateSettings(patch);
        store.log('ai', `[AI CONTROL] Settings updated: ${JSON.stringify(patch)}`);
        const { whitelistedSymbols, connectedWalletAddress, ...rest } = useBotStore.getState().settings;
        return ok({ updated: patch, settings: { ...rest, whitelistedSymbols, walletConnected: !!connectedWalletAddress } });
      }

      case 'snipe_token': {
        const coin = store.findCoin(String(input?.token || ''));
        if (!coin) return fail(`Token "${input?.token}" not found in the scanner. Use get_new_coins to list available tokens.`);
        const res = await store.manualSnipeCoin(coin, input?.amountUsd ? Number(input.amountUsd) : undefined, `AI: ${input?.reason || 'manual via chat'}`);
        const pos = useBotStore.getState().positions.find((p) => p.coin.id === coin.id);
        return res.success ? ok({ ...res, position: pos ? positionSummary(pos) : null }) : fail(res.message);
      }

      case 'sell_position': {
        const pos = findPosition(input?.position);
        if (!pos) return fail(`Position "${input?.position}" not found. Use get_positions.`);
        const res = await store.closePosition(pos.id, 'AI_SELL', input?.percent ? Number(input.percent) : 100);
        if (input?.reason) store.log('ai', `[AI CONTROL] Sell ${pos.coin.symbol}: ${input.reason}`, { coinSymbol: pos.coin.symbol });
        return res.success ? ok(res) : fail(res.message);
      }

      case 'set_position_targets': {
        const pos = findPosition(input?.position);
        if (!pos) return fail(`Position "${input?.position}" not found.`);
        const done = store.setPositionTargets(pos.id, input?.takeProfitPercent ? Number(input.takeProfitPercent) : undefined, input?.stopLossPercent ? Number(input.stopLossPercent) : undefined);
        const updated = useBotStore.getState().positions.find((p) => p.id === pos.id);
        return done && updated ? ok(positionSummary(updated)) : fail('Could not update targets.');
      }

      case 'manage_targets': {
        (Array.isArray(input?.add) ? input.add : []).forEach((s: string) => store.addTargetSymbol(String(s)));
        (Array.isArray(input?.remove) ? input.remove : []).forEach((s: string) => store.removeTargetSymbol(String(s)));
        return ok({ whitelistedSymbols: useBotStore.getState().settings.whitelistedSymbols, targetOnlyMode: store.settings.targetOnlyMode });
      }

      case 'dry_run_live_trade': {
        const r = await store.dryRunLiveTrade(input?.token ? String(input.token) : undefined, input?.amountUsd ? Number(input.amountUsd) : undefined);
        return r.success ? ok(r) : fail(r.message);
      }

      case 'get_bot_logs': {
        const limit = Math.min(60, Math.max(1, Number(input?.limit) || 20));
        return ok({ logs: store.logs.slice(0, limit) });
      }

      case 'connect_wallet': {
        await store.connectWallet();
        const s = useBotStore.getState().settings;
        return s.phantomWalletConnected
          ? ok({ connected: true, address: s.connectedWalletAddress, solBalance: s.solBalance, walletType: s.walletType })
          : fail('Wallet connection was rejected or no wallet extension is installed.');
      }

      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (err: any) {
    return fail(err?.message || 'Tool execution failed');
  }
}
