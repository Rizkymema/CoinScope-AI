/** Unit tests of the convergence flow rules (parser, tracker, safety, momentum, exit plan, wallet criteria, review). Run: npm run test:convergence */
import assert from 'node:assert/strict';
const R = new URL('../src', import.meta.url).href;
const { parseWalletSwaps, isTokenCreation, swapFromStream } = await import(`${R}/services/walletwatch.service.ts`);
const { ConvergenceTracker, lateCheck, evaluateSafety, scoreMomentum, parseRugReport } = await import(`${R}/services/convergence.service.ts`);
const { planExit, planLevels, buildExitPlan } = await import(`${R}/lib/exit-plan.ts`);
const { statsFromSwaps, evaluateWallet, deriveAutoClusters, funderOf } = await import(`${R}/services/walletanalysis.service.ts`);
const { buildReview, outcomeOf } = await import(`${R}/lib/convergence-review.ts`);
const { DEFAULT_CONVERGENCE_CONFIG: CFG } = await import(`${R}/types/convergence.ts`);

let passed = 0;
const t = (name: string, fn: () => void) => { fn(); passed++; console.log('ok -', name); };
const W = 'Wallet1111111111111111111111111111111111111';
const MINT = 'MintAAAA111111111111111111111111111111pump';
const WSOL = 'So11111111111111111111111111111111111111112';

// ---------------------------------------------------------------- parser
const tx = (opts: any) => ({
  blockTime: 1_700_000_000,
  transaction: { signatures: ['sig1'], message: { accountKeys: opts.keys.map((k: string) => ({ pubkey: k })) } },
  meta: { err: null, fee: 5000, preBalances: opts.pre, postBalances: opts.post, preTokenBalances: opts.preT || [], postTokenBalances: opts.postT || [], logMessages: opts.logs || [] },
});
const bal = (mint: string, owner: string, ui: number) => ({ mint, owner, uiTokenAmount: { uiAmount: ui, decimals: 6, amount: String(ui * 1e6) } });

t('buy with native SOL, fee payer gets fee back', () => {
  const s = parseWalletSwaps(tx({ keys: [W, 'Curve'], pre: [10e9, 0], post: [10e9 - 1e9 - 5000 - 2_039_280, 0], postT: [bal(MINT, W, 1_000_000)] }), W, 150);
  assert.equal(s.length, 1);
  assert.equal(s[0].side, 'buy');
  assert.ok(Math.abs(s[0].solAmount - 1.00203928) < 1e-6, String(s[0].solAmount));
  assert.equal(s[0].tokenAmount, 1_000_000);
  assert.equal(s[0].preBalance, 0);
  assert.equal(s[0].postBalance, 1_000_000);
  assert.equal(s[0].at, 1_700_000_000_000);
});
t('sell into WSOL counts the WSOL as SOL', () => {
  const s = parseWalletSwaps(tx({ keys: ['Payer', W], pre: [1e9, 5e9], post: [1e9, 5e9], preT: [bal(MINT, W, 1000), bal(WSOL, W, 0)], postT: [bal(MINT, W, 400), bal(WSOL, W, 2)] }), W, 150);
  assert.equal(s[0].side, 'sell');
  assert.equal(s[0].solAmount, 2);
  assert.equal(s[0].tokenAmount, 600);
  assert.equal(s[0].preBalance, 1000);
});
t('USDC-quoted buy converts with the SOL price', () => {
  const s = parseWalletSwaps(tx({ keys: [W], pre: [1e9], post: [1e9 - 5000], preT: [bal('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', W, 300)], postT: [bal('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', W, 0), bal(MINT, W, 50)] }), W, 150);
  assert.equal(s[0].side, 'buy');
  assert.equal(s[0].solAmount, 2);
});
t('a token transfer without SOL movement is not a swap', () => {
  const s = parseWalletSwaps(tx({ keys: ['Payer', W], pre: [1e9, 1e9], post: [1e9, 1e9], postT: [bal(MINT, W, 10)] }), W, 150);
  assert.equal(s.length, 0);
});
t('failed transaction is ignored', () => {
  const x: any = tx({ keys: [W], pre: [2e9], post: [1e9], postT: [bal(MINT, W, 10)] });
  x.meta.err = { InstructionError: [0, 'x'] };
  assert.equal(parseWalletSwaps(x, W, 150).length, 0);
});
t('token-to-token route is skipped (two tokens changed)', () => {
  assert.equal(parseWalletSwaps(tx({ keys: [W], pre: [1e9], post: [1e9 - 5000], preT: [bal('OtherMint', W, 5)], postT: [bal('OtherMint', W, 0), bal(MINT, W, 9)] }), W, 150).length, 0);
});
t('deployer detection needs InitializeMint by the fee payer, not ATA creation', () => {
  assert.equal(isTokenCreation(tx({ keys: [W], pre: [1], post: [1], logs: ['Program log: CreateIdempotent', 'Program log: Instruction: InitializeAccount3'] }), W), false);
  assert.equal(isTokenCreation(tx({ keys: [W], pre: [1], post: [1], logs: ['Program log: Instruction: Create', 'Program log: Instruction: InitializeMint2'] }), W), true);
  assert.equal(isTokenCreation(tx({ keys: ['Other', W], pre: [1, 1], post: [1, 1], logs: ['Program log: Instruction: InitializeMint2'] }), W), false);
});
t('stream event to swap with balances', () => {
  const s = swapFromStream({ mint: MINT, txType: 'sell', solAmount: 1, tokenAmount: 100, priceSol: 0, marketCapSol: 0, traderPublicKey: W, signature: 'x', newTokenBalance: 300, timestamp: 5 });
  assert.equal(s!.preBalance, 400);
  assert.equal(s!.postBalance, 300);
  const n = swapFromStream({ mint: MINT, txType: 'buy', solAmount: 1, tokenAmount: 100, priceSol: 0, marketCapSol: 0, traderPublicKey: W, signature: 'y', timestamp: 5 });
  assert.ok(Number.isNaN(n!.preBalance));
});

