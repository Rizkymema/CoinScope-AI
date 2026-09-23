import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * On-chain safety facts for a Solana mint, read straight from the token account.
 *
 * These two authorities are the checks that matter most on a new token:
 *  - mintAuthority   still set -> the creator can mint unlimited new supply
 *  - freezeAuthority still set -> the creator can freeze your tokens so you cannot sell
 * Both being null is the safe state. Nothing here is inferred; it is what the chain says.
 */

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const TOKEN_PROGRAMS: Record<string, string> = {
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'SPL Token',
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: 'Token-2022',
};

const cache = new Map<string, { ts: number; body: unknown }>();
const TTL_MS = 60_000;

export async function GET(req: NextRequest) {
  const mint = (req.nextUrl.searchParams.get('mint') || '').trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    return NextResponse.json({ error: 'Invalid mint address' }, { status: 400 });
  }

  const hit = cache.get(mint);
  if (hit && Date.now() - hit.ts < TTL_MS) return NextResponse.json(hit.body);

  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }],
      }),
      cache: 'no-store',
    });
    const data = await res.json();
    if (data?.error) return NextResponse.json({ error: data.error.message || 'RPC error' }, { status: 502 });

    const value = data?.result?.value;
    const info = value?.data?.parsed?.info;
    if (!info) return NextResponse.json({ error: 'Mint account not found or not a token mint' }, { status: 404 });

    const decimals = Number(info.decimals) || 0;
    const rawSupply = String(info.supply ?? '0');
    const supply = Number(rawSupply) / 10 ** decimals;

    const body = {
      mint,
      program: TOKEN_PROGRAMS[String(value.owner)] ?? String(value.owner),
      decimals,
      supply,
      mintAuthority: info.mintAuthority ?? null,
      freezeAuthority: info.freezeAuthority ?? null,
      initialized: !!info.isInitialized,
      checkedAt: Date.now(),
    };

    cache.set(mint, { ts: Date.now(), body });
    if (cache.size > 500) Array.from(cache.keys()).slice(0, 100).forEach((k) => cache.delete(k));
    return NextResponse.json(body);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Safety check failed' }, { status: 502 });
  }
}
