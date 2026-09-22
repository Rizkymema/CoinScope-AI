import { NextRequest, NextResponse } from 'next/server';
import { fetchPumpFunLatestRaw } from '@/lib/server-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Server-side proxy for the Pump.fun frontend API (browser requests are blocked by CORS). */
export async function GET(req: NextRequest) {
  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 30));
  const { coins, stale } = await fetchPumpFunLatestRaw(limit);
  return NextResponse.json({ coins, stale });
}
