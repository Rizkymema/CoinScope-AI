'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useBotStore } from '@/store/useBotStore';
import { HotWallet, MIN_PASSWORD_LENGTH } from '@/services/hotwallet.service';
import { WalletService } from '@/services/wallet.service';
import { CopyButton } from '@/components/common/CopyButton';

type Mode = 'idle' | 'create' | 'import' | 'fund' | 'withdraw' | 'export' | 'remove';

const PasswordInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}> = ({ value, onChange, placeholder = 'Password', autoFocus, onEnter }) => (
  <input
    type="password"
    className="field"
    value={value}
    autoFocus={autoFocus}
    autoComplete="new-password"
    placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)}
    onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
  />
);

export const BotWalletPanel: React.FC = () => {
  const { botWallet, settings, solPriceUsd, syncBotWallet, refreshWalletBalance, log } = useBotStore(
    useShallow((s) => ({
      botWallet: s.botWallet,
      settings: s.settings,
      solPriceUsd: s.solPriceUsd,
      syncBotWallet: s.syncBotWallet,
      refreshWalletBalance: s.refreshWalletBalance,
      log: s.log,
    }))
  );

  const [mode, setMode] = useState<Mode>('idle');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [secretInput, setSecretInput] = useState('');
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [exported, setExported] = useState<string | null>(null);
  const [showExported, setShowExported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; signature?: string } | null>(null);

  const address = botWallet.address;
  const phantomAddress = settings.phantomWalletConnected ? settings.connectedWalletAddress : null;

  const reset = (next: Mode = 'idle') => {
    setMode(next);
    setPassword('');
    setPassword2('');
    setSecretInput('');
    setAmount('');
    setDestination(next === 'withdraw' ? phantomAddress || '' : '');
    setExported(null);
    setShowExported(false);
    setError(null);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err: any) {
      setError(err?.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const settle = async (signature: string, text: string) => {
    setNotice({ text: `${text} Waiting for confirmation...`, signature });
    const conf = await WalletService.confirmTransaction(signature, settings.solanaRpcUrl);
    setNotice({ text: conf.confirmed ? `${text} Confirmed.` : `${text} ${conf.error || 'Not confirmed yet'} - check Solscan.`, signature });
    await Promise.all([syncBotWallet(), refreshWalletBalance()]);
  };

  /* ---------------------------------------------------------------- actions */

  const create = () =>
    run(async () => {
      if (password !== password2) throw new Error('The two passwords do not match.');
      const addr = await HotWallet.create(password);
      log('info', `[BOT WALLET] Created ${addr.slice(0, 4)}...${addr.slice(-4)}. Export a backup of the key before funding it.`);
      reset();
      setNotice({ text: 'Bot wallet created and unlocked. Export a backup of the key before you fund it.' });
    });

  const importKey = () =>
    run(async () => {
      const addr = await HotWallet.importSecret(secretInput, password);
      log('info', `[BOT WALLET] Imported ${addr.slice(0, 4)}...${addr.slice(-4)}.`);
      reset();
    });

  const unlock = () =>
    run(async () => {
      await HotWallet.unlock(password);
      setPassword('');
    });

  const exportKey = () =>
    run(async () => {
      setExported(await HotWallet.exportSecret(password));
      setPassword('');
    });

  const remove = () =>
    run(async () => {
      await HotWallet.remove(password);
      log('warning', '[BOT WALLET] Removed from this browser.');
      reset();
    });

  const fund = () =>
    run(async () => {
      if (!phantomAddress || !address) throw new Error('Connect Phantom or Solflare first.');
      const sol = Number(amount);
      if (!(sol > 0)) throw new Error('Enter an amount in SOL.');
      const res = await WalletService.transferSol(phantomAddress, address, sol, settings.solanaRpcUrl);
      if (!res.success || !res.signature) throw new Error(res.message || 'Transfer failed.');
      log('tx', `[BOT WALLET] Funded with ${sol} SOL from ${phantomAddress.slice(0, 4)}...`, { txSignature: res.signature });
      reset();
      await settle(res.signature, `Sent ${sol} SOL to the bot wallet.`);
    });

  const withdraw = () =>
    run(async () => {
      const all = amount.trim().toLowerCase() === 'all' || amount.trim() === '';
      const res = await HotWallet.withdraw(destination, all ? 'all' : Number(amount), settings.solanaRpcUrl);
      if (!res.success || !res.signature) throw new Error(res.message || 'Withdrawal failed.');
      log('tx', `[BOT WALLET] ${res.message}`, { txSignature: res.signature });
      reset();
      await settle(res.signature, res.message || 'Withdrawal sent.');
    });

  /* ---------------------------------------------------------------- render */

  const usd = botWallet.solBalance !== null && solPriceUsd ? botWallet.solBalance * solPriceUsd : null;

  return (
    <div className="panel-2 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-white flex items-center gap-2">
            <KeyRound className="w-3.5 h-3.5 text-slate-500" />
            Bot wallet
            {address && (
              <span className={botWallet.unlocked ? 'chip chip-pos' : 'chip'}>
                {botWallet.unlocked ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                {botWallet.unlocked ? 'Unlocked' : 'Locked'}
              </span>
            )}
          </p>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-2xl">
            A separate Solana wallet the bot signs with, so entries and take-profits happen without a Phantom prompt.
            The key is encrypted with your password and stays in this browser. Keep only trading money in it.
          </p>
        </div>
      </div>

      {/* ---------------------------------------------- existing wallet */}
      {address && (
        <div className="mt-3.5 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-start">
          <div className="min-w-0">
            <p className="label">Deposit address</p>
            <div className="flex items-center gap-2">
              <code className="font-mono text-xs text-white break-all leading-relaxed">{address}</code>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <CopyButton value={address} label="Copy bot wallet address" />
              <a href={WalletService.accountUrl(address)} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost">
                <ExternalLink className="w-3 h-3" />
                Solscan
              </a>
            </div>
          </div>
          <div className="md:text-right">
            <p className="label">Balance</p>
            <p className="font-mono text-[15px] font-semibold text-white">
              {botWallet.solBalance === null ? '—' : `${botWallet.solBalance.toFixed(4)} SOL`}
            </p>
            {usd !== null && <p className="text-[11px] text-slate-500 font-mono">≈ ${usd.toFixed(2)}</p>}
          </div>
        </div>
      )}

      {/* ---------------------------------------------- locked */}
      {address && !botWallet.unlocked && mode === 'idle' && (
        <div className="mt-3.5 flex flex-col sm:flex-row gap-2">
          <div className="flex-1">
            <PasswordInput value={password} onChange={setPassword} placeholder="Password to unlock" onEnter={unlock} />
          </div>
          <button type="button" className="btn btn-primary" disabled={busy || !password} onClick={unlock}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
            Unlock
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => reset('remove')}>
            <Trash2 className="w-3.5 h-3.5" />
            Remove
          </button>
        </div>
      )}

      {/* ---------------------------------------------- unlocked actions */}
      {address && botWallet.unlocked && mode === 'idle' && (
        <div className="mt-3.5 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => reset('fund')}
            disabled={!phantomAddress}
            title={phantomAddress ? 'Send SOL from your connected wallet' : 'Connect Phantom or Solflare to fund from it'}
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
            Fund from wallet
          </button>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => reset('withdraw')}>
            <ArrowUpFromLine className="w-3.5 h-3.5" />
            Withdraw
          </button>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => reset('export')}>
            <KeyRound className="w-3.5 h-3.5" />
            Export key
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => HotWallet.lock()}>
            <Lock className="w-3.5 h-3.5" />
            Lock
          </button>
        </div>
      )}

      {/* ---------------------------------------------- no wallet yet */}
      {!address && mode === 'idle' && (
        <div className="mt-3.5 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => reset('create')}>
            <KeyRound className="w-4 h-4" />
            Create bot wallet
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => reset('import')}>
            Import private key
          </button>
        </div>
      )}

      {/* ---------------------------------------------- forms */}
      {mode === 'create' && (
        <div className="mt-3.5 space-y-2.5 max-w-md">
          <PasswordInput value={password} onChange={setPassword} placeholder={`Password (min ${MIN_PASSWORD_LENGTH} characters)`} autoFocus />
          <PasswordInput value={password2} onChange={setPassword2} placeholder="Repeat password" onEnter={create} />
          <p className="text-[11px] text-slate-500 leading-relaxed">
            There is no password reset. Clearing this site&apos;s data deletes the key - export a backup after creating it.
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={create}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Create
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => reset()}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'import' && (
        <div className="mt-3.5 space-y-2.5 max-w-md">
          <textarea
            className="field font-mono text-xs min-h-[72px]"
            value={secretInput}
            autoFocus
            spellCheck={false}
            placeholder="Private key (base58 from Phantom, or a [..] byte array)"
            onChange={(e) => setSecretInput(e.target.value)}
          />
          <PasswordInput value={password} onChange={setPassword} placeholder={`New password (min ${MIN_PASSWORD_LENGTH} characters)`} onEnter={importKey} />
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Use a dedicated trading account, never your main wallet. The key is encrypted before it is stored.
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" disabled={busy || !secretInput.trim()} onClick={importKey}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Import
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => reset()}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'fund' && (
        <div className="mt-3.5 space-y-2.5 max-w-md">
          <p className="text-xs text-slate-400">
            From {settings.walletType === 'solflare' ? 'Solflare' : 'Phantom'}{' '}
            <span className="font-mono text-slate-300">
              {phantomAddress?.slice(0, 4)}…{phantomAddress?.slice(-4)}
            </span>{' '}
            ({settings.solBalance.toFixed(4)} SOL). Your wallet will ask you to approve.
          </p>
          <input
            type="number"
            min={0}
            step={0.01}
            className="field font-mono"
            value={amount}
            autoFocus
            placeholder="Amount in SOL"
            onChange={(e) => setAmount(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" disabled={busy || !amount} onClick={fund}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Send to bot wallet
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => reset()}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'withdraw' && (
        <div className="mt-3.5 space-y-2.5 max-w-md">
          <input
            type="text"
            className="field font-mono text-xs"
            value={destination}
            autoFocus
            spellCheck={false}
            placeholder="Destination address"
            onChange={(e) => setDestination(e.target.value)}
          />
          <input
            type="text"
            inputMode="decimal"
            className="field font-mono"
            value={amount}
            placeholder="Amount in SOL (empty = everything)"
            onChange={(e) => setAmount(e.target.value)}
          />
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Sends SOL only. Sell open positions first if you want their value back as SOL.
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" disabled={busy || !destination.trim()} onClick={withdraw}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Withdraw
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => reset()}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'export' && (
        <div className="mt-3.5 space-y-2.5 max-w-md">
          {exported ? (
            <>
              <p className="text-xs text-warn flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                Anyone with this key controls the wallet. Store it offline; never paste it into a website or chat.
              </p>
              <div className="flex items-start gap-2">
                <code className="field font-mono text-xs break-all flex-1">
                  {showExported ? exported : '•'.repeat(44)}
                </code>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => setShowExported((v) => !v)}
                  aria-label={showExported ? 'Hide key' : 'Show key'}
                >
                  {showExported ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
                <CopyButton value={exported} label="Copy private key" compact />
              </div>
              <p className="text-[11px] text-slate-500">Phantom: Add account &rarr; Import private key accepts this string.</p>
              <button type="button" className="btn btn-ghost" onClick={() => reset()}>
                Done
              </button>
            </>
          ) : (
            <>
              <PasswordInput value={password} onChange={setPassword} placeholder="Password" autoFocus onEnter={exportKey} />
              <div className="flex gap-2">
                <button type="button" className="btn btn-primary" disabled={busy || !password} onClick={exportKey}>
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Reveal key
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => reset()}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {mode === 'remove' && (
        <div className="mt-3.5 space-y-2.5 max-w-md">
          <p className="text-xs text-neg flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            Removes the key from this browser. Funds stay on-chain but are lost unless you exported the key. Withdraw first.
          </p>
          <PasswordInput value={password} onChange={setPassword} placeholder="Password to confirm" autoFocus onEnter={remove} />
          <div className="flex gap-2">
            <button type="button" className="btn btn-danger" disabled={busy || !password} onClick={remove}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Remove wallet
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => reset()}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-neg mt-3">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          {error}
        </p>
      )}
      {notice && (
        <p className="text-xs text-slate-300 mt-3 break-words">
          {notice.text}{' '}
          {notice.signature && (
            <a className="text-signal hover:underline" href={WalletService.explorerUrl(notice.signature)} target="_blank" rel="noreferrer">
              View transaction
            </a>
          )}
        </p>
      )}
    </div>
  );
};
