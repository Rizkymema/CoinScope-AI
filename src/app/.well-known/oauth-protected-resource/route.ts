import { NextRequest } from 'next/server';
import { getPublicOrigin, metadataCorsOptionsRequestHandler, protectedResourceHandler } from 'mcp-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * RFC 9728 Protected Resource Metadata for /api/mcp.
 * withMcpAuth advertises this path in the WWW-Authenticate header on a 401, so a client that
 * only has the endpoint URL can discover which authorization server to get a token from.
 */
export function GET(req: NextRequest) {
  const origin = getPublicOrigin(req);
  return protectedResourceHandler({ authServerUrls: [origin], resourceUrl: `${origin}/api/mcp` })(req);
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
