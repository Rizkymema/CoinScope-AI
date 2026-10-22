/** Scenarios: observe-only, AI SKIP, watchlist -> entry, and a safety reject. Network mocked. */
import assert from 'node:assert/strict';
const R = new URL('../src', import.meta.url).href;
const kv = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v), removeItem: (k: string) => void kv.delete(k) };
(globalThis as any).window = globalThis;
(globalThis as any).document = { addEventListener() {}, visibilityState: 'visible' };
(globalThis as any).WebSocket = class { readyState = 0; static OPEN = 1; send() {} close() {} };

const SOL = 150;
const A1 = 'SmartA1111111111111111111111111111111111111';
const B1 = 'SmartB1111111111111111111111111111111111111';
const M = { obs: 'ObsMint1111111111111111111111111111111pump', skip: 'SkipMint111111111111111111111111111111pump', watch: 'WatchMint11111111111111111111111111111pump', rug: 'RugMint11111111111111111111111111111111pump' };
const PRICE = 0.0001;
let watchStrong = false;
const sigs: Record<string, any[]> = { [A1]: [], [B1]: [] };
const txs: Record<string, any> = {};
let n = 0;
function buy(wallet: string, mint: string, sol: number) {
  const signature = `s${++n}`;
  const t = Math.floor(Date.now() / 1000);
  sigs[wallet].unshift({ signature, blockTime: t, err: null });
  txs[signature] = {
    blockTime: t,
    transaction: { signatures: [signature], message: { accountKeys: [{ pubkey: wallet }] } },
    meta: { err: null, fee: 5000, preBalances: [100e9], postBalances: [100e9 - sol * 1e9 - 5000], preTokenBalances: [], postTokenBalances: [{ mint, owner: wallet, uiTokenAmount: { uiAmount: (sol * SOL) / PRICE, decimals: 6 } }], logMessages: [] },
  };
}
const json = (b: any, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const mintIn = (url: string) => Object.values(M).find((m) => url.includes(m));
const traders = (count: number, sellsEvery = 4) => {
  const now = Date.now();
  return { data: Array.from({ length: count }, (_, i) => ({ attributes: { block_timestamp: new Date(now - (i * 14 * 60_000) / count).toISOString(), kind: i % sellsEvery === 0 ? 'sell' : 'buy', tx_from_address: `t${i}`, volume_in_usd: '100' } })) };
};
let aiCalls: Record<string, number> = {};
(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = String(input);
  if (url.includes('/api/rpc')) {
    const { method, params } = JSON.parse(init.body);
    if (method === 'getSignaturesForAddress') {
      const list = sigs[params[0]] || [];
      const idx = params[1]?.until ? list.findIndex((s) => s.signature === params[1].until) : -1;
      return json({ result: (idx >= 0 ? list.slice(0, idx) : list).slice(0, params[1]?.limit || 10) });
    }
    if (method === 'getTransaction') return json({ result: txs[params[0]] || null });
    return json({ result: null });
  }
  const mint = mintIn(url);
  if (url.includes('dexscreener.com/tokens/v1/solana/') && mint) {
    return json([{ chainId: 'solana', dexId: 'raydium', pairAddress: `Pool-${mint.slice(0, 5)}`, baseToken: { address: mint, name: `${mint.slice(0, 5)} cat`, symbol: mint.slice(0, 4).toUpperCase() }, priceUsd: String(PRICE), liquidity: { usd: 60_000 }, marketCap: 600_000, info: { socials: [{ type: 'twitter' }] } }]);
  }
  if (url.includes('rugcheck.xyz') && mint) {
    return json({ token: { supply: 1e15 }, mintAuthority: mint === M.rug ? 'StillSet' : null, freezeAuthority: null, creatorBalance: 0, topHolders: [{ owner: 'h', pct: 5 }], insiderNetworks: [], totalHolders: 500, markets: [{ lp: { lpLockedPct: 100 } }], risks: [], creatorTokens: [] });
  }
  if (url.includes('jup.ag') && url.includes('quote')) {
    const u = new URL(url);
    const amount = Number(u.searchParams.get('amount'));
    const b = u.searchParams.get('inputMint')!.startsWith('So111');
    return json({ outAmount: String(Math.floor(b ? ((amount / 1e9) * SOL) / PRICE * 0.99 * 1e6 : ((amount / 1e6) * PRICE) / SOL * 0.99 * 1e9)), priceImpactPct: '0.01' });
  }
  if (url.includes('geckoterminal.com') && url.includes('/tokens/') && mint) {
    const weak = mint === M.watch && !watchStrong;
    return json({ data: [{ attributes: { address: `Pool-${mint.slice(0, 5)}`, reserve_in_usd: '60000', transactions: { m15: weak ? { buys: 30, sells: 28, buyers: 30, sellers: 28 } : { buys: 90, sells: 30, buyers: 60, sellers: 25 } }, volume_usd: { m15: '5000' } } }] });
  }
  if (url.includes('geckoterminal.com') && url.includes('/trades')) {
    const weak = url.includes(`Pool-${M.watch.slice(0, 5)}`) && !watchStrong;
    return json(weak ? traders(16, 4) : traders(40, 4));
  }
  if (url === '/api/ai/convergence') {
    const pkg = JSON.parse(init.body).package;
    aiCalls[pkg.token.mint] = (aiCalls[pkg.token.mint] || 0) + 1;
    const skip = pkg.token.mint === M.skip;
    return json({ available: true, model: 'claude-opus-5-5', verdict: skip ? { verdict: 'SKIP', confidence: 20, red_flags: ['narasi lemah'], alasan: ['tidak ada alasan kuat'], syarat_naik_ke_entry: '', data_kurang: [] } : { verdict: 'ENTRY', confidence: 75, red_flags: [], alasan: ['a', 'b'], syarat_naik_ke_entry: '', data_kurang: [] } });
  }
  return json({}, 404);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const { useBotStore } = await import(`${R}/store/useBotStore.ts`);
const { useConvergenceStore, useConvergenceLive } = await import(`${R}/store/useConvergenceStore.ts`);
const sig = (mint: string) => useConvergenceStore.getState().journal.find((j: any) => j.mint === mint);
async function until(what: string, fn: () => boolean, ms = 40_000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) {
      console.log(JSON.stringify(useConvergenceStore.getState().journal.map((j: any) => ({ mint: j.mint.slice(0, 6), status: j.status, stage: j.stage, reason: j.reason, m: j.momentum?.score })), null, 1));
      throw new Error(`timeout: ${what}`);
    }
    await sleep(200);
  }
  console.log(`ok - ${what}`);
}