// ---------------------------------------------------------------- tracker
const now = 1_800_000_000_000;
const infos: Record<string, any> = {
  A1: { address: 'A1', tier: 'A', cluster: 'A1', counts: true },
  B1: { address: 'B1', tier: 'B', cluster: 'B1', counts: true },
  B2: { address: 'B2', tier: 'B', cluster: 'X', counts: true },
  B3: { address: 'B3', tier: 'B', cluster: 'X', counts: true },
  A9: { address: 'A9', tier: 'A', cluster: 'X', counts: true },
  OFF: { address: 'OFF', tier: 'A', cluster: 'OFF', counts: false },
};
const mk = () => new ConvergenceTracker(() => CFG, (a: string) => infos[a], () => 100);
const buy = (wallet: string, at: number, sol = 0.5, sig = `${wallet}-${at}`, pre = 0, post = 100) => ({ wallet, mint: MINT, side: 'buy', solAmount: sol, tokenAmount: 100, priceSol: sol / 100, preBalance: pre, postBalance: post, signature: sig, at, source: 'rpc' });

t('A (2) + B (1) from different clusters = 3 points triggers', () => {
  const tr = mk();
  tr.ingest(buy('A1', now - 10 * 60_000), 100);
  assert.equal(tr.trigger(MINT, now), null);
  tr.ingest(buy('B1', now - 60_000), 100);
  const trig = tr.trigger(MINT, now)!;
  assert.equal(trig.points, 3);
  assert.equal(trig.firstWallet, 'A1');
  assert.ok(Math.abs(trig.firstBuyPriceUsd - 0.5) < 1e-9);
});
t('one cluster counts once, with its best tier', () => {
  const tr = mk();
  tr.ingest(buy('B2', now - 5 * 60_000), 100);
  tr.ingest(buy('B3', now - 4 * 60_000), 100);
  assert.equal(tr.evaluate(MINT, now).points, 1);
  tr.ingest(buy('A9', now - 3 * 60_000), 100);
  assert.equal(tr.evaluate(MINT, now).points, 2, 'cluster X is worth tier A once');
  assert.equal(tr.trigger(MINT, now), null);
});
t('buys under 0.2 SOL, outside the window, or by excluded wallets do not count', () => {
  const tr = mk();
  tr.ingest(buy('A1', now - 16 * 60_000), 100);
  tr.ingest(buy('B1', now - 60_000, 0.1), 100);
  tr.ingest(buy('OFF', now - 60_000), 100);
  assert.equal(tr.evaluate(MINT, now).points, 0);
});
t('late check: 3x the first buy, or the first wallet selling', () => {
  const trig = { mint: MINT, points: 3, wallets: [], firstBuyPriceUsd: 1, firstWallet: 'A1', firstBuyAt: now - 1, triggeredAt: now };
  assert.match(lateCheck(trig, 3.1, CFG, false)!, /too late/);
  assert.equal(lateCheck(trig, 2.9, CFG, false), null);
  assert.match(lateCheck(trig, 1, CFG, true)!, /already sold/);
});
t('sold fraction, soldSince and addedAgain', () => {
  const tr = mk();
  tr.ingest(buy('A1', now - 10 * 60_000, 0.5, 's1', 0, 1000), 100);
  tr.ingest(buy('B1', now - 9 * 60_000, 0.5, 's2', 0, 1000), 100);
  const trig = tr.trigger(MINT, now)!;
  assert.equal(tr.addedAgain(MINT, trig), false);
  tr.ingest(buy('B1', now - 8 * 60_000, 0.3, 's3', 1000, 1500), 100);
  assert.equal(tr.addedAgain(MINT, trig), true);
  assert.equal(tr.soldSince(MINT, 'A1', now - 10 * 60_000), false);
  tr.ingest({ ...buy('A1', now - 60_000, 1, 's4', 1000, 300), side: 'sell', tokenAmount: 700 }, 100);
  assert.equal(tr.soldSince(MINT, 'A1', now - 10 * 60_000), true);
  assert.ok(Math.abs(tr.soldFraction('A1', MINT) - 0.7) < 1e-9);
});

