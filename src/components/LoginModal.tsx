'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ExternalLink,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Unlock,
  Wallet,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useBotStore } from '@/store/useBotStore';
import { WalletService, WalletProviderType } from '@/services/wallet.service';
import { CopyButton } from '@/components/common/CopyButton';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccessLogin?: () => void;
}

const WALLETS: { id: WalletProviderType; name: string; site: string }[] = [
  { id: 'phantom', name: 'Phantom', site: 'https://phantom.app/download' },
  { id: 'solflare', name: 'Solflare', site: 'https://solflare.com/download' },
];

const walletName = (type: WalletProviderType | null) => (type === 'solflare' ? 'Solflare' : 'Phantom');

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-baseline justify-between gap-4 py-2 border-b border-line last:border-b-0">
    <span className="text-xs text-slate-500 shrink-0">{label}</span>
    <span className="text-[13px] text-slate-200 text-right min-w-0">{children}</span>
  </div>
);

/** Wallet dialog: connect an extension, or - once connected - show exactly which account is in use. */
export function LoginModal({ isOpen, onClose, onSuccessLogin }: LoginModalProps) {
  const { connectWallet, disconnectWallet, refreshWalletBalance, settings, botWallet, solPriceUsd } = useBotStore(
    useShallow((s) => ({
      connectWallet: s.connectWallet,
      disconnectWallet: s.disconnectWallet,
      refreshWalletBalance: s.refreshWalletBalance,
      settings: s.settings,
      botWallet: s.botWallet,
      solPriceUsd: s.solPriceUsd,
    }))
  );

  const [busy, setBusy] = useState<WalletProviderType | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<WalletProviderType[]>([]);

  useEffect(() => {
    if (isOpen) {
      setInstalled(WalletService.getInstalledWallets());
      setError(null);
      refreshWalletBalance();
    }
  }, [isOpen, refreshWalletBalance]);

  // Close on Escape.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const address = settings.phantomWalletConnected ? settings.connectedWalletAddress : null;
  const signsLive = settings.liveSigner === 'wallet';

  const connect = async (wallet: WalletProviderType) => {
    setBusy(wallet);
    setError(null);
    await connectWallet(wallet);
    const after = useBotStore.getState().settings;
    setBusy(null);
    if (after.phantomWalletConnected) {
      onSuccessLogin?.();
    } else {
      setError('Connection was rejected or the extension is locked. Unlock the wallet and try again.');
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await refreshWalletBalance();
    setRefreshing(false);
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
          {address ? 'Connected account' : 'Connect a wallet'}
        </h2>
        <p className="text-[13px] text-slate-400 mt-1.5 leading-relaxed">
          {address
            ? signsLive
              ? 'This account signs live trades. Each buy and sell opens an approval prompt in the extension.'
              : 'Connected for funding and display. Live trades are signed by the bot wallet.'
            : 'Needed for live trading on Solana. Paper trading works without one. Keys never leave the extension.'}
        </p>

        {address ? (
          <>
            <div className="panel-2 p-4 mt-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[13px] font-semibold text-white">
                  <span className="dot dot-live" />
                  {walletName(settings.walletType)}
                </span>
                {signsLive && <span className="chip chip-accent">Signs live trades</span>}
              </div>

              <p className="label mt-3">Address</p>
              <code className="block font-mono text-xs text-white break-all leading-relaxed">{address}</code>
              <div className="flex items-center gap-2 mt-2">
                <CopyButton value={address} label="Copy wallet address" />
                <a href={WalletService.accountUrl(address)} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost">
                  <ExternalLink className="w-3 h-3" />
                  Solscan
                </a>
              </div>

              <div className="mt-3">
                <Row label="Balance">
                  <span className="font-mono font-semibold text-pos">{settings.solBalance.toFixed(4)} SOL</span>
                  {solPriceUsd > 0 && (
                    <span className="font-mono text-slate-500 ml-1.5">≈ ${(settings.solBalance * solPriceUsd).toFixed(2)}</span>
                  )}
                  <button
                    type="button"
                    onClick={refresh}
                    aria-label="Refresh balance"
                    title="Refresh balance"
                    className="ml-1.5 p-1 -my-1 rounded-md text-slate-500 hover:text-white hover:bg-white/5 align-middle"
                  >
                    <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
                  </button>
                </Row>
                <Row label="Network">Solana mainnet</Row>
                <Row label="Mode">{settings.paperTrading ? 'Paper trading' : 'Live trading'}</Row>
              </div>
            </div>

            <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
              To use a different account, switch it inside {walletName(settings.walletType)} - this page follows the
              extension automatically.
            </p>
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
          </>
        )}

        {/* bot wallet summary - the other account that can hold positions */}
        {botWallet.address && (
          <div className="panel-2 p-3.5 mt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[13px] font-semibold text-white">
                <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                Bot wallet
              </span>
              <span className={botWallet.unlocked ? 'chip chip-pos' : 'chip'}>
                {botWallet.unlocked ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                {botWallet.unlocked ? 'Unlocked' : 'Locked'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 mt-2">
              <code className="font-mono text-xs text-slate-300 truncate">{botWallet.address}</code>
              <span className="font-mono text-xs text-slate-200 shrink-0">
                {botWallet.solBalance === null ? '—' : `${botWallet.solBalance.toFixed(4)} SOL`}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              {settings.liveSigner === 'bot' ? 'Signs live trades. ' : ''}Manage it under Bot &rsaquo; Settings.
            </p>
          </div>
        )}

        {address && (
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
              <LogOut className="w-4 h-4" />
              Disconnect
            </button>
          </div>
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
