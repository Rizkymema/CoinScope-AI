import { NextRequest, NextResponse } from 'next/server';
import { RPC_ALLOWED_METHODS, rpcCall } from '@/lib/solana-rpc';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Browser -> Solana RPC proxy. The dashboard sends standard JSON-RPC here; the server forwards it
 * to the first endpoint that will answer (see lib/solana-rpc). Restricted to the methods the app
 * uses and rate limited per IP so it cannot be borrowed as a free general-purpose RPC.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, 'rpc', 240, 60_000);
  if (limited) return limited;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 });
  }

  const id = body?.id ?? 1;
  const method = String(body?.method || '');
  const params = Array.isArray(body?.params) ? body.params : [];

  if (!RPC_ALLOWED_METHODS.has(method)) {
    return NextResponse.json(
      { jsonrpc: '2.0', id, error: { code: -32601, message: `Method ${method || '(none)'} is not available through this proxy` } },
      { status: 403 }
    );
  }

  const outcome = await rpcCall(method, params);
  const headers = outcome.endpoint ? { 'X-RPC-Endpoint': outcome.endpoint } : undefined;
  return outcome.error
    ? NextResponse.json({ jsonrpc: '2.0', id, error: outcome.error }, { status: 200, headers })
    : NextResponse.json({ jsonrpc: '2.0', id, result: outcome.result }, { status: 200, headers });
}
