import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * Token image proxy.
 *
 * Pump.fun logos live on IPFS, which rate-limits browsers (429) and sends
 * `Cross-Origin-Resource-Policy: same-origin`, so the browser blocks them and every
 * token falls back to a placeholder monogram. Fetching them server-side and re-serving
 * from our own origin fixes both, and lets the CDN cache them.
 */

const ALLOWED_HOSTS = [
  'ipfs.io',
  'cloudflare-ipfs.com',
  'gateway.pinata.cloud',
  'pump.mypinata.cloud',
  'nftstorage.link',
  'dweb.link',
  'arweave.net',
  'dd.dexscreener.com',
  'cdn.dexscreener.com',
  'coin-images.coingecko.com',
  'assets.coingecko.com',
  'raw.githubusercontent.com',
  'i.imgur.com',
  'pbs.twimg.com',
  'image-cdn.solana.fm',
  'img.fotofolio.xyz',
  'static.jup.ag',
  'usepaygram.com',
];

/** Gateways tried in order when the original request fails. */
const IPFS_GATEWAYS = ['https://pump.mypinata.cloud/ipfs/', 'https://cloudflare-ipfs.com/ipfs/', 'https://dweb.link/ipfs/', 'https://ipfs.io/ipfs/'];

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif'];
const MAX_BYTES = 3_000_000;

function hostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  return ALLOWED_HOSTS.some((a) => h === a || h.endsWith(`.${a}`));
}

/** Every URL worth trying for this image, best first. */
function candidates(raw: string): string[] {
  const out: string[] = [];
  const cid = raw.match(/\/ipfs\/([^?#]+)/)?.[1] ?? (raw.startsWith('ipfs://') ? raw.slice('ipfs://'.length) : null);
  if (cid) {
    IPFS_GATEWAYS.forEach((g) => out.push(g + cid));
    if (/^https?:\/\//.test(raw) && !out.includes(raw)) out.push(raw);
  } else {
    out.push(raw);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('u') || '';
  if (!raw) return new NextResponse('Missing u', { status: 400 });

  let first: URL;
  try {
    first = new URL(raw.startsWith('ipfs://') ? IPFS_GATEWAYS[0] + raw.slice('ipfs://'.length) : raw);
  } catch {
    return new NextResponse('Invalid url', { status: 400 });
  }
  if (first.protocol !== 'https:' || !hostAllowed(first.hostname)) {
    return new NextResponse('Host not allowed', { status: 403 });
  }

  for (const candidate of candidates(raw)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7_000);
      const res = await fetch(candidate, {
        signal: controller.signal,
        headers: { Accept: 'image/*', 'User-Agent': 'Mozilla/5.0 (compatible; CoinScopeAI/1.0)' },
      });
      clearTimeout(timer);
      if (!res.ok) continue;

      const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!ALLOWED_TYPES.includes(type)) continue;

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_BYTES) continue;

      return new NextResponse(buf, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(buf.length),
          // Long CDN cache: token logos never change.
          'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800',
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      // try the next gateway
    }
  }

  // Transparent 1x1 GIF so the client can fall back to its monogram without a console error.
  return new NextResponse(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'), {
    status: 404,
    headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'public, max-age=600' },
  });
}