// ---------------------------------------------------------------- safety
const rug = (over: any = {}) => ({ mintAuthority: null, freezeAuthority: null, rugged: false, transferFee: false, permanentDelegate: false, transferHook: false, top10Pct: 20, devPct: 2, insiderPct: 5, holders: 400, lpLockedPct: 100, riskNames: [], creatorTokens: 1, ...over });
const amm = { dexId: 'raydium', liquidity: { usd: 40_000 }, marketCap: 400_000 };
const sellOk = { sellable: true as const, roundTripPct: 4 };
t('clean AMM token passes every check', () => {
  const r = evaluateSafety({ rug: rug(), chain: null, pair: amm, sell: sellOk, solPriceUsd: 150 }, CFG);
  assert.equal(r.passed, true, r.failure);
});
t('each hard check fails on its own', () => {
  const cases: [any, any, RegExp][] = [
    [rug({ mintAuthority: 'X' }), amm, /Mint authority/],
    [rug({ freezeAuthority: 'X' }), amm, /Freeze/],
    [rug(), { ...amm, liquidity: { usd: 9_000 } }, /liquidity/i],
    [rug({ lpLockedPct: 40 }), amm, /LP/],
    [rug({ top10Pct: 31 }), amm, /Top 10/],
    [rug({ devPct: 6 }), amm, /Dev holds/],
    [rug({ insiderPct: 25 }), amm, /Bundle/],
    [rug({ transferFee: true }), amm, /Sell test/],
    [rug({ riskNames: ['Creator history of rugged tokens'] }), amm, /Dev has no rugged/],
  ];
  cases.forEach(([r, p, re]) => {
    const out = evaluateSafety({ rug: r, chain: null, pair: p, sell: sellOk, solPriceUsd: 150 }, CFG);
    assert.equal(out.passed, false);
    assert.match(out.failure!, re);
  });
});
t('honeypot: no sell route fails', () => {
  const out = evaluateSafety({ rug: rug(), chain: null, pair: amm, sell: { sellable: false, error: 'No route to sell it back - possible honeypot' }, solPriceUsd: 150 }, CFG);
  assert.equal(out.passed, false);
});
t('PumpSwap LP counts as burned; unknown lock on another DEX blocks', () => {
  assert.equal(evaluateSafety({ rug: rug({ lpLockedPct: undefined }), chain: null, pair: { ...amm, dexId: 'pumpswap' }, sell: sellOk, solPriceUsd: 150 }, CFG).passed, true);
  assert.equal(evaluateSafety({ rug: rug({ lpLockedPct: undefined }), chain: null, pair: amm, sell: sellOk, solPriceUsd: 150 }, CFG).passed, false);
});
t('bonding curve: curve progress replaces the LP check', () => {
  // curve% = ((sqrt(mcap/sol*32.19) - 30) / 85) * 100; mcap $40K at $150 -> ~33%
  const p = { dexId: 'pumpfun', liquidity: { usd: 0 }, marketCap: 40_000 };
  const r = evaluateSafety({ rug: rug({ lpLockedPct: undefined }), chain: null, pair: p, sell: sellOk, solPriceUsd: 150 }, CFG);
  assert.equal(r.passed, true, r.failure);
  assert.ok(r.curvePercent! > 20 && r.curvePercent! < 85, String(r.curvePercent));
  const early = evaluateSafety({ rug: rug(), chain: null, pair: { ...p, marketCap: 6_000 }, sell: sellOk, solPriceUsd: 150 }, CFG);
  assert.equal(early.passed, false);
});
t('no RugCheck: on-chain authorities used, holder checks unknown -> blocked', () => {
  const r = evaluateSafety({ rug: null, chain: { mintAuthority: null, freezeAuthority: null }, pair: amm, sell: sellOk, solPriceUsd: 150 }, CFG);
  assert.equal(r.checks.find((c: any) => c.key === 'mint').state, 'pass');
  assert.equal(r.passed, false);
});
t('dev history unknown does not block', () => {
  assert.equal(evaluateSafety({ rug: rug({ creatorTokens: undefined }), chain: null, pair: amm, sell: sellOk, solPriceUsd: 150 }, CFG).passed, true);
});
t('parseRugReport excludes known accounts and reads LP locks', () => {
  const r = parseRugReport({
    token: { supply: 1000, mintAuthority: null, freezeAuthority: null },
    knownAccounts: { Pool: { type: 'AMM' } },
    topHolders: [{ owner: 'Pool', pct: 40 }, { owner: 'h1', pct: 5 }, { owner: 'h2', pct: 3 }],
    creatorBalance: 20, insiderNetworks: [{ tokenAmount: 50 }], totalHolders: 321,
    markets: [{ lp: { lpLockedPct: 99.9 } }, { lp: { lpLockedPct: 10 } }],
    token_extensions: { transferFeeConfig: { newerTransferFee: { transferFeeBasisPoints: 0 } } },
    risks: [{ name: 'Low Liquidity' }], creatorTokens: [{}, {}],
  });
  assert.equal(r.top10Pct, 8);
  assert.equal(r.devPct, 2);
  assert.equal(r.insiderPct, 5);
  assert.equal(r.lpLockedPct, 99.9);
  assert.equal(r.transferFee, false);
  assert.equal(r.creatorTokens, 2);
});

