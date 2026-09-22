import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Jupiter swap aggregator proxy (quote + unsigned swap transaction).
 * Used for Solana tokens that are not on a Pump.fun-family pool.
 * Free tier: https://lite-api.jup.ag ; with JUPITER_API_KEY: https://api.jup.ag
 */
const API_KEY = process.env.JUPITER_API_KEY || '';
const BASE = API_KEY ? 'https://api.jup.ag/swap/v1' : 'https://lite-api.jup.ag/swap/v1';

function headers(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (API_KEY) h['x-api-key'] = API_KEY;
  return h;
}

/** GET /api/jupiter?inputMint=&outputMint=&amount=&slippageBps= -> quote */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const inputMint = p.get('inputMint');
  const outputMint = p.get('outputMint');
  const amount = p.get('amount');
  const slippageBps = p.get('slippageBps') || '1000';
  const onlyDirectRoutes = p.get('onlyDirectRoutes') === 'true';
  const maxAccounts = Math.min(64, Math.max(8, Number(p.get('maxAccounts')) || 40));
  if (!inputMint || !outputMint || !amount) {
    return NextResponse.json({ error: 'inputMint, outputMint and amount are required' }, { status: 400 });
  }
  try {
    // maxAccounts keeps the swap inside the 1232-byte transaction limit; onlyDirectRoutes is the retry knob.
    const url = `${BASE}/quote?inputMint=${encodeURIComponent(inputMint)}&outputMint=${encodeURIComponent(outputMint)}&amount=${encodeURIComponent(amount)}&slippageBps=${encodeURIComponent(slippageBps)}&restrictIntermediateTokens=true&maxAccounts=${maxAccounts}${onlyDirectRoutes ? '&onlyDirectRoutes=true' : ''}`;
    const res = await fetch(url, { headers: headers(), cache: 'no-store' });
    const data = await res.json().catch(() => null);
    if (!res.ok) return NextResponse.json({ error: data?.error || `Jupiter quote failed (${res.status})` }, { status: 502 });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Jupiter quote failed' }, { status: 502 });
  }
}

/** POST /api/jupiter { quoteResponse, userPublicKey, priorityFeeLamports? } -> { transaction (base64) } */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { quoteResponse, userPublicKey, priorityFeeLamports } = body || {};
  if (!quoteResponse || !userPublicKey) {
    return NextResponse.json({ error: 'quoteResponse and userPublicKey are required' }, { status: 400 });
  }
  try {
    const res = await fetch(`${BASE}/swap`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        dynamicSlippage: false,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: Math.max(1_000, Number(priorityFeeLamports) || 500_000),
            priorityLevel: 'high',
          },
        },
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.swapTransaction) {
      return NextResponse.json({ error: data?.error || `Jupiter swap build failed (${res.status})` }, { status: 502 });
    }
    return NextResponse.json({ transaction: data.swapTransaction, provider: 'jupiter', lastValidBlockHeight: data.lastValidBlockHeight });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Jupiter swap build failed' }, { status: 502 });
  }
}
