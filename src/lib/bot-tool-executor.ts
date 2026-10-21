/**
 * Executes the AI control-chat tools against the browser-side bot store.
 * Every tool returns a JSON string that is sent back to the model as a tool_result.
 */
import { useBotStore } from '../store/useBotStore';
import { CoinData } from '../types/coin';
import { BotPosition, BotSettings } from '../types/bot';
// Type-only: the scanner store itself is imported lazily (it imports the bot store, which imports
// the bridge, which imports this file).
import type { ScanSignal } from '../services/scanner.service';

const SETTABLE_KEYS: (keyof BotSettings)[] = [
  'buyAmountUsd',
  'takeProfitPercent',
  'stopLossPercent',
  'trailingStopPercent',
  'profitLockTriggerPercent',
  'profitLockPercent',
  'maxPositions',
  'slippagePercent',
  'autoSell',
  'paperTrading',
  'aiGateEnabled',
  'aiMinConfidence',
  'aiAdjustTargets',
  'soundAlerts',
  'priorityFeeSol',
  'dailyLossLimitUsd',
  'scannerAutoBuy',
  'scannerMode',
  'smartWallets',
  'scanLaunches',
  'aiModel',
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
    profitLocked: !!p.profitLocked,
    highPriceUsd: p.highPriceUsd,
    openedMinutesAgo: Math.round((Date.now() - p.boughtAt) / 60_000),
    buyTx: p.buyTxSignature,
    aiDecision: p.aiDecision ? { action: p.aiDecision.action, confidence: p.aiDecision.confidence, reason: p.aiDecision.reason } : null,
  };
}

