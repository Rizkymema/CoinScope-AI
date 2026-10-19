/**
 * Dashboard login: one user/password pair and a signed session cookie.
 *
 * Runs in the middleware (Edge runtime) and in the Node route handlers, so it only uses Web Crypto.
 *
 *   COINSCOPE_LOGIN_USER       username (default "user1")
 *   COINSCOPE_LOGIN_PASSWORD   password (the built-in default is kept here only as a hash; set this
 *                              variable on the server to replace it - the repository is public)
 *   COINSCOPE_SESSION_SECRET   key that signs session cookies (optional; falls back to the server's
 *                              other secrets, so a cookie cannot be forged from the source code)
 */

export const SESSION_COOKIE = 'coinscope_session';
/** The bot runs for days in one tab: a long session, renewed while the dashboard is in use. */
export const SESSION_TTL_S = 30 * 24 * 3600;
export const SESSION_RENEW_BELOW_S = 15 * 24 * 3600;

const DEFAULT_USER = 'user1';
/** SHA-256 of PASSWORD_SALT + the default password. */
const DEFAULT_PASSWORD_SHA256 = 'd194b46948eefd8926cebd0ed3c6f69828473e37019271656ff02d2dc9b52deb';
const PASSWORD_SALT = 'coinscope-login:';

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

/** Comparison whose time does not depend on where the strings differ. */
function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function loginUser(): string {
  return (process.env.COINSCOPE_LOGIN_USER || DEFAULT_USER).trim();
}

/** True when the password comes from the server environment rather than the built-in default. */
export function hasCustomPassword(): boolean {
  return !!process.env.COINSCOPE_LOGIN_PASSWORD;
}

export async function checkCredentials(username: string, password: string): Promise<boolean> {
  const expectedHash = process.env.COINSCOPE_LOGIN_PASSWORD
    ? await sha256Hex(PASSWORD_SALT + process.env.COINSCOPE_LOGIN_PASSWORD)
    : DEFAULT_PASSWORD_SHA256;
  const givenHash = await sha256Hex(PASSWORD_SALT + password);
  // Both checks always run, so a wrong username takes as long as a wrong password.
  const userOk = safeEqual(username.trim().toLowerCase(), loginUser().toLowerCase());
  const passOk = safeEqual(givenHash, expectedHash);
  return userOk && passOk;
}

let keyPromise: Promise<CryptoKey> | null = null;

function signingKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    // Server-only secrets. The final fallback exists for local development without any env file.
    const material =
      process.env.COINSCOPE_SESSION_SECRET ||
      [process.env.ANTHROPIC_API_KEY, process.env.COINSCOPE_ACCESS_KEY, process.env.COINSCOPE_LOGIN_PASSWORD, process.env.KV_REST_API_TOKEN]
        .filter(Boolean)
        .join('|') ||
      'coinscope-local-dev-session-secret';
    keyPromise = crypto.subtle.importKey('raw', encoder.encode(`coinscope-session:${material}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }
  return keyPromise;
}

async function sign(payload: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await signingKey(), encoder.encode(payload));
  return toBase64Url(new Uint8Array(sig));
}

export interface Session {
  /** Username. */
  u: string;
  /** Expiry, unix seconds. */
  exp: number;
}

export async function createSessionToken(username: string): Promise<string> {
  const session: Session = { u: username, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S };
  const payload = toBase64Url(encoder.encode(JSON.stringify(session)));
  return `${payload}.${await sign(payload)}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  if (!safeEqual(sig, await sign(payload))) return null;
  try {
    const session = JSON.parse(fromBase64Url(payload)) as Session;
    if (typeof session?.u !== 'string' || typeof session?.exp !== 'number') return null;
    if (session.exp <= Math.floor(Date.now() / 1000)) return null;
    // A changed username in the environment logs everyone out.
    if (session.u.toLowerCase() !== loginUser().toLowerCase()) return null;
    return session;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(secure: boolean) {
  return { httpOnly: true, secure, sameSite: 'lax' as const, path: '/', maxAge: SESSION_TTL_S };
}