useBotStore.setState((s: any) => ({ solPriceUsd: SOL, settings: { ...s.settings, scannerAutoBuy: false, entryStrategy: 'convergence', paperTrading: true, soundAlerts: false } }));
const c = useConvergenceStore.getState();
c.init();
await sleep(100);
c.setConfig({ pollSeconds: 5, recheckMinutes: 0.05, narratives: ['cat'] });
c.setMonitorOn(true);
c.addWallets([A1], { tier: 'A' });
c.addWallets([B1], { tier: 'B' });

// 1. Observe only: passes all gates, not bought.
buy(A1, M.obs, 1);
buy(B1, M.obs, 0.5);
await until('observe-only signal recorded at risk', () => sig(M.obs)?.status === 'rejected');
assert.equal(sig(M.obs)!.stage, 'risk');
assert.match(sig(M.obs)!.reason, /observe only/);
assert.equal(useBotStore.getState().positions.length, 0);

// 2. Safety: mint authority still set -> rejected before AI.
buy(A1, M.rug, 1);
buy(B1, M.rug, 0.5);
await until('rug rejected at safety', () => sig(M.rug)?.status === 'rejected');
assert.equal(sig(M.rug)!.stage, 'safety');
assert.equal(aiCalls[M.rug], undefined, 'AI never sees a token that failed the hard gate');

useBotStore.setState((s: any) => ({ settings: { ...s.settings, scannerAutoBuy: true } }));

// 3. AI SKIP.
buy(A1, M.skip, 1);
buy(B1, M.skip, 0.5);
await until('AI SKIP rejected', () => sig(M.skip)?.status === 'rejected');
assert.equal(sig(M.skip)!.stage, 'ai');
assert.equal(useBotStore.getState().positions.length, 0);

// 4. Watchlist: weak momentum (40-59), then it strengthens and enters.
buy(A1, M.watch, 1);
buy(B1, M.watch, 0.5);
await until('weak token on the watchlist', () => sig(M.watch)?.status === 'watch');
const first = sig(M.watch)!.momentum!.score;
console.log('   watch score', first, sig(M.watch)!.reason);
assert.ok(first >= 40 && first < 60);
assert.equal(aiCalls[M.watch], undefined, 'AI not asked under 60');
watchStrong = true;
await until('watched token re-checked and entered', () => sig(M.watch)?.status === 'entered');
assert.ok(sig(M.watch)!.evaluations >= 2);
assert.equal(useBotStore.getState().positions.length, 1);

// Persisted state round trip.
const saved = JSON.parse(kv.get('coinscope-convergence-v1')!);
assert.equal(saved.state.wallets.length, 2);
assert.equal(saved.state.journal.length, 4);
console.log('ok - journal and wallets persisted');
console.log('\nScenario simulation passed');
process.exit(0);
