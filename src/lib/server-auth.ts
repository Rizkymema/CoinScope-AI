/**
 * Shared-secret auth for the MCP endpoint and the browser bridge.
 * Set COINSCOPE_ACCESS_KEY on the server; MCP clients send it as `Authorization: Bearer <key>`,
 * the dashboard stores it via the login modal ("Secret Key") and sends it on every sync.
 * When the variable is unset everything is open (local development only).
 */

export function getAccessKey(): string {
  return (process.env.COINSCOPE_ACCESS_KEY || process.env.MCP_API_KEY || '').trim();
}

export function authRequired(): boolean {
  return getAccessKey().length > 0;
}

export function extractBearer(req: Request): string {
  const header = req.headers.get('authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  return (req.headers.get('x-access-key') || '').trim();
}

/** Constant-time-ish comparison to avoid trivial timing leaks. */
export function keysMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isAuthorized(req: Request): boolean {
  if (!authRequired()) return true;
  return keysMatch(extractBearer(req), getAccessKey());
}
