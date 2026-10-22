/**
 * End-to-end simulation of the convergence flow with every network call mocked:
 * wallet RPC -> trigger -> safety -> momentum -> AI -> paper entry -> TP1 partial -> emergency exit -> journal.
 */
import assert from 'node:assert/strict';
const R = new URL('../src', import.meta.url).href;

// ---- browser globals
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
(globalThis as any).window = globalThis;
(globalThis as any).document = { addEventListener() {}, visibilityState: 'visible' };
(globalThis as any).WebSocket = class { readyState = 0; static OPEN = 1; static CONNECTING = 0; send() {} close() {} };

// ---- market + chain state the mocks serve
const SOL = 150;
const MINT = 'CatCoin11111111111111111111111111111111pump';
const A1 = 'SmartA1111111111111111111111111111111111111';
const B1 = 'SmartB1111111111111111111111111111111111111';
let price = 0.0001; // USD
let liquidity = 50_000;
const sigs: Record<string, { signature: string; blockTime: number; err: null }[]> = { [A1]: [], [B1]: [] };
const txs: Record<string, any> = {};
let aiCalls = 0;
let lastAiPackage: any = null;
let n = 0;
function trade(wallet: string, side: 'buy' | 'sell', sol: number, pre: number, post: number) {
  const signature = `sig${++n}`;
  const t = Math.floor(Date.now() / 1000);
  sigs[wallet].unshift({ signature, blockTime: t, err: null });
  const lamDelta = side === 'buy' ? -sol * 1e9 : sol * 1e9;
  txs[signature] = {
    blockTime: t,
    transaction: { signatures: [signature], message: { accountKeys: [{ pubkey: wallet }, { pubkey: 'Pool' }] } },
    meta: {
      err: null, fee: 5000, preBalances: [100e9, 0], postBalances: [100e9 + lamDelta - 5000, 0],
      preTokenBalances: pre ? [{ mint: MINT, owner: wallet, uiTokenAmount: { uiAmount: pre, decimals: 6 } }] : [],
      postTokenBalances: [{ mint: MINT, owner: wallet, uiTokenAmount: { uiAmount: post, decimals: 6 } }],
      logMessages: [],
    },
  };
}
const pair = () => ({
  chainId: 'solana', dexId: 'pumpswap', pairAddress: 'PoolAddr1', baseToken: { address: MINT, name: 'Cat Coin', symbol: 'CAT' }, quoteToken: { symbol: 'SOL' },
  priceUsd: String(price), priceNative: String(price / SOL), liquidity: { usd: liquidity }, marketCap: price * 1e9, fdv: price * 1e9, pairCreatedAt: Date.now() - 3 * 3_600_000,
  txns: { h1: { buys: 300, sells: 120 }, m5: { buys: 40, sells: 15 } }, volume: { h1: 80_000, h24: 300_000 }, priceChange: { m5: 3, h1: 20, h24: 50 },
  info: { socials: [{ type: 'twitter', url: 'https://x.com/cat' }, { type: 'telegram', url: 'https://t.me/cat' }], websites: [{ url: 'https://cat.xyz' }] },
});
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = String(input);
  if (url === '/api/rpc' || url.includes('/api/rpc')) {
    const { method, params } = JSON.parse(init.body);
    if (method === 'getSignaturesForAddress') {
      const list = sigs[params[0]] || [];
      const until = params[1]?.until;
      const idx = until ? list.findIndex((s) => s.signature === until) : -1;
      const out = (idx >= 0 ? list.slice(0, idx) : list).slice(0, params[1]?.limit || 10);
      return json({ jsonrpc: '2.0', id: 1, result: out });
    }
    if (method === 'getTransaction') return json({ jsonrpc: '2.0', id: 1, result: txs[params[0]] || null });
    return json({ jsonrpc: '2.0', id: 1, result: null });
  }
  if (url.includes('dexscreener.com/tokens/v1/solana/')) return json(url.includes(MINT) ? [pair()] : []);
  if (url.includes('rugcheck.xyz')) {
    return json({
      token: { supply: 1e15, mintAuthority: null, freezeAuthority: null }, mintAuthority: null, freezeAuthority: null, creator: 'DevWallet111111111111111111111111111111111',
      creatorBalance: 1e13, knownAccounts: { Pool: { type: 'AMM' } }, topHolders: [{ owner: 'Pool', pct: 30 }, { owner: 'h1', pct: 4 }, { owner: 'h2', pct: 3 }],
      insiderNetworks: [], totalHolders: 900, markets: [{ lp: { lpLockedPct: 100 } }], risks: [], creatorTokens: [],
    });
  }
  if (url.includes('lite-api.jup.ag/swap/v1/quote')) {
    const u = new URL(url);
    const amount = Number(u.searchParams.get('amount'));
    const buy = u.searchParams.get('inputMint')!.startsWith('So111');
    const out = buy ? Math.floor(((amount / 1e9) * SOL) / price * 0.99 * 1e6) : Math.floor(((amount / 1e6) * price) / SOL * 0.99 * 1e9);
    return json({ outAmount: String(out), priceImpactPct: '0.008' });
  }
  if (url.includes('geckoterminal.com') && url.includes(`/tokens/${MINT}/pools`)) {
    return json({ data: [{ id: 'solana_PoolAddr1', attributes: { address: 'PoolAddr1', reserve_in_usd: '50000', transactions: { m15: { buys: 90, sells: 30, buyers: 60, sellers: 25 } }, volume_usd: { m15: '9000' } } }] });
  }
  if (url.includes('geckoterminal.com') && url.includes('/pools/PoolAddr1/trades')) {
    const now = Date.now();
    return json({ data: Array.from({ length: 40 }, (_, i) => ({ attributes: { block_timestamp: new Date(now - i * 20_000).toISOString(), kind: i % 4 === 0 ? 'sell' : 'buy', tx_from_address: `trader${i}`, volume_in_usd: '150' } })) });
  }
  if (url === '/api/ai/convergence') {
    aiCalls++;
    lastAiPackage = JSON.parse(init.body).package;
    return json({ available: true, model: 'claude-opus-5-5', verdict: { verdict: 'ENTRY', confidence: 82, red_flags: [], alasan: ['3 cluster berbeda', 'momentum organik'], syarat_naik_ke_entry: '', data_kurang: [] } });
  }
  return json({}, 404);
};

