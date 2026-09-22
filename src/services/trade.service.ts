/**
 * Live trade execution for Solana tokens.
 *   Primary route  -> Jupiter aggregator (via /api/jupiter). Verified to route Pump.fun bonding-curve
 *                     tokens ("Pump.fun" AMM), PumpSwap, Raydium, Meteora, Orca, ...
 *   Fallback route -> PumpPortal Local Trade API (via /api/trade) for Pump.fun-family pools.
 * Transactions are built server-side, signed by the user's wallet extension, then confirmed via RPC.
 * `dryRunBuy` builds the exact same transaction and simulates it on the RPC without signing.
 */
import { CoinData } from '../types/coin';
import { BotPosition, BotSettings } from '../types/bot';
import { WalletService, LAMPORTS_PER_SOL } from './wallet.service';
import { SolPriceService } from './solprice.service';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const PUMP_POOLS = new Set(['pump', 'pump-amm', 'pumpfun', 'pumpswap', 'bonk', 'launchlab', 'raydium-launchlab']);

type Route = 'jupiter' | 'pumpportal';

export interface BuyResult {
  success: boolean;
  message: string;
  signature?: string;
  provider?: Route;
  solSpent?: number;
  usdSpent?: number;
  tokensReceived?: number;
  tokenAmountRaw?: string;
  decimals?: number;
  fillPriceUsd?: number;
}

export interface SellResult {
  success: boolean;
  message: string;
  signature?: string;
  provider?: Route;
  solReceived?: number;
  usdReceived?: number;
  tokensSold?: number;
}

export interface DryRunResult {
  success: boolean;
  message: string;
  provider?: Route;
  amountSol?: number;
  expectedTokens?: number;
  routeLabels?: string[];
  unitsConsumed?: number;
  simulationError?: string;
  logs?: string[];
  attempts: { route: Route; ok: boolean; detail: string }[];
}

interface BuiltTx {
  transaction?: string;
  outAmountRaw?: string;
  routeLabels?: string[];
  error?: string;
}

function isPumpFamily(coin: CoinData): boolean {
  const pool = (coin.poolType || coin.dexId || '').toLowerCase();
  if (PUMP_POOLS.has(pool)) return true;
  if (coin.isPumpFun && !coin.graduated) return true;
  return false;
}

function routeOrder(coin: CoinData): Route[] {
  // Jupiter is verified end-to-end (quote -> swap -> simulation) for both bonding-curve and graduated
  // tokens, so it goes first. PumpPortal stays as a fallback for Pump.fun-family pools only.
  return isPumpFamily(coin) ? ['jupiter', 'pumpportal'] : ['jupiter'];
}

async function buildPumpPortalTx(params: {
  publicKey: string;
  action: 'buy' | 'sell';
  mint: string;
  amount: number | string;
  denominatedInSol: boolean;
  slippage: number;
  priorityFee: number;
  pool?: string;
}): Promise<BuiltTx> {
  try {
    const res = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.transaction) return { error: data?.error || `Trade build failed (${res.status})` };
    return { transaction: data.transaction, routeLabels: ['PumpPortal'] };
  } catch (err: any) {
    return { error: err?.message || 'Trade build failed' };
  }
}

/** Solana's maximum serialized transaction size. Larger swaps are rejected by the RPC and by wallets. */
const MAX_TX_BYTES = 1232;