// ---------------------------------------------------------------- momentum
const trades = (n: number, spreadMin: number, vol = 100) => Array.from({ length: n }, (_, i) => ({ at: now - (i * spreadMin * 60_000) / n, kind: 'buy' as const, from: `w${i}`, volumeUsd: vol }));
const base = { now, windowMinutes: 15, holderSamples: [], smartAdding: true, socials: { twitter: true, telegram: true, website: true }, narrativeText: 'Cat AI coin', narratives: ['cat'] };
t('organic 15 minutes scores 100', () => {
  const m = scoreMomentum({ ...base, stats: { pool: 'P', buys15m: 60, sells15m: 20, buyers15m: 45, sellers15m: 20, volume15mUsd: 6000 }, trades: trades(30, 14) }, CFG);
  assert.equal(m.score, 25 + 20 + 20 + 15 + 5 + 10, JSON.stringify(m.metrics));
  assert.equal(m.washTrading, false);
});
t('wash trading zeroes the two volume metrics', () => {
  const few = [...trades(3, 14, 10_000), ...trades(3, 14, 10_000)];
  const m = scoreMomentum({ ...base, stats: { pool: 'P', buys15m: 80, sells15m: 70, buyers15m: 3, sellers15m: 2, volume15mUsd: 60_000 }, trades: few }, CFG);
  assert.equal(m.washTrading, true);
  assert.equal(m.metrics.find((x: any) => x.key === 'buyerRatio').points, 0);
  assert.equal(m.metrics.find((x: any) => x.key === 'smallWallets').points, 0);
});
t('missing GeckoTerminal data scores 0 on those metrics and is reported', () => {
  const m = scoreMomentum({ ...base, stats: null, trades: null, smartAdding: false, narratives: [] }, CFG);
  assert.equal(m.score, 5);
  assert.ok(m.dataMissing.length >= 3);
});