let useConvergenceStoreRef: any = null;
let useBotRef: any = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(what: string, fn: () => boolean, ms = 30_000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) {
      console.log(JSON.stringify(useConvergenceStoreRef?.getState().journal.map((j: any) => ({ status: j.status, stage: j.stage, reason: j.reason, momentum: j.momentum?.score, ai: j.ai })), null, 1));
      console.log(useBotRef?.getState().logs.slice(0, 15).map((l: any) => l.message).join('\n'));
      throw new Error(`timeout waiting for: ${what}`);
    }
    await sleep(200);
  }
  console.log(`ok - ${what} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

const { useBotStore } = await import(`${R}/store/useBotStore.ts`);
const { useConvergenceStore, useConvergenceLive } = await import(`${R}/store/useConvergenceStore.ts`);
useConvergenceStoreRef = useConvergenceStore;
useBotRef = useBotStore;
useBotStore.setState((s: any) => ({ solPriceUsd: SOL, settings: { ...s.settings, scannerAutoBuy: true, entryStrategy: 'convergence', paperTrading: true, soundAlerts: false } }));

const conv = useConvergenceStore.getState();
conv.init();
await sleep(100);
conv.setConfig({ pollSeconds: 5 });
conv.addWallets([A1], { tier: 'A', label: 'whale-A', source: 'Kolscan' });
conv.addWallets([B1], { tier: 'B', label: 'trader-B', source: 'Manual' });
assert.deepEqual(useBotStore.getState().settings.smartWallets, [A1, B1], 'wallet list synced to the setup scanner (tier A first)');

await until('monitor running', () => !!useConvergenceLive.getState().monitor?.running);

// Stage 1: A (2 pts) + B (1 pt) buy within the window.
trade(A1, 'buy', 1, 0, 1_500_000); // 1 SOL at $0.0001
await sleep(2500);
trade(B1, 'buy', 0.5, 0, 750_000);
await until('signal opened', () => useConvergenceStore.getState().journal.length === 1);
await until('signal entered', () => useConvergenceStore.getState().journal[0].status === 'entered', 40_000);

const sig = useConvergenceStore.getState().journal[0];
console.log('   reason:', sig.reason);
assert.equal(sig.trigger.points, 3);
assert.equal(sig.safety!.passed, true);
assert.ok(sig.momentum!.score >= 60, `momentum ${sig.momentum!.score}`);
assert.equal(sig.ai!.verdict, 'ENTRY');
assert.equal(aiCalls, 1);
assert.equal(lastAiPackage.tahap_1_konvergensi.poin, 3);
assert.equal(lastAiPackage.tahap_1_konvergensi.cluster_berbeda, 2);

const bot = () => useBotStore.getState();
const pos = bot().positions[0];
assert.ok(pos.exitPlan, 'position carries an exit plan');
assert.equal(pos.signalId, sig.id);
assert.equal(pos.exitPlan.devWallet, 'DevWallet111111111111111111111111111111111');
assert.deepEqual(pos.exitPlan.triggerWallets.sort(), [A1, B1].sort());
assert.ok(Math.abs(pos.amountUsd - 15) < 0.01, `size = 1.5% of $1000 paper capital, got ${pos.amountUsd}`);
assert.ok(Math.abs(pos.slPriceUsd / pos.buyPriceUsd - 0.65) < 1e-9);
assert.ok(Math.abs(pos.tpPriceUsd / pos.buyPriceUsd - 2) < 1e-9);
console.log(`ok - paper entry $${pos.amountUsd} @ ${pos.buyPriceUsd.toPrecision(4)}, SL ${pos.slPriceUsd.toPrecision(4)}, TP1 ${pos.tpPriceUsd.toPrecision(4)}`);

// Stage 6: price doubles -> TP1 sells half.
const tokensBefore = pos.tokensBought;
price = pos.buyPriceUsd * 2.05;
await bot().pollPositionPrices();
await until('TP1 partial sell', () => bot().history.some((h: any) => h.exitReason === 'PARTIAL_TP'));
const after = bot().positions[0];
assert.ok(after.exitPlan.tp1Done);
assert.ok(Math.abs(after.tokensBought / tokensBefore - 0.5) < 1e-6, 'half the tokens left');
assert.ok(Math.abs(after.tpPriceUsd / after.buyPriceUsd - 5) < 1e-9, 'next target 5x');

// Stage 6: both trigger wallets dump > 50% -> emergency exit.
trade(A1, 'sell', 1.5, 1_500_000, 300_000);
await until('first trigger wallet marked out', () => (bot().positions[0]?.exitPlan?.exitedWallets.length ?? 0) >= 1 || bot().positions.length === 0);
trade(B1, 'sell', 0.8, 750_000, 150_000);
await until('emergency exit closed the position', () => bot().positions.length === 0);
assert.ok(bot().history.some((h: any) => h.exitReason === 'EMERGENCY_EXIT' && h.signalId === sig.id));

// Stage 7: the journal links the realized result.
await until('journal result linked', () => !!useConvergenceStore.getState().journal[0].result, 15_000);
const res = useConvergenceStore.getState().journal[0].result!;
console.log(`ok - result ${res.pnlUsd >= 0 ? '+' : ''}${res.pnlUsd} USD (${res.pnlPercent}%), exits ${res.exitReasons.join(', ')}`);
assert.ok(res.pnlUsd > 0);

// Cooldown: the same token does not reopen a signal right away.
trade(A1, 'buy', 1, 300_000, 1_000_000);
trade(B1, 'buy', 1, 150_000, 800_000);
await sleep(8000);
assert.equal(useConvergenceStore.getState().journal.length, 1, 'no second signal inside the cooldown');
console.log('ok - cooldown respected');

console.log('\nE2E simulation passed');
process.exit(0);