async function buildJupiterTx(
  params: {
    publicKey: string;
    inputMint: string;
    outputMint: string;
    amountRaw: string;
    slippageBps: number;
    priorityFeeLamports: number;
  },
  onlyDirectRoutes = false
): Promise<BuiltTx> {
  try {
    const quoteRes = await fetch(
      `/api/jupiter?inputMint=${params.inputMint}&outputMint=${params.outputMint}&amount=${params.amountRaw}&slippageBps=${params.slippageBps}&maxAccounts=${onlyDirectRoutes ? 24 : 40}${onlyDirectRoutes ? '&onlyDirectRoutes=true' : ''}`
    );
    const quote = await quoteRes.json().catch(() => ({}));
    if (!quoteRes.ok || quote?.error) return { error: quote?.error || `Jupiter quote failed (${quoteRes.status})` };

    const swapRes = await fetch('/api/jupiter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quoteResponse: quote, userPublicKey: params.publicKey, priorityFeeLamports: params.priorityFeeLamports }),
    });
    const swap = await swapRes.json().catch(() => ({}));
    if (!swapRes.ok || !swap?.transaction) return { error: swap?.error || `Jupiter swap failed (${swapRes.status})` };
    const routeLabels = Array.isArray(quote?.routePlan) ? quote.routePlan.map((r: any) => String(r?.swapInfo?.label || '?')) : [];

    // Multi-hop routes can exceed the packet limit; retry once with a direct route before giving up.
    const txBytes = Math.floor((String(swap.transaction).replace(/=+$/, '').length * 3) / 4);
    if (txBytes > MAX_TX_BYTES) {
      if (!onlyDirectRoutes) return buildJupiterTx(params, true);
      return { error: `Swap transaction too large (${txBytes} bytes > ${MAX_TX_BYTES}); route ${routeLabels.join(' > ')}` };
    }
    return { transaction: swap.transaction, outAmountRaw: quote?.outAmount, routeLabels };
  } catch (err: any) {
    return { error: err?.message || 'Jupiter swap failed' };
  }
}

async function buildBuy(route: Route, coin: CoinData, mint: string, amountSol: number, settings: BotSettings, walletAddress: string): Promise<BuiltTx> {
  const slippagePct = Math.max(1, settings.slippagePercent);
  const priorityFee = Math.max(0.00001, settings.priorityFeeSol);
  if (route === 'pumpportal') {
    return buildPumpPortalTx({
      publicKey: walletAddress,
      action: 'buy',
      mint,
      amount: amountSol,
      denominatedInSol: true,
      slippage: slippagePct,
      priorityFee,
      pool: 'auto',
    });
  }
  return buildJupiterTx({
    publicKey: walletAddress,
    inputMint: WSOL_MINT,
    outputMint: mint,
    amountRaw: Math.round(amountSol * LAMPORTS_PER_SOL).toString(),
    slippageBps: Math.round(slippagePct * 100),
    priorityFeeLamports: Math.round(priorityFee * LAMPORTS_PER_SOL),
  });
}

async function sendAndConfirm(transaction: string, rpcUrl: string): Promise<{ ok: boolean; signature?: string; error?: string }> {
  const sent = await WalletService.signAndSendTransaction(transaction, { skipPreflight: false, maxRetries: 3 });
  if (!sent.success || !sent.signature) return { ok: false, error: sent.message };
  const confirmation = await WalletService.confirmTransaction(sent.signature, rpcUrl);
  if (!confirmation.confirmed) return { ok: false, signature: sent.signature, error: confirmation.error || 'Not confirmed' };
  return { ok: true, signature: sent.signature };
}

