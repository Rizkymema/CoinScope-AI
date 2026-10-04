import { NextResponse } from 'next/server';

/**
 * Fixed-window per-IP limiter, in process memory.
 * Not a hard guarantee on serverless (each instance keeps its own counters), but it stops a single
 * client from hammering an endpoint - which is the realistic abuse case for the RPC proxy and for
 * the AI routes once an Anthropic key is configured.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

/** Returns a 429 response when the caller is over the limit, otherwise null. */
export function rateLimit(req: Request, scope: string, limit: number, windowMs: number): NextResponse | null {
  const now = Date.now();
  const key = `${scope}:${clientIp(req)}`;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5_000) {
      buckets.forEach((b, k) => b.resetAt <= now && buckets.delete(k));
    }
    return null;
  }

  bucket.count += 1;
  if (bucket.count <= limit) return null;

  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  return NextResponse.json(
    { error: 'rate_limited', message: `Too many requests. Try again in ${retryAfter}s.` },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  );
}
