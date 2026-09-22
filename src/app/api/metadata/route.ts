import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Resolves Metaplex token metadata JSON (usually on IPFS) server-side and returns image + description. */
const IPFS_GATEWAYS = ['https://ipfs.io/ipfs/', 'https://cloudflare-ipfs.com/ipfs/', 'https://pump.mypinata.cloud/ipfs/'];
const cache = new Map<string, { ts: number; data: { image?: string; description?: string; name?: string; symbol?: string } }>();
const CACHE_TTL_MS = 10 * 60_000;

function candidateUrls(uri: string): string[] {
  if (uri.startsWith('ipfs://')) {
    const path = uri.replace('ipfs://', '');
    return IPFS_GATEWAYS.map((g) => g + path);
  }
  const m = uri.match(/\/ipfs\/([^/?#]+.*)$/);
  if (m) return [uri, ...IPFS_GATEWAYS.map((g) => g + m[1]).filter((u) => u !== uri)];
  return [uri];
}

function normalizeImage(image: unknown): string | undefined {
  if (typeof image !== 'string' || !image) return undefined;
  if (image.startsWith('ipfs://')) return IPFS_GATEWAYS[0] + image.replace('ipfs://', '');
  return image;
}

export async function GET(req: NextRequest) {
  const uri = req.nextUrl.searchParams.get('uri') || '';
  if (!/^https?:\/\//.test(uri) && !uri.startsWith('ipfs://')) {
    return NextResponse.json({ error: 'Invalid uri' }, { status: 400 });
  }

  const hit = cache.get(uri);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return NextResponse.json(hit.data);

  for (const url of candidateUrls(uri)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      clearTimeout(timer);
      if (!res.ok) continue;
      const json = await res.json();
      const data = {
        image: normalizeImage(json?.image),
        description: typeof json?.description === 'string' ? json.description.slice(0, 500) : undefined,
        name: typeof json?.name === 'string' ? json.name : undefined,
        symbol: typeof json?.symbol === 'string' ? json.symbol : undefined,
      };
      cache.set(uri, { ts: Date.now(), data });
      return NextResponse.json(data);
    } catch {
      // next gateway
    }
  }

  return NextResponse.json({ error: 'Metadata unavailable' }, { status: 404 });
}
