import { NextRequest, NextResponse } from 'next/server';
import { getPublicOrigin, metadataCorsOptionsRequestHandler } from 'mcp-handler';
import { oauthConfigured } from '@/lib/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * RFC 8414 Authorization Server Metadata.
 * Lets an OAuth-capable MCP client discover the token endpoint automatically once it has a
 * Client ID / Client Secret, instead of the user having to type the URL in by hand.
 */
export async function GET(req: NextRequest) {
  if (!oauthConfigured()) {
    return NextResponse.json({ error: 'OAuth is not configured on this server.' }, { status: 404 });
  }
  const origin = getPublicOrigin(req);
  return NextResponse.json({
    issuer: origin,
    token_endpoint: `${origin}/api/oauth/token`,
    grant_types_supported: ['client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    response_types_supported: [],
    scopes_supported: ['mcp'],
  });
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
