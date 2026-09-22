'use client';

import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, Loader2, Lock, ShieldCheck, AlertTriangle, Wallet, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useBotStore } from '@/store/useBotStore';
import { WalletService, WalletProviderType } from '@/services/wallet.service';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccessLogin?: () => void;
}

const WALLETS: { id: WalletProviderType; name: string; site: string }[] = [
  { id: 'phantom', name: 'Phantom', site: 'https://phantom.app/download' },
  { id: 'solflare', name: 'Solflare', site: 'https://solflare.com/download' },
];

export function LoginModal({ isOpen, onClose, onSuccessLogin }: LoginModalProps) {
  const { connectWallet, disconnectWallet, settings } = useBotStore(
    useShallow((s) => ({
      connectWallet: s.connectWallet,
      disconnectWallet: s.disconnectWallet,
      settings: s.settings,
    }))
  );

  const [busy, setBusy] = useState<WalletProviderType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<WalletProviderType[]>([]);

  useEffect(() => {
    if (isOpen) {
      setInstalled(WalletService.getInstalledWallets());
      setError(null);
    }
  }, [isOpen]);

  // Close on Escape.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const connected = settings.phantomWalletConnected && settings.connectedWalletAddress;

  const connect = async (wallet: WalletProviderType) => {
    setBusy(wallet);
    setError(null);
    await connectWallet(wallet);
    const after = useBotStore.getState().settings;
    setBusy(null);
    if (after.phantomWalletConnected) {
      onSuccessLogin?.();
      setTimeout(onClose, 500);
    } else {
      setError('Connection was rejected or the extension is locked. Unlock the wallet and try again.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-dialog-title"
      onClick={onClose}
    >
      <div className="panel w-full max-w-md p-5 animate-fade-up relative" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 p-1 rounded-md text-slate-500 hover:text-white hover:bg-white/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 id="wallet-dialog-title" className="text-[15px] font-bold text-white flex items-center gap-2">
          <Wallet className="w-4 h-4 text-signal" />
          {connected ? 'Wallet connected' : 'Connect a wallet'}
        </h2>
        <p className="text-[13px] text-slate-400 mt-1.5 leading-relaxed">
          {connected
            ? 'The bot signs every trade through this wallet. Nothing leaves your browser without a signing prompt.'
            : 'Needed for live trading on Solana. Paper trading works without one. Keys never leave the extension.'}
        </p>

        {connected ? (
          <>
            <div className="panel-2 p-4 mt-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-500">
                    {settings.walletType === 'solflare' ? 'Solflare' : 'Phantom'} address
                  </p>
                  <p className="font-mono text-[13px] text-white truncate mt-0.5">
                    {settings.connectedWalletAddress?.slice(0, 8)}…{settings.connectedWalletAddress?.slice(-8)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[11px] text-slate-500">Balance</p>
                  <p className="font-mono text-[13px] text-pos font-semibold mt-0.5">{settings.solBalance.toFixed(3)} SOL</p>
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <button type="button" onClick={onClose} className="btn btn-primary flex-1">
                <Check className="w-4 h-4" />
                Done
              </button>
              <button
                type="button"
                onClick={async () => {
                  await disconnectWallet();
                  onClose();
                }}
                className="btn btn-secondary"
              >
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            <ul className="space-y-2 mt-4">
              {WALLETS.map(({ id, name, site }) => {
                const present = installed.includes(id);
                return (
                  <li key={id}>
                    {present ? (
                      <button
                        type="button"
                        onClick={() => connect(id)}
                        disabled={busy !== null}
                        className="panel-interactive w-full p-3.5 flex items-center gap-3 text-left disabled:opacity-60"
                      >
                        <span className="grid place-items-center w-9 h-9 rounded-lg bg-ink-800 shrink-0">
                          <Wallet className="w-4 h-4 text-signal" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold text-white">{name}</span>
                          <span className="block text-[11px] text-pos mt-0.5">Detected</span>
                        </span>
                        {busy === id ? (
                          <Loader2 className="w-4 h-4 text-signal animate-spin shrink-0" />
                        ) : (
                          <ArrowRight className="w-4 h-4 text-slate-500 shrink-0" />
                        )}
                      </button>
                    ) : (
                      <a
                        href={site}
                        target="_blank"
                        rel="noreferrer"
                        className="panel-interactive w-full p-3.5 flex items-center gap-3 text-left"
                      >
                        <span className="grid place-items-center w-9 h-9 rounded-lg bg-ink-800 shrink-0">
                          <Wallet className="w-4 h-4 text-slate-500" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold text-slate-300">{name}</span>
                          <span className="block text-[11px] text-slate-500 mt-0.5">Not installed — get the extension</span>
                        </span>
                        <ArrowRight className="w-4 h-4 text-slate-600 shrink-0" />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>

            {error && (
              <p className="flex items-start gap-1.5 text-xs text-neg mt-3">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                {error}
              </p>
            )}

            <p className="text-[11px] text-slate-500 mt-4 leading-relaxed">
              Prefer to look around first? Close this dialog — the market feed and paper trading need no wallet at all.
            </p>
          </>
        )}

        <footer className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-line text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" />
            Non-custodial
          </span>
          <span className="flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" />
            Keys stay in the extension
          </span>
        </footer>
      </div>
    </div>
  );
}
