'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, Plug, RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react';
import { BridgeService, BridgeStatus } from '@/services/bridge.service';

/** Tools the MCP server exposes, grouped for the reference list. */
const TOOLS = {
  Market: ['get_new_coins', 'get_trending_coins', 'search_coins', 'get_token', 'analyze_token', 'get_sol_price'],
  'Bot state': ['get_bot_status', 'get_positions', 'get_trade_history', 'get_bot_logs'],
  Control: [
    'start_bot',
    'stop_bot',
    'update_settings',
    'snipe_token',
    'sell_position',
    'set_position_targets',
    'manage_targets',
    'dry_run_live_trade',
  ],
};

type Snippet = 'claude-code' | 'mcp-json' | 'stdio';

const SNIPPET_LABEL: Record<Snippet, string> = {
  'claude-code': 'Claude Code',
  'mcp-json': 'mcp.json',
  stdio: 'stdio bridge',
};

const CopyButton: React.FC<{ value: string; label: string; className?: string }> = ({ value, label, className = '' }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API is unavailable over plain http on some browsers.
      const el = document.createElement('textarea');
      el.value = value;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand('copy');
      } catch {
        /* nothing else to try */
      }
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button type="button" onClick={copy} aria-label={label} className={`btn btn-sm btn-secondary ${className}`}>
      {copied ? <Check className="w-3 h-3 text-pos" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
};

interface OAuthCreds {
  configured: boolean;
  clientId?: string;
  clientSecret?: string;
}

