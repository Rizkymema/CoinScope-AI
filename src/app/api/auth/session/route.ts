import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, hasCustomPassword, verifySessionToken } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/auth/session -> who is signed in (the header shows it next to the logout button). */
export async function GET(req: NextRequest) {
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  return NextResponse.json(session ? { authenticated: true, user: session.u, defaultPassword: !hasCustomPassword() } : { authenticated: false }, { status: session ? 200 : 401 });
}