function signalSummary(s: ScanSignal) {
  const r1 = (v?: number) => (v === undefined ? undefined : Math.round(v * 10) / 10);
  return {
    symbol: s.coin.symbol,
    mint: s.id,
    status: s.status,
    setup: s.setup,
    reason: s.reason,
    score: s.score?.total,
    priceUsd: s.priceUsd,
    liquidityUsd: Math.round(s.liquidityUsd),
    marketCapUsd: Math.round(s.marketCapUsd),
    ageHours: r1(s.ageHours),
    entryLow: s.entryLow,
    entryHigh: s.entryHigh,
    stopPrice: s.stopPrice,
    targetPrice: s.targetPrice,
    slPercent: r1(s.slPercent),
    tpPercent: r1(s.tpPercent),
    costPercent: r1(s.costPercent),
    netRewardRisk: r1(s.netRewardRisk),
    rsi: s.rsi !== undefined ? Math.round(s.rsi) : undefined,
    buys5m: s.buys5m,
    sells5m: s.sells5m,
    holders: s.gates?.holders ?? s.launch?.holders,
    invalidation: s.invalidation,
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

      // start_bot / stop_bot drive the one bot: auto trade.
      case 'start_bot': {
        if (store.settings.scannerAutoBuy) return ok({ status: 'already running' });
        if (!store.settings.paperTrading) {
          const ready = store.settings.liveSigner === 'bot' ? store.botWallet.unlocked : store.settings.phantomWalletConnected;
          if (!ready) {
            return fail(
              store.settings.liveSigner === 'bot'
                ? 'Auto trade did not start: live mode and the bot wallet is locked or missing.'
                : 'Auto trade did not start: live mode and no wallet is connected.'
            );
          }
        }
        const { useScannerStore } = await import('../store/useScannerStore');
        useScannerStore.getState().startAutoTrade();
        const limit = store.settings.dailyLossLimitUsd;
        const pausedForToday = limit > 0 && store.getTodayRealizedPnl() <= -limit;
        return ok({
          status: 'started',
          mode: store.settings.paperTrading ? 'paper' : 'live',
          signer: store.settings.liveSigner,
          ...(pausedForToday ? { note: 'The daily loss limit is already reached: no new entries until tomorrow.' } : {}),
        });
      }

      case 'stop_bot': {
        if (!store.settings.scannerAutoBuy) return ok({ status: 'already off' });
        const { useScannerStore } = await import('../store/useScannerStore');
        useScannerStore.getState().stopAutoTrade();
        return ok({ status: 'stopped', openPositions: useBotStore.getState().positions.length, note: 'Open positions are still managed.' });
      }

      case 'update_settings': {
        const patch: Partial<BotSettings> = {};
        SETTABLE_KEYS.forEach((k) => {
          if (input && input[k] !== undefined && input[k] !== null) (patch as any)[k] = input[k];
        });
        if (Object.keys(patch).length === 0) return fail('No valid settings supplied.');
        // Going live, or arming auto-buy while live, needs a signer that can actually sign right now.
        const goingLive = patch.paperTrading === false;
        const armingLiveAutoBuy = patch.scannerAutoBuy === true && (patch.paperTrading ?? store.settings.paperTrading) === false;
        if (goingLive || armingLiveAutoBuy) {
          const ready = store.settings.liveSigner === 'bot' ? store.botWallet.unlocked : store.settings.phantomWalletConnected;
          if (!ready) {
            const what = goingLive ? 'enable live trading' : 'enable auto-buy for live trading';
            return fail(
              store.settings.liveSigner === 'bot'
                ? `Cannot ${what}: the bot wallet is locked or missing. Ask the user to unlock it under Bot > Settings.`
                : `Cannot ${what}: no wallet connected. Ask the user to connect Phantom/Solflare first.`
            );
          }
        }
        store.updateSettings(patch);
        store.log('ai', `[AI CONTROL] Settings updated: ${JSON.stringify(patch)}`);
        const { whitelistedSymbols, connectedWalletAddress, ...rest } = useBotStore.getState().settings;
        return ok({ updated: patch, settings: { ...rest, whitelistedSymbols, walletConnected: !!connectedWalletAddress } });
      }

      case 'get_scanner_signals': {
        const { useScannerStore } = await import('../store/useScannerStore');
        const sc = useScannerStore.getState();
        const includeWatch = input?.include_watch !== false;
        const list = [...sc.signals, ...sc.launches].filter((s) => s.status === 'ready' || (includeWatch && s.status === 'watch'));
        const rejectedBy = new Map<string, number>();
        sc.signals
          .filter((s) => s.status === 'rejected')
          .forEach((s) => {
            const key = s.reason.replace(/\$[\d.,]+[KM]?|\d+(\.\d+)?%|\$0\.[\d{}]+/g, '#');
            rejectedBy.set(key, (rejectedBy.get(key) || 0) + 1);
          });
        return ok({
          scannerOn: sc.enabled,
          lastScanAt: sc.lastScanAt ? new Date(sc.lastScanAt).toISOString() : null,
          candidates: sc.candidateCount,
          error: sc.error,
          signals: list.slice(0, 20).map(signalSummary),
          topRejections: [...rejectedBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([reason, count]) => ({ reason, count })),
        });
      }

      case 'snipe_token': {
        const query = String(input?.token || '');
        let coin = store.findCoin(query);
        // Scanner signals carry their own stop and target; a buy of one keeps them unless overridden.
        let signalTargets: { tp: number; sl: number } | undefined;
        if (!coin || !input?.takeProfitPercent || !input?.stopLossPercent) {
          const { useScannerStore } = await import('../store/useScannerStore');
          const sc = useScannerStore.getState();
          const q = query.trim().toLowerCase().replace(/^\$/, '');
          const live = [...sc.signals, ...sc.launches].filter((s) => s.status !== 'rejected');
          // A coin already found is matched by its own mint / id, never by ticker: two tokens can
          // share a symbol, and one must not be bought with the other's stop and target.
          const found = coin;
          const match = found
            ? live.find((s) => s.coin.id === found.id || (!!found.mint && s.id === found.mint))
            : live.find((s) => s.id.toLowerCase() === q || s.coin.id.toLowerCase() === q || s.coin.symbol.toLowerCase() === q);
          if (match) {
            coin = coin || match.coin;
            if (match.tpPercent && match.slPercent) signalTargets = { tp: Math.round(match.tpPercent * 10) / 10, sl: Math.round(match.slPercent * 10) / 10 };
          }
        }
        if (!coin) return fail(`Token "${input?.token}" not found. Use get_scanner_signals or get_new_coins to list available tokens.`);
        const tp = Number(input?.takeProfitPercent) || 0;
        const sl = Number(input?.stopLossPercent) || 0;
        const targets =
          tp > 0 || sl > 0
            ? { tp: tp > 0 ? tp : signalTargets?.tp ?? store.settings.takeProfitPercent, sl: sl > 0 ? sl : signalTargets?.sl ?? store.settings.stopLossPercent }
            : signalTargets;
        const res = await store.manualSnipeCoin(coin, input?.amountUsd ? Number(input.amountUsd) : undefined, `AI: ${input?.reason || 'manual via chat'}`, targets);
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
        return ok({ watchlist: useBotStore.getState().settings.whitelistedSymbols, note: 'The watchlist does not change what auto trade buys.' });
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