export const BotMcpPanel: React.FC = () => {
  const [origin, setOrigin] = useState('');
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [bridge, setBridge] = useState<BridgeStatus>(() => BridgeService.getStatus());
  const [snippet, setSnippet] = useState<Snippet>('mcp-json');
  const [oauth, setOauth] = useState<OAuthCreds | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    setKey(BridgeService.getAccessKey());
    return BridgeService.onStatus(setBridge);
  }, []);

  // OAuth credentials are gated behind the same access key as the bridge - fetch them once we
  // have a key to send, and again whenever the user changes it.
  useEffect(() => {
    if (!key.trim()) {
      setOauth(null);
      return;
    }
    let active = true;
    setOauthLoading(true);
    fetch('/api/oauth/credentials', { headers: { Authorization: `Bearer ${key.trim()}` } })
      .then((r) => (r.ok ? r.json() : { configured: false }))
      .then((d) => active && setOauth(d))
      .catch(() => active && setOauth(null))
      .finally(() => active && setOauthLoading(false));
    return () => {
      active = false;
    };
  }, [key]);

  const endpoint = origin ? `${origin}/api/mcp` : '/api/mcp';
  const keyForSnippet = key.trim() || 'YOUR_ACCESS_KEY';
  const tokenEndpoint = origin ? `${origin}/api/oauth/token` : '/api/oauth/token';
  const discoveryUrl = origin
    ? `${origin}/.well-known/oauth-authorization-server`
    : '/.well-known/oauth-authorization-server';

  const snippets: Record<Snippet, string> = useMemo(
    () => ({
      'claude-code': `claude mcp add --transport http coinscope ${endpoint} \\
  --header "Authorization: Bearer ${keyForSnippet}"`,
      'mcp-json': `{
  "mcpServers": {
    "coinscope": {
      "url": "${endpoint}",
      "headers": {
        "Authorization": "Bearer ${keyForSnippet}"
      }
    }
  }
}`,
      stdio: `{
  "mcpServers": {
    "coinscope": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "${endpoint}",
        "--header",
        "Authorization:Bearer ${keyForSnippet}"
      ]
    }
  }
}`,
    }),
    [endpoint, keyForSnippet]
  );

  const saveKey = async () => {
    setTesting(true);
    setResult(null);
    const test = await BridgeService.testKey(key);
    if (test.ok) BridgeService.setAccessKey(key.trim());
    setResult({ ok: test.ok, message: test.message });
    setTesting(false);
  };

  return (
    <section className="panel p-5">
      <h3 className="text-[13px] font-bold text-white flex items-center gap-2 pb-3 mb-4 border-b border-line">
        <Plug className="w-4 h-4 text-signal" />
        MCP integration
        <span className={bridge.connected ? 'chip chip-pos' : 'chip'}>
          <span className={`dot ${bridge.connected ? 'dot-live' : 'dot-idle'}`} />
          {bridge.connected ? (bridge.authRequired ? 'Connected · secured' : 'Connected · open') : 'Not connected'}
        </span>
      </h3>

      <p className="text-[13px] text-slate-400 leading-relaxed max-w-3xl">
        This terminal is itself an MCP server. Point Claude, Cursor, Windsurf or any other MCP client at the endpoint below
        and it can read the launch feed and drive the bot — no API key of your own required.
      </p>

      {/* ------------------------------------------------ endpoint + key */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <div>
          <label className="label" htmlFor="mcp-endpoint">
            Server URL
          </label>
          <div className="flex gap-2">
            <input
              id="mcp-endpoint"
              readOnly
              value={endpoint}
              onFocus={(e) => e.currentTarget.select()}
              className="field font-mono text-xs"
            />
            <CopyButton value={endpoint} label="Copy server URL" className="shrink-0" />
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5">Streamable HTTP transport. Same URL for every client.</p>
        </div>

        <div>
          <label className="label" htmlFor="mcp-key">
            Access key
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                id="mcp-key"
                type={showKey ? 'text' : 'password'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveKey()}
                placeholder="Value of COINSCOPE_ACCESS_KEY"
                autoComplete="off"
                spellCheck={false}
                className="field font-mono text-xs pr-9"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? 'Hide access key' : 'Show access key'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-500 hover:text-white transition-colors"
              >
                {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <button type="button" onClick={saveKey} disabled={testing} className="btn btn-primary shrink-0">
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              Save
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5">
            Must match <code className="text-slate-300">COINSCOPE_ACCESS_KEY</code> on the server. Stored in this browser only.
          </p>
        </div>
      </div>

      {result && (
        <p className={`flex items-start gap-1.5 text-xs mt-3 ${result.ok ? 'text-pos' : 'text-neg'}`}>
          {result.ok ? (
            <Check className="w-3.5 h-3.5 shrink-0 mt-px" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          )}
          {result.message}
        </p>
      )}

      {!bridge.connected && bridge.lastError && !result && (
        <p className="flex items-start gap-1.5 text-xs mt-3 text-warn">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          {bridge.lastError}
        </p>
      )}

      {/* ------------------------------------------------ client config */}
      <div className="mt-5 pt-4 border-t border-line">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="tabbar">
            {(Object.keys(SNIPPET_LABEL) as Snippet[]).map((id) => (
              <button key={id} type="button" onClick={() => setSnippet(id)} data-active={snippet === id} className="tab">
                {SNIPPET_LABEL[id]}
              </button>
            ))}
          </div>
          <CopyButton value={snippets[snippet]} label="Copy configuration" />
        </div>

        <pre className="panel-2 terminal p-3.5 overflow-x-auto text-slate-300 whitespace-pre">{snippets[snippet]}</pre>

        <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
          {snippet === 'claude-code'
            ? 'Run this once in your terminal, then ask Claude Code about your positions.'
            : snippet === 'mcp-json'
            ? 'Add to the MCP config of Cursor, Windsurf or Claude Desktop, then restart the client.'
            : 'For clients that only speak stdio, mcp-remote bridges them to this HTTP endpoint.'}
        </p>
      </div>

      {/* ------------------------------------------------ OAuth (Gemini, etc.) */}
      <div className="mt-5 pt-4 border-t border-line">
        <h4 className="text-[13px] font-bold text-white flex items-center gap-2 mb-1">
          <KeyRound className="w-3.5 h-3.5 text-signal" />
          OAuth credentials
        </h4>
        <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
          Some clients (Google Gemini's connector form is the common one) only accept OAuth, not a
          pasted Bearer token. Use these in its Client ID / Client Secret fields - they unlock the
          exact same access as the key above, just through an OAuth handshake instead of a header.
        </p>

        {!key.trim() ? (
          <p className="text-[11px] text-slate-500">Enter and save the access key above first.</p>
        ) : oauthLoading ? (
          <p className="flex items-center gap-2 text-[11px] text-slate-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading OAuth credentials…
          </p>
        ) : !oauth?.configured ? (
          <p className="text-[11px] text-warn flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            OAuth is not set up on the server yet (needs COINSCOPE_OAUTH_CLIENT_ID and
            COINSCOPE_OAUTH_CLIENT_SECRET), or the access key above hasn't been saved correctly.
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="mcp-oauth-client-id">
                Client ID
              </label>
              <div className="flex gap-2">
                <input
                  id="mcp-oauth-client-id"
                  readOnly
                  value={oauth.clientId}
                  onFocus={(e) => e.currentTarget.select()}
                  className="field font-mono text-xs"
                />
                <CopyButton value={oauth.clientId || ''} label="Copy client ID" className="shrink-0" />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="mcp-oauth-client-secret">
                Client secret
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    id="mcp-oauth-client-secret"
                    readOnly
                    type={showSecret ? 'text' : 'password'}
                    value={oauth.clientSecret}
                    onFocus={(e) => e.currentTarget.select()}
                    className="field font-mono text-xs pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    aria-label={showSecret ? 'Hide client secret' : 'Show client secret'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-500 hover:text-white transition-colors"
                  >
                    {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <CopyButton value={oauth.clientSecret || ''} label="Copy client secret" className="shrink-0" />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="mcp-oauth-token-url">
                Token URL
              </label>
              <div className="flex gap-2">
                <input
                  id="mcp-oauth-token-url"
                  readOnly
                  value={tokenEndpoint}
                  onFocus={(e) => e.currentTarget.select()}
                  className="field font-mono text-xs"
                />
                <CopyButton value={tokenEndpoint} label="Copy token URL" className="shrink-0" />
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">Only needed if the form asks for it directly.</p>
            </div>

            <div>
              <label className="label" htmlFor="mcp-oauth-discovery-url">
                Discovery URL
              </label>
              <div className="flex gap-2">
                <input
                  id="mcp-oauth-discovery-url"
                  readOnly
                  value={discoveryUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="field font-mono text-xs"
                />
                <CopyButton value={discoveryUrl} label="Copy discovery URL" className="shrink-0" />
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">Most OAuth clients find the token URL from this automatically.</p>
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------ requirements */}
      <div className="mt-5 pt-4 border-t border-line grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-xs">
        <p className="flex items-start gap-2 text-slate-400">
          <RefreshCw className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-px" />
          Keep this tab open. The bot engine and your wallet live in the browser, so control tools run here.
        </p>
        <p className="flex items-start gap-2 text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-px" />
          Market tools work without the dashboard. Anyone holding the key can trade on your behalf.
        </p>
      </div>

      {/* ------------------------------------------------ tool reference */}
      <div className="mt-5 pt-4 border-t border-line grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Object.entries(TOOLS).map(([group, tools]) => (
          <div key={group}>
            <p className="text-[11px] font-semibold text-slate-400 mb-2">{group}</p>
            <ul className="flex flex-wrap gap-1">
              {tools.map((t) => (
                <li key={t} className="chip font-mono text-[10px]">
                  {t}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
};
