import { NextRequest, NextResponse } from 'next/server';
import { oauthConfigured, parseTokenRequest, verifyClientCredentials } from '@/lib/oauth';
import { getAccessKey } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OAuth 2.0 token endpoint - RFC 6749 client_credentials grant.
 * POST with either HTTP Basic auth (client_id:client_secret) or a form/JSON body containing
 * client_id, client_secret and grant_type=client_credentials. Returns the same bearer token
 * /api/mcp already accepts directly, so the two auth paths grant identical access.
 */
export async function POST(req: NextRequest) {
  if (!oauthConfigured()) {
    return NextResponse.json(
      {
        error: 'server_error',
        error_description:
          'OAuth is not configured on this server. Set COINSCOPE_OAUTH_CLIENT_ID, COINSCOPE_OAUTH_CLIENT_SECRET and COINSCOPE_ACCESS_KEY.',
      },
      { status: 500 }
    );
  }

  const { clientId, clientSecret, grantType } = await parseTokenRequest(req);

  if (grantType && grantType !== 'client_credentials') {
    return NextResponse.json(
      { error: 'unsupported_grant_type', error_description: 'Only grant_type=client_credentials is supported.' },
      { status: 400 }
    );
  }

  if (!verifyClientCredentials({ clientId, clientSecret })) {
    return NextResponse.json(
      { error: 'invalid_client', error_description: 'Unknown client_id or wrong client_secret.' },
      { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="coinscope-mcp"' } }
    );
  }

  return NextResponse.json({
    access_token: getAccessKey(),
    token_type: 'Bearer',
    // The issued token is the static access key, not a real short-lived credential, so a long
    // expiry avoids pointless refreshes; refreshing early always succeeds and returns the same value.
    expires_in: 31536000,
    scope: 'mcp',
  });
}

export async function GET() {
  return NextResponse.json(
    { error: 'invalid_request', error_description: 'Use POST with grant_type=client_credentials.' },
    { status: 405 }
  );
}
