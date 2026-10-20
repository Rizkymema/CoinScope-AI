'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Activity, Eye, EyeOff, Loader2, LogIn } from 'lucide-react';

/** Only same-site paths are followed after login. */
function safeNext(): string {
  if (typeof window === 'undefined') return '/';
  try {
    const url = new URL(new URLSearchParams(window.location.search).get('next') || '/', window.location.origin);
    return url.origin === window.location.origin && !url.pathname.startsWith('/login') ? url.pathname + url.search + url.hash : '/';
  } catch {
    return '/';
  }
}

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = 'Sign in — CoinScope';
    userRef.current?.focus();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message || 'Sign in failed. Try again.');
        setPassword('');
        setBusy(false);
        return;
      }
      // Full navigation, so the dashboard boots with the new session cookie.
      window.location.replace(safeNext());
    } catch {
      setError('Network error - check your connection and try again.');
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen app-bg text-slate-200 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="flex items-center gap-2.5 mb-6">
          <span className="grid place-items-center w-9 h-9 rounded-lg bg-signal/12 border border-signal/25">
            <Activity className="w-[18px] h-[18px] text-signal" />
          </span>
          <div>
            <p className="font-bold tracking-tight text-[17px] text-white leading-tight">CoinScope</p>
            <p className="text-xs text-slate-500">Memecoin terminal</p>
          </div>
        </div>

        <form onSubmit={submit} className="panel p-5 sm:p-6" noValidate>
          <h1 className="text-[15px] font-bold text-white">Sign in</h1>
          <p className="text-[13px] text-slate-400 mt-1 mb-5">The scanner, the auto-trade bot and the AI copilot open after you sign in.</p>

          <label htmlFor="username" className="label">
            Username
          </label>
          <input
            id="username"
            ref={userRef}
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            className="field"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
            aria-invalid={!!error}
          />

          <label htmlFor="password" className="label mt-4">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              className="field pr-10"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              aria-invalid={!!error}
              aria-describedby={error ? 'login-error' : undefined}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-white/5 transition-colors"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {error && (
            <p id="login-error" role="alert" className="mt-3 text-[13px] text-neg">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary btn-lg w-full mt-5" disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-xs text-slate-500 mt-4 text-center">Speculative assets. Most new tokens go to zero.</p>
      </div>
    </main>
  );
}