// ---------------------------------------------------------------- exit plan
const plan = buildExitPlan(CFG, { signalId: 's', triggerWallets: [], devWallet: undefined, entryLiquidityUsd: 1, entryDexId: 'raydium' });
const pos = (over: any = {}) => ({ buyPriceUsd: 1, highPriceUsd: 1, boughtAt: now, exitPlan: { ...plan, ...over } });
t('TP1 at 2x sells 50% of the position', () => {
  const d = planExit(pos(), 2.01, now + 60_000);
  assert.deepEqual([d.action, d.percent, d.stage], ['partial', 50, 'tp1']);
});
t('TP2 at 5x sells 25% of the original = 50% of what is left', () => {
  const d = planExit(pos({ tp1Done: true }), 5, now + 60_000);
  assert.deepEqual([d.action, d.percent, d.stage], ['partial', 50, 'tp2']);
});
t('moonbag trails 40% under the high', () => {
  assert.equal(planExit({ ...pos({ tp1Done: true, tp2Done: true }), highPriceUsd: 10 }, 6.1, now).action, 'none');
  const d = planExit({ ...pos({ tp1Done: true, tp2Done: true }), highPriceUsd: 10 }, 6, now);
  assert.deepEqual([d.action, d.reason], ['all', 'TRAILING_STOP']);
});
t('stop loss at -35%', () => {
  assert.equal(planExit(pos(), 0.66, now).action, 'none');
  assert.equal(planExit(pos(), 0.65, now).reason, 'SL_HIT');
});
t('time stop: 60 min without touching +30%', () => {
  assert.equal(planExit({ ...pos(), highPriceUsd: 1.29 }, 1.1, now + 61 * 60_000).reason, 'TIME_STOP');
  assert.equal(planExit({ ...pos(), highPriceUsd: 1.3 }, 1.1, now + 61 * 60_000).action, 'none');
  assert.equal(planExit({ ...pos(), highPriceUsd: 1.1 }, 1.1, now + 59 * 60_000).action, 'none');
});
t('levels shown on the card', () => {
  assert.deepEqual(planLevels(pos(), 1), { tpPriceUsd: 2, slPriceUsd: 0.65 });
  assert.deepEqual(planLevels(pos({ tp1Done: true }), 1), { tpPriceUsd: 5, slPriceUsd: 0.65 });
  const m = planLevels({ ...pos({ tp1Done: true, tp2Done: true }), highPriceUsd: 10 }, 9);
  assert.equal(m.tpPriceUsd, 10);
  assert.ok(Math.abs(m.slPriceUsd - 6) < 1e-9);
});

