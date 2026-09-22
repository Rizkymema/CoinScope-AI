import { NextRequest, NextResponse } from 'next/server';
import { BridgeStore, bridgeBackend, BridgeResult } from '@/lib/bridge-store';
import { isAuthorized, authRequired } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/bridge/sync
 * Called by the dashboard every ~2s. Body: { snapshot, logs, positions, recentCoins, results: BridgeResult[] }
 * Stores the latest state, records finished command results and returns the pending commands.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized: access key does not match COINSCOPE_ACCESS_KEY' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    if (body?.snapshot) {
      await BridgeStore.setState({
        snapshot: body.snapshot,
        logs: Array.isArray(body.logs) ? body.logs.slice(0, 40) : [],
        positions: Array.isArray(body.positions) ? body.positions : [],
        recentCoins: Array.isArray(body.recentCoins) ? body.recentCoins.slice(0, 40) : [],
        updatedAt: Date.now(),
      });
    }

    const results: BridgeResult[] = Array.isArray(body?.results) ? body.results : [];
    for (const r of results) {
      if (r?.id) await BridgeStore.putResult({ id: r.id, ok: !!r.ok, result: String(r.result ?? ''), finishedAt: Date.now() });
    }

    const commands = await BridgeStore.takeAll();
    return NextResponse.json({ commands, backend: bridgeBackend, authRequired: authRequired() });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Bridge sync failed' }, { status: 500 });
  }
}

/** GET /api/bridge/sync -> bridge status (for the UI / debugging). */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const state = await BridgeStore.getState();
  return NextResponse.json({
    backend: bridgeBackend,
    authRequired: authRequired(),
    dashboardOnline: await BridgeStore.isDashboardOnline(),
    lastSync: state?.updatedAt || null,
  });
}
