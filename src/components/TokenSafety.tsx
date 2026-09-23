'use client';

import React, { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Loader2, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { CoinData } from '@/types/coin';

/**
 * On-chain facts about a Solana mint.
 *
 * Only things the chain actually states are shown. There is no "safety score": the two
 * authorities below are binary and decisive, and inventing a composite number out of them
 * would imply a confidence this data does not support.
 */

interface Safety {
  mint: string;
  program: string;
  decimals: number;
  supply: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  initialized: boolean;
  error?: string;
}

const Row: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <div className="flex items-start justify-between gap-3 py-2 border-b border-line last:border-b-0">
    <div className="min-w-0">
      <dt className="text-[12px] text-slate-400">{label}</dt>
      {hint && <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">{hint}</p>}
    </div>
    <dd className="text-[12px] text-right shrink-0">{children}</dd>
  </div>
);

const Verdict: React.FC<{ safe: boolean; safeText: string; riskText: string }> = ({ safe, safeText, riskText }) => (
  <span className={`inline-flex items-center gap-1.5 font-semibold ${safe ? 'text-pos' : 'text-neg'}`}>
    {safe ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
    {safe ? safeText : riskText}
  </span>
);

export const TokenSafety: React.FC<{ coin: CoinData }> = ({ coin }) => {
  const [data, setData] = useState<Safety | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const mint = coin.mint || (coin.id.includes(':') ? coin.id.split(':')[1] : '');
  const isSolana = (coin.chainId || '').toLowerCase() === 'solana';

  useEffect(() => {
    if (!isSolana || !mint) {
      setData(null);
      return;
    }
    let active = true;
    setLoading(true);
    fetch(`/api/token/safety?mint=${encodeURIComponent(mint)}`)
      .then((r) => r.json())
      .then((d) => active && setData(d))
      .catch(() => active && setData(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [mint, isSolana]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(mint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const bothClear = data && !data.error && !data.mintAuthority && !data.freezeAuthority;

  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-line">
        <h3 className="text-[13px] font-bold text-white flex items-center gap-2">
          {bothClear ? <ShieldCheck className="w-4 h-4 text-pos" /> : <ShieldAlert className="w-4 h-4 text-slate-500" />}
          Token checks
        </h3>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-signal" />}
      </header>

      <dl className="px-4 py-1">
        <Row label="Contract">
          <span className="inline-flex items-center gap-1.5">
            <span className="font-mono text-slate-300">
              {mint ? `${mint.slice(0, 5)}…${mint.slice(-5)}` : '—'}
            </span>
            {mint && (
              <button
                type="button"
                onClick={copy}
                aria-label="Copy contract address"
                className="p-1 rounded-md text-slate-500 hover:text-white hover:bg-white/5 transition-colors"
              >
                {copied ? <Check className="w-3 h-3 text-pos" /> : <Copy className="w-3 h-3" />}
              </button>
            )}
          </span>
        </Row>

        {isSolana && data && !data.error ? (
          <>
            <Row
              label="Mint authority"
              hint={data.mintAuthority ? 'The creator can still mint new supply and dilute holders.' : 'Supply is fixed. Nobody can mint more.'}
            >
              <Verdict safe={!data.mintAuthority} safeText="Revoked" riskText="Still active" />
            </Row>
            <Row
              label="Freeze authority"
              hint={data.freezeAuthority ? 'The creator can freeze balances, which would stop you selling.' : 'Balances cannot be frozen.'}
            >
              <Verdict safe={!data.freezeAuthority} safeText="Revoked" riskText="Still active" />
            </Row>
            <Row
              label="Supply"
              hint={data.supply === 0 ? 'The chain reports zero. Wrapped native mints do this.' : undefined}
            >
              <span className="font-mono text-slate-300">
                {data.supply.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
            </Row>
            <Row label="Token program">
              <span className="font-mono text-slate-400">{data.program}</span>
            </Row>
          </>
        ) : isSolana ? (
          <Row label="On-chain checks">
            <span className="text-slate-500">{loading ? 'Reading…' : data?.error ?? 'Unavailable'}</span>
          </Row>
        ) : (
          <Row label="On-chain checks" hint="Mint and freeze authority checks are Solana-only.">
            <span className="text-slate-500">Not available on {coin.chainId}</span>
          </Row>
        )}

        <Row label="Liquidity">
          <span className="font-mono text-slate-300">
            ${Math.round(coin.fundamentals.tvl || 0).toLocaleString('en-US')}
          </span>
        </Row>

        {(coin.websites?.length || coin.socials?.length) && (
          <Row label="Links">
            <span className="inline-flex items-center gap-2 flex-wrap justify-end">
              {coin.websites?.slice(0, 1).map((w) => (
                <a key={w.url} href={w.url} target="_blank" rel="noreferrer" className="text-signal hover:underline inline-flex items-center gap-1">
                  Website <ExternalLink className="w-2.5 h-2.5" />
                </a>
              ))}
              {coin.socials?.slice(0, 2).map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="text-signal hover:underline inline-flex items-center gap-1 capitalize">
                  {s.type} <ExternalLink className="w-2.5 h-2.5" />
                </a>
              ))}
            </span>
          </Row>
        )}
      </dl>

      <p className="px-4 py-2.5 border-t border-line text-[11px] text-slate-500 leading-relaxed">
        These are the only rug checks readable straight from the chain. They say nothing about
        who holds the supply or whether liquidity is locked.
      </p>
    </section>
  );
};
