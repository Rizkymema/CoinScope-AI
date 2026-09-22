import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Builds an unsigned Solana swap transaction through the PumpPortal Local Trade API.
 * The transaction is returned as base64 and signed client-side by the user's wallet,
 * so no private key ever touches this server.
 * Docs: https://pumpportal.fun/local-trading-api/trading-api
 */
const PUMPPORTAL_TRADE_LOCAL = 'https://pumpportal.fun/api/trade-local';

interface TradeBody {
  publicKey: string;
  action: 'buy' | 'sell';
  mint: string;
  /** Amount of SOL (buy) or tokens (sell). Sells also accept percentage strings such as "100%". */
  amount: number | string;
  denominatedInSol: boolean;
  slippage: number;
  priorityFee: number;
  pool?: string;
}

export async function POST(req: NextRequest) {
  let body: TradeBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { publicKey, action, mint, amount, denominatedInSol, slippage, priorityFee, pool } = body || ({} as TradeBody);
  if (!publicKey || !mint || (action !== 'buy' && action !== 'sell')) {
    return NextResponse.json({ error: 'publicKey, mint and action are required' }, { status: 400 });
  }
  if (amount === undefined || amount === null || amount === '' || (typeof amount === 'number' && !(amount > 0))) {
    return NextResponse.json({ error: 'amount must be positive' }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(PUMPPORTAL_TRADE_LOCAL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey,
        action,
        mint,
        amount,
        denominatedInSol: denominatedInSol ? 'true' : 'false',
        slippage: Math.max(0.1, Math.min(100, Number(slippage) || 10)),
        priorityFee: Math.max(0, Number(priorityFee) || 0.0005),
        pool: pool || 'auto',
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // PumpPortal puts the actual reason in the HTTP status line and a bare "Bad Request" in the body.
      const reason = res.statusText && res.statusText !== 'Bad Request' ? res.statusText : text.slice(0, 300) || res.statusText;
      return NextResponse.json({ error: `PumpPortal responded ${res.status}: ${reason}` }, { status: 502 });
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return NextResponse.json({ error: 'Empty transaction returned' }, { status: 502 });

    // PumpPortal returns raw bytes on success and a JSON error object on failure.
    const asText = buf.toString('utf8');
    if (asText.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(asText);
        return NextResponse.json({ error: parsed?.error || parsed?.message || asText.slice(0, 300) }, { status: 502 });
      } catch {
        // not JSON - treat as bytes
      }
    }

    return NextResponse.json({ transaction: buf.toString('base64'), provider: 'pumpportal' });
  } catch (err: any) {
    const msg = err?.name === 'AbortError' ? 'PumpPortal request timed out' : err?.message || 'Trade build failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