// ---------------------------------------------------------------- wallet stats + criteria
const DAY = 86_400_000;
const sw = (mint: string, side: string, sol: number, at: number) => ({ wallet: W, mint, side, solAmount: sol, tokenAmount: 100, priceSol: 0, preBalance: 0, postBalance: 0, signature: `${mint}${side}${at}`, at, source: 'rpc' });
t('statsFromSwaps: closed trades, win rate, concentration, hold', () => {
  const sws: any[] = [];
  for (let i = 0; i < 6; i++) {
    sws.push(sw(`M${i}`, 'buy', 1, now - 40 * DAY + i * DAY));
    sws.push(sw(`M${i}`, 'sell', i < 4 ? 1.5 : 0.5, now - 40 * DAY + i * DAY + 10 * 60_000));
  }
  const s = statsFromSwaps(sws, { now, sampleTxs: 12, oldestAt: now - 40 * DAY, newestAt: now - 35 * DAY, funder: 'F', deployer: false });
  assert.equal(s.closedTrades, 6);
  assert.equal(s.winRate, 66.7);
  assert.equal(s.pnlSampleSol, 1);
  assert.equal(s.largestWinShare, 0.5);
  assert.equal(s.avgHoldMinutes, 10);
  assert.equal(s.pnl90dSol, null, 'sample covers only 40 days');
  assert.equal(s.pnl30dSol, 0, 'nothing closed in the last 30 days');
});
t('evaluateWallet: manual figures, deployer flag, verdicts', () => {
  const w: any = { address: W, source: 'x', addedAt: now, tier: 'A', active: true, manual: { tokensTraded30d: 25, winRate: 45, pnl30d: 3, pnl90d: 10, largestWinShare: 0.3, avgHoldMinutes: 12 } };
  assert.equal(evaluateWallet(w, CFG, now).verdict, 'pass');
  assert.equal(evaluateWallet({ ...w, manual: { ...w.manual, pnl90d: -1 } }, CFG, now).verdict, 'fail');
  assert.equal(evaluateWallet({ ...w, manual: { ...w.manual, avgHoldMinutes: 1 } }, CFG, now).verdict, 'fail');
  assert.equal(evaluateWallet({ ...w, manual: {} }, CFG, now).verdict, 'incomplete');
  const dep = evaluateWallet({ ...w, stats: { deployer: true, analyzedAt: now, lastActiveAt: now } }, CFG, now);
  assert.equal(dep.verdict, 'fail');
  const idle = evaluateWallet({ ...w, stats: { deployer: false, analyzedAt: now, lastActiveAt: now - 15 * DAY } }, CFG, now);
  assert.equal(idle.verdict, 'fail');
});
t('shared funder -> one auto cluster', () => {
  const ws = deriveAutoClusters([
    { address: 'a', stats: { funder: 'F' } }, { address: 'b', stats: { funder: 'F' } }, { address: 'c', stats: { funder: 'G' } },
  ] as any);
  assert.equal(ws[0].autoClusterId, 'funder:F');
  assert.equal(ws[1].autoClusterId, 'funder:F');
  assert.equal(ws[2].autoClusterId, undefined);
});
t('funderOf: fee payer of the first transaction', () => {
  assert.equal(funderOf({ transaction: { message: { accountKeys: ['F', W] } }, meta: { preBalances: [5, 0], postBalances: [3, 2] } }, W), 'F');
});

// ---------------------------------------------------------------- review
t('review: outcomes, gates, expectancy', () => {
  const sig = (o: any) => ({ id: Math.random().toString(), mint: 'm', symbol: 's', name: '', createdAt: now, status: 'rejected', stage: 'safety', reason: '', trigger: { wallets: [{ address: 'A1', tier: 'A', points: 2 }], points: 3 }, priceAtSignalUsd: 1, liquidityAtSignalUsd: 0, marketCapAtSignalUsd: 0, evaluations: 1, redFlags: [], checkpoints: {}, ...o });
  const j = [
    sig({ status: 'entered', stage: 'execution', result: { pnlUsd: 10, pnlPercent: 50, exitReasons: [], closedAt: now + 1 } }),
    sig({ status: 'entered', stage: 'execution', result: { pnlUsd: -4, pnlPercent: -20, exitReasons: [], closedAt: now + 2 } }),
    sig({ status: 'entered', stage: 'execution', result: { pnlUsd: -4, pnlPercent: -20, exitReasons: [], closedAt: now + 3 } }),
    sig({ checkpoints: { h6: 2.5 } }),
    sig({ checkpoints: { h24: 0.4 } }),
  ];
  assert.equal(outcomeOf(j[3] as any), 'win');
  assert.equal(outcomeOf(j[4] as any), 'loss');
  const r = buildReview(j as any, [{ address: 'A1', tier: 'A' }] as any, CFG, 0);
  assert.equal(r.core.trades, 3);
  assert.equal(r.core.maxDrawdownUsd, 8);
  assert.equal(r.core.expectancyUsd, Math.round(((1 / 3) * 10 - (2 / 3) * 4) * 100) / 100);
  assert.deepEqual(r.gates.find((g) => g.stage === 'safety'), { stage: 'safety', stopped: 2, missedWinners: 1 });
  assert.equal(r.wallets[0].signals, 5);
});

