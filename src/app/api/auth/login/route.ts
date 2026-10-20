import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { SESSION_COOKIE, checkCredentials, createSessionToken, loginUser, sessionCookieOptions } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/login { username, password } -> sets the session cookie. */
export async function POST(req: NextRequest) {
  // Slows down password guessing (per IP, per instance).
  const limited = rateLimit(req, 'auth-login', 10, 60_000);
  if (limited) return limited;

  let username = '';
  let password = '';
  try {
    const body = await req.json();
    username = String(body?.username ?? '');
    password = String(body?.password ?? '');
  } catch {
    return NextResponse.json({ error: 'invalid_body', message: 'Invalid request.' }, { status: 400 });
  }
  if (!username || !password) {
    return NextResponse.json({ error: 'missing_fields', message: 'Enter your username and password.' }, { status: 400 });
  }

  if (!(await checkCredentials(username, password))) {
    // Same answer for a wrong user or a wrong password.
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: 'invalid_credentials', message: 'Wrong username or password.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, user: loginUser() });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(loginUser()), sessionCookieOptions(req.nextUrl.protocol === 'https:'));
  return res;
}
