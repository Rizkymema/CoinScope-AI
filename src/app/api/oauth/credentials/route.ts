import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/server-auth';
import { getOAuthClientId, getOAuthClientSecret, oauthConfigured } from '@/lib/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lets the Settings panel display the OAuth Client ID / Secret so the owner can copy them into
 * a client that requires OAuth (e.g. Gemini). Gated behind the same access key as the bridge -
 * whoever can already drive the bot via MCP can see the credentials that grant the same access.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!oauthConfigured()) return NextResponse.json({ configured: false });
  return NextResponse.json({
    configured: true,
    clientId: getOAuthClientId(),
    clientSecret: getOAuthClientSecret(),
  });
}
