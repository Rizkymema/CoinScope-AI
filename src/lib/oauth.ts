import { getAccessKey } from './server-auth';

/**
 * Minimal OAuth 2.0 authorization server (client_credentials grant) layered in front of the
 * existing access-key auth.
 *
 * Some MCP clients (Google Gemini's connector form is the one that prompted this) only offer
 * an OAuth flow and ask the user to type in a Client ID and Client Secret - they have no
 * "paste a Bearer token" option. This issues the SAME token as COINSCOPE_ACCESS_KEY, so
 * /api/mcp's existing bearer check needs no changes: OAuth is just another door to one secret.
 */

export function getOAuthClientId(): string {
  return (process.env.COINSCOPE_OAUTH_CLIENT_ID || '').trim();
}

export function getOAuthClientSecret(): string {
  return (process.env.COINSCOPE_OAUTH_CLIENT_SECRET || '').trim();
}

/** OAuth only makes sense once there is a token to hand out, so the access key is required too. */
export function oauthConfigured(): boolean {
  return !!getOAuthClientId() && !!getOAuthClientSecret() && !!getAccessKey();
}

/** Constant-time-ish compare, mirrors server-auth's keysMatch. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface TokenRequestParams {
  clientId: string;
  clientSecret: string;
  grantType: string;
}

/**
 * Reads client_id / client_secret / grant_type from wherever the caller put them: HTTP Basic
 * auth (the RFC 6749-preferred method), a form-encoded body, or a JSON body. Reads the request
 * body exactly once so it works regardless of which shape the client sends.
 */
export async function parseTokenRequest(req: Request): Promise<TokenRequestParams> {
  let clientId = '';
  let clientSecret = '';
  let grantType = '';

  const authHeader = req.headers.get('authorization') || '';
  const basic = authHeader.match(/^Basic\s+(.+)$/i);
  if (basic) {
    try {
      const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      if (sep !== -1) {
        clientId = decoded.slice(0, sep);
        clientSecret = decoded.slice(sep + 1);
      }
    } catch {
      // malformed header - the body may still carry the credentials
    }
  }

  const contentType = req.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      const body = await req.json();
      grantType = String(body?.grant_type || grantType || '');
      clientId = clientId || String(body?.client_id || '');
      clientSecret = clientSecret || String(body?.client_secret || '');
    } else {
      const text = await req.text();
      const params = new URLSearchParams(text);
      grantType = params.get('grant_type') || grantType;
      clientId = clientId || params.get('client_id') || '';
      clientSecret = clientSecret || params.get('client_secret') || '';
    }
  } catch {
    // no body, or unparsable - whatever the Basic header supplied still applies
  }

  if (!grantType) {
    try {
      grantType = new URL(req.url).searchParams.get('grant_type') || '';
    } catch {
      // ignore
    }
  }

  return { clientId, clientSecret, grantType };
}

export function verifyClientCredentials(creds: Pick<TokenRequestParams, 'clientId' | 'clientSecret'>): boolean {
  if (!oauthConfigured()) return false;
  if (!creds.clientId || !creds.clientSecret) return false;
  return safeEqual(creds.clientId, getOAuthClientId()) && safeEqual(creds.clientSecret, getOAuthClientSecret());
}
