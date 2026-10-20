import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, SESSION_RENEW_BELOW_S, createSessionToken, sessionCookieOptions, verifySessionToken } from '@/lib/auth';
import { authRequired } from '@/lib/server-auth';

/**
 * Login gate for the dashboard and its API routes (the AI routes spend the Anthropic key, the RPC
 * and swap proxies build real transactions).
 *
 * Left open, because they carry their own credentials or must be reachable to log in:
 *   /login, /api/auth/*           the login itself
 *   /api/mcp, /api/oauth/*,        MCP clients authenticate with COINSCOPE_ACCESS_KEY - only while
 *   /.well-known/*, /api/bridge/*  that key is set; without it these routes are open, so they need
 *                                  the login like everything else (the dashboard tab sends the cookie)
 */
const KEY_PROTECTED = ['/api/mcp', '/api/oauth', '/.well-known', '/api/bridge'];
const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(prefix + '/');

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (under(pathname, '/api/auth')) return NextResponse.next();
  if (authRequired() && KEY_PROTECTED.some((p) => under(pathname, p))) return NextResponse.next();

  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === '/login') {
    // Already signed in: straight to the dashboard.
    return session ? NextResponse.redirect(new URL('/', req.url)) : NextResponse.next();
  }

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'login_required', message: 'Login session expired - reload the page and log in again.' }, { status: 401 });
    }
    const url = new URL('/login', req.url);
    if (pathname !== '/') url.searchParams.set('next', pathname + search);
    return NextResponse.redirect(url);
  }

  // Sliding session: a dashboard that stays in use never gets logged out mid-run.
  const res = NextResponse.next();
  if (session.exp - Math.floor(Date.now() / 1000) < SESSION_RENEW_BELOW_S) {
    res.cookies.set(SESSION_COOKIE, await createSessionToken(session.u), sessionCookieOptions(req.nextUrl.protocol === 'https:'));
  }
  return res;
}

export const config = {
  // Everything except Next's static assets and plain image/icon files.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml)$).*)'],
};