export const TradeService = {
  isPumpFamily,

  /** Buys `amountUsd` worth of `coin` with SOL from the connected wallet. */
  async executeBuy(coin: CoinData, amountUsd: number, settings: BotSettings, walletAddress: string): Promise<BuyResult> {
    if ((coin.chainId || '').toLowerCase() !== 'solana') {
      return { success: false, message: `Live execution is only available on Solana (token is on ${coin.chainId || 'unknown chain'}).` };
    }
    const mint = coin.mint || coin.id.split(':')[1];
    if (!mint) return { success: false, message: 'Token mint address is missing.' };

    const solPrice = await SolPriceService.getSolPriceUsd();
    if (!solPrice) return { success: false, message: 'Could not fetch SOL/USD price.' };

    const amountSol = Number((amountUsd / solPrice).toFixed(6));
    if (amountSol < 0.001) return { success: false, message: 'Buy amount is below the 0.001 SOL minimum.' };
    if (settings.solBalance && settings.solBalance < amountSol + 0.01) {
      return { success: false, message: `Insufficient SOL: need ~${(amountSol + 0.01).toFixed(3)} SOL, wallet has ${settings.solBalance.toFixed(3)} SOL.` };
    }

    const before = await WalletService.getTokenBalance(walletAddress, mint, settings.solanaRpcUrl);
    const errors: string[] = [];

    for (const route of routeOrder(coin)) {
      const built = await buildBuy(route, coin, mint, amountSol, settings, walletAddress);
      if (!built.transaction) {
        errors.push(`${route}: ${built.error}`);
        continue;
      }

      const sent = await sendAndConfirm(built.transaction, settings.solanaRpcUrl);
      if (!sent.ok) {
        // A user rejection or a failed on-chain tx should not silently retry on another route.
        return { success: false, message: `${route}: ${sent.error}`, signature: sent.signature, provider: route };
      }

      const after = await WalletService.getTokenBalance(walletAddress, mint, settings.solanaRpcUrl);
      const beforeRaw = BigInt(before?.amountRaw || '0');
      const afterRaw = BigInt(after?.amountRaw || '0');
      const deltaRaw = afterRaw > beforeRaw ? afterRaw - beforeRaw : BigInt(0);
      const decimals = after?.decimals ?? before?.decimals ?? 6;
      let tokensReceived = Number(deltaRaw) / 10 ** decimals;
      if (tokensReceived === 0 && built.outAmountRaw) tokensReceived = Number(built.outAmountRaw) / 10 ** decimals;
      const usdSpent = amountSol * solPrice;

      return {
        success: true,
        message: `Bought ${tokensReceived.toLocaleString('en-US', { maximumFractionDigits: 0 })} ${coin.symbol} for ${amountSol} SOL via ${route}${built.routeLabels?.length ? ` (${built.routeLabels.join(' > ')})` : ''}.`,
        signature: sent.signature,
        provider: route,
        solSpent: amountSol,
        usdSpent,
        tokensReceived,
        tokenAmountRaw: deltaRaw > BigInt(0) ? deltaRaw.toString() : built.outAmountRaw,
        decimals,
        fillPriceUsd: tokensReceived > 0 ? usdSpent / tokensReceived : coin.priceUsd,
      };
    }

    return { success: false, message: `No route could build the swap. ${errors.join(' | ')}` };
  },

  /** Sells `percent` (1-100) of a live position back to SOL. */
  async executeSell(position: BotPosition, percent: number, settings: BotSettings, walletAddress: string): Promise<SellResult> {
    const mint = position.mint || position.coin.mint || position.coin.id.split(':')[1];
    if (!mint) return { success: false, message: 'Token mint address is missing.' };
    const pct = Math.max(1, Math.min(100, Math.round(percent)));

    const balance = await WalletService.getTokenBalance(walletAddress, mint, settings.solanaRpcUrl);
    const heldRaw = BigInt(balance?.amountRaw || position.tokenAmountRaw || '0');
    if (heldRaw <= BigInt(0)) return { success: false, message: 'Wallet holds no tokens for this position.' };
    const decimals = balance?.decimals ?? position.decimals ?? 6;
    const sellRaw = pct >= 100 ? heldRaw : (heldRaw * BigInt(pct)) / BigInt(100);
    const tokensSold = Number(sellRaw) / 10 ** decimals;

    const solBefore = (await WalletService.getSolBalance(walletAddress, settings.solanaRpcUrl)) ?? 0;
    const solPrice = await SolPriceService.getSolPriceUsd();
    const slippagePct = Math.max(1, settings.slippagePercent);
    const priorityFee = Math.max(0.00001, settings.priorityFeeSol);
    const errors: string[] = [];

    for (const route of routeOrder(position.coin)) {
      const built: BuiltTx =
        route === 'pumpportal'
          ? await buildPumpPortalTx({
              publicKey: walletAddress,
              action: 'sell',
              mint,
              amount: `${pct}%`,
              denominatedInSol: false,
              slippage: slippagePct,
              priorityFee,
              pool: 'auto',
            })
          : await buildJupiterTx({
              publicKey: walletAddress,
              inputMint: mint,
              outputMint: WSOL_MINT,
              amountRaw: sellRaw.toString(),
              slippageBps: Math.round(slippagePct * 100),
              priorityFeeLamports: Math.round(priorityFee * LAMPORTS_PER_SOL),
            });

      if (!built.transaction) {
        errors.push(`${route}: ${built.error}`);
        continue;
      }

      const sent = await sendAndConfirm(built.transaction, settings.solanaRpcUrl);
      if (!sent.ok) return { success: false, message: `${route}: ${sent.error}`, signature: sent.signature, provider: route };

      const solAfter = (await WalletService.getSolBalance(walletAddress, settings.solanaRpcUrl)) ?? solBefore;
      let solReceived = Math.max(0, solAfter - solBefore);
      if (solReceived === 0 && built.outAmountRaw) solReceived = Number(built.outAmountRaw) / LAMPORTS_PER_SOL;

      return {
        success: true,
        message: `Sold ${pct}% of ${position.coin.symbol} for ~${solReceived.toFixed(4)} SOL via ${route}.`,
        signature: sent.signature,
        provider: route,
        solReceived,
        usdReceived: solReceived * solPrice,
        tokensSold,
      };
    }

    return { success: false, message: `No route could build the sell. ${errors.join(' | ')}` };
  },

  /**
   * Builds the real buy transaction for `coin` and simulates it on the RPC (no signature, no funds moved).
   * Proves the whole live pipeline - price oracle, route building, wallet address, RPC - before real money is used.
   */
  async dryRunBuy(coin: CoinData, amountUsd: number, settings: BotSettings, walletAddress: string): Promise<DryRunResult> {
    const attempts: DryRunResult['attempts'] = [];
    if ((coin.chainId || '').toLowerCase() !== 'solana') {
      return { success: false, message: `Dry run only supports Solana tokens (this one is on ${coin.chainId}).`, attempts };
    }
    const mint = coin.mint || coin.id.split(':')[1];
    if (!mint) return { success: false, message: 'Token mint address is missing.', attempts };

    const solPrice = await SolPriceService.getSolPriceUsd(true);
    if (!solPrice) return { success: false, message: 'Could not fetch SOL/USD price.', attempts };
    const amountSol = Number((amountUsd / solPrice).toFixed(6));
    if (amountSol < 0.001) return { success: false, message: `Amount $${amountUsd} is only ${amountSol} SOL - below the 0.001 SOL minimum.`, attempts };

    for (const route of routeOrder(coin)) {
      const built = await buildBuy(route, coin, mint, amountSol, settings, walletAddress);
      if (!built.transaction) {
        attempts.push({ route, ok: false, detail: built.error || 'build failed' });
        continue;
      }
      const sim = await WalletService.simulateTransaction(built.transaction, settings.solanaRpcUrl);
      const decimals = 6;
      const expectedTokens = built.outAmountRaw ? Number(built.outAmountRaw) / 10 ** decimals : undefined;
      if (!sim.ok) {
        attempts.push({ route, ok: false, detail: `built OK, simulation failed: ${sim.error}` });
        return {
          success: false,
          message: `${route} built the swap but the RPC simulation failed: ${sim.error}`,
          provider: route,
          amountSol,
          expectedTokens,
          routeLabels: built.routeLabels,
          simulationError: sim.error,
          logs: sim.logs,
          attempts,
        };
      }
      attempts.push({ route, ok: true, detail: `simulation OK (${sim.unitsConsumed} CU)` });
      return {
        success: true,
        message: `Live pipeline OK via ${route}${built.routeLabels?.length ? ` (${built.routeLabels.join(' > ')})` : ''}: ${amountSol} SOL -> ~${
          expectedTokens ? expectedTokens.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '?'
        } ${coin.symbol}. Simulation consumed ${sim.unitsConsumed} compute units. Nothing was signed or sent.`,
        provider: route,
        amountSol,
        expectedTokens,
        routeLabels: built.routeLabels,
        unitsConsumed: sim.unitsConsumed,
        logs: sim.logs,
        attempts,
      };
    }

    return { success: false, message: `No route could build the swap: ${attempts.map((a) => `${a.route}: ${a.detail}`).join(' | ')}`, attempts };
  },
};