// ---------------------------------------------------------------- review fixes
t('emergency on the plan sells everything first, whatever the price', () => {
  const d = planExit(pos({ emergency: 'dev wallet is selling' }), 3, now);
  assert.deepEqual([d.action, d.reason], ['all', 'EMERGENCY_EXIT']);
  assert.equal(planExit(pos({ emergency: 'x' }), 0, now).action, 'all', 'even without a price');
});
t('TP2 share is a whole percent for any TP1 setting', () => {
  const d = planExit(pos({ tp1Done: true, tp1SellPct: 60 }), 5, now);
  assert.equal(d.percent, 63);
  assert.ok(Number.isInteger(planExit(pos({ tp1Done: true, tp1SellPct: 40 }), 5, now).percent));
});
t('sell test fails on a round trip above the limit', () => {
  const out = evaluateSafety({ rug: rug(), chain: null, pair: amm, sell: { sellable: true, roundTripPct: 30 }, solPriceUsd: 150 }, CFG);
  assert.equal(out.passed, false);
  assert.match(out.failure!, /round trip/);
});
t('missing insider data is unknown (soft), not a pass', () => {
  const out = evaluateSafety({ rug: rug({ insiderPct: undefined }), chain: null, pair: amm, sell: sellOk, solPriceUsd: 150 }, CFG);
  assert.equal(out.checks.find((c: any) => c.key === 'bundle').state, 'unknown');
  assert.equal(out.passed, true);
  assert.equal(parseRugReport({ token: { supply: 10 } }).insiderPct, undefined);
});
t('authority missing in RugCheck falls back to the chain, else blocks', () => {
  const noAuth = rug({ mintAuthority: undefined, freezeAuthority: undefined });
  assert.equal(evaluateSafety({ rug: noAuth, chain: null, pair: amm, sell: sellOk, solPriceUsd: 150 }, CFG).passed, false);
  assert.equal(evaluateSafety({ rug: noAuth, chain: { mintAuthority: null, freezeAuthority: null }, pair: amm, sell: sellOk, solPriceUsd: 150 }, CFG).passed, true);
  assert.equal(evaluateSafety({ rug: noAuth, chain: { mintAuthority: 'X', freezeAuthority: null }, pair: amm, sell: sellOk, solPriceUsd: 150 }, CFG).passed, false);
});
t('trigger price is converted with the SOL price at read time', () => {
  let sol = 0;
  const tr = new ConvergenceTracker(() => CFG, (a: string) => infos[a], () => sol);
  tr.ingest(buy('A1', now - 60_000));
  tr.ingest(buy('B1', now - 30_000));
  sol = 200;
  assert.ok(Math.abs(tr.trigger(MINT, now)!.firstBuyPriceUsd - 1) < 1e-9);
});
t('exchange-funded wallets are not clustered', () => {
  const ws = deriveAutoClusters([{ address: 'a', stats: { funder: 'CEX', funderIsService: true } }, { address: 'b', stats: { funder: 'CEX', funderIsService: true } }] as any);
  assert.equal(ws[0].autoClusterId, undefined);
});
t('monitor activity keeps a wallet from being flagged inactive', () => {
  const w: any = { address: W, source: 'x', addedAt: now, tier: 'A', active: true, stats: { deployer: false, analyzedAt: now, lastActiveAt: now - 20 * DAY }, lastSeenAt: now - DAY };
  assert.ok(!evaluateWallet(w, CFG, now).flags.some((f: string) => /No transaction/.test(f)));
});

console.log(`\n${passed} tests passed`);
