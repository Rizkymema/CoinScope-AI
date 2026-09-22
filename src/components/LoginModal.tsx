'use client';

import React, { useState } from 'react';
import {
  Activity,
  ShieldCheck,
  Zap,
  Key,
  Wallet,
  Globe,
  Bot,
  CheckCircle2,
  Lock,
  ArrowRight,
  Sparkles,
  ChevronRight,
  Eye,
  EyeOff,
  Radio,
} from 'lucide-react';
import { useBotStore } from '@/store/useBotStore';
import { useShallow } from 'zustand/react/shallow';
import { BridgeService } from '@/services/bridge.service';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccessLogin?: () => void;
}

export function LoginModal({ isOpen, onClose, onSuccessLogin }: LoginModalProps) {
  const [activeTab, setActiveTab] = useState<'phantom' | 'accessKey' | 'guest'>('phantom');
  const [accessKey, setAccessKey] = useState(() => (typeof window !== 'undefined' ? BridgeService.getAccessKey() : ''));
  const [showKey, setShowKey] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const { connectWallet, settings } = useBotStore(
    useShallow((s) => ({
      connectWallet: s.connectWallet,
      settings: s.settings,
    }))
  );

  if (!isOpen) return null;

  // Handle Phantom Wallet Connection
  const handlePhantomConnect = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await connectWallet();
      const after = useBotStore.getState().settings;
      if (!after.phantomWalletConnected) {
        setErrorMessage('Wallet connection failed. Make sure Phantom or Solflare is installed and unlocked.');
        return;
      }
      setSuccessMessage(`${after.walletType === 'solflare' ? 'Solflare' : 'Phantom'} wallet connected!`);
      setTimeout(() => {
        onSuccessLogin?.();
        onClose();
      }, 900);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to connect Phantom wallet. Make sure Phantom extension is installed.');
    } finally {
      setIsLoading(false);
    }
  };

  // Access key for the MCP bridge (must equal COINSCOPE_ACCESS_KEY on the server)
  const handleKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    const key = accessKey.trim();
    const test = await BridgeService.testKey(key);
    if (!test.ok) {
      setErrorMessage(test.message);
      setIsLoading(false);
      return;
    }
    BridgeService.setAccessKey(key);
    setSuccessMessage(`${test.message} External AI clients can now control this dashboard via MCP.`);
    setIsLoading(false);
    setTimeout(() => {
      onSuccessLogin?.();
      onClose();
    }, 1200);
  };

  // Handle Quick Guest Direct Entry
  const handleGuestEntry = () => {
    setIsLoading(true);
    setSuccessMessage('Guest Session Verified! Welcome to CoinScopeAI.');
    setTimeout(() => {
      onSuccessLogin?.();
      onClose();
      setIsLoading(false);
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-ink-950/85 backdrop-blur-2xl animate-brand-in">
      {/* Background Ambient Glow Halos */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] rounded-full bg-gradient-to-tr from-teal-500/15 via-amber-400/10 to-emerald-500/15 blur-[120px]" />

      {/* Main Glassmorphic Container */}
      <div className="relative w-full max-w-xl bg-ink-900/90 border border-white/12 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-teal-500/10 overflow-hidden">
        {/* Glow Accent Top Line */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-teal-400 to-amber-400" />

        {/* Modal Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-signal/15 border border-signal/30 p-2.5 rounded-2xl shadow-lg shadow-teal-500/10">
              <Activity className="w-6 h-6 text-signal-soft" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display font-extrabold text-white text-2xl tracking-tight">
                  CoinScope<span className="text-signal-soft">AI</span>
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-500/15 text-teal-300 border border-teal-500/30 tracking-wider">
                  V2.4 LIVE
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Terminal Login & DEX Wallet Authentication
              </p>
            </div>
          </div>
        </div>

        {/* Real-time DEX Status Pill Bar */}
        <div className="mb-6 grid grid-cols-3 gap-2 bg-ink-950/70 border border-white/6 p-2 rounded-2xl text-[11px] font-medium">
          <div className="flex items-center justify-center gap-1.5 text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span>Solana Mainnet</span>
          </div>
          <div className="flex items-center justify-center gap-1.5 text-amber-400 border-x border-white/8">
            <Radio className="w-3 h-3 text-amber-400 animate-pulse" />
            <span>Jupiter V6 API</span>
          </div>
          <div className="flex items-center justify-center gap-1.5 text-teal-300">
            <Bot className="w-3 h-3 text-teal-300" />
            <span>AI Bot Engine</span>
          </div>
        </div>

        {/* Auth Method Navigation Tabs */}
        <div className="flex items-center bg-ink-950/80 border border-white/8 rounded-2xl p-1 mb-6 gap-1">
          <button
            onClick={() => setActiveTab('phantom')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'phantom'
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-600/25 border border-purple-400/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Wallet className="w-4 h-4" />
            Phantom Wallet
          </button>
          <button
            onClick={() => setActiveTab('accessKey')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'accessKey'
                ? 'bg-gradient-to-r from-amber-500 to-teal-500 text-ink-950 shadow-lg shadow-teal-500/20 font-extrabold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Key className="w-4 h-4" />
            MCP Access Key
          </button>
          <button
            onClick={() => setActiveTab('guest')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'guest'
                ? 'bg-white/10 text-white border border-white/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Globe className="w-4 h-4" />
            Quick Guest
          </button>
        </div>

        {/* Feedback Messages */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2 animate-fade-up">
            <Lock className="w-4 h-4 flex-shrink-0 text-rose-400" />
            <span>{errorMessage}</span>
          </div>
        )}
        {successMessage && (
          <div className="mb-4 p-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2 animate-fade-up">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* TAB 1: Phantom Web3 Connect */}
        {activeTab === 'phantom' && (
          <div className="space-y-5 animate-fade-up">
            <div className="bg-gradient-to-b from-purple-950/30 to-indigo-950/20 border border-purple-500/20 rounded-2xl p-5 text-center">
              <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center shadow-xl shadow-purple-600/30">
                <Wallet className="w-7 h-7 text-white" />
              </div>
              <h3 className="font-bold text-white text-base mb-1">
                Connect Phantom Web3 Wallet
              </h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                Connect your browser extension wallet for non-custodial live DEX trading & 1-click token execution.
              </p>

              {settings.phantomWalletConnected ? (
                <div className="mt-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-left flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider block">Connected Address</span>
                    <span className="font-mono text-xs text-white font-bold">
                      {settings.connectedWalletAddress?.slice(0, 6)}...{settings.connectedWalletAddress?.slice(-6)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 block">Balance</span>
                    <span className="font-mono text-xs text-emerald-400 font-bold">
                      {settings.solBalance.toFixed(3)} SOL
                    </span>
                  </div>
                </div>
              ) : null}
            </div>

            <button
              onClick={handlePhantomConnect}
              disabled={isLoading}
              className="w-full relative group overflow-hidden py-3.5 px-6 rounded-2xl font-extrabold text-sm text-white bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:from-purple-500 hover:to-indigo-500 shadow-xl shadow-purple-600/30 hover:shadow-purple-500/50 transition-all flex items-center justify-center gap-2 active:scale-[0.99]"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-purple-200 animate-pulse" />
                  <span>Connect Phantom Wallet</span>
                  <ArrowRight className="w-4 h-4 text-white group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </div>
        )}

        {/* TAB 2: Secret Access Key */}
        {activeTab === 'accessKey' && (
          <form onSubmit={handleKeySubmit} className="space-y-4 animate-fade-up">
            <div className="bg-ink-950/70 border border-white/8 rounded-2xl p-4">
              <label className="block text-xs font-bold text-slate-300 mb-2">
                Access key (MCP bridge) - same value as COINSCOPE_ACCESS_KEY on the server
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={accessKey}
                  onChange={(e) => setAccessKey(e.target.value)}
                  placeholder="Paste COINSCOPE_ACCESS_KEY"
                  className="w-full bg-ink-900 border border-white/12 focus:border-teal-400 rounded-xl py-3 px-4 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/20 font-mono transition-all"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <p className="mt-2 text-[11px] text-slate-500">
                Lets Claude Desktop, Cursor, Claude Code or any MCP client read this dashboard and drive the bot through <code>/api/mcp</code>. Leave empty if the server has no key.
              </p>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 px-6 rounded-2xl font-extrabold text-sm text-ink-950 bg-gradient-to-r from-teal-400 via-emerald-400 to-amber-400 hover:brightness-110 shadow-xl shadow-teal-500/20 transition-all flex items-center justify-center gap-2 active:scale-[0.99]"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-ink-950/30 border-t-ink-950 rounded-full animate-spin" />
              ) : (
                <>
                  <Key className="w-4 h-4" />
                  <span>Save access key & connect bridge</span>
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* TAB 3: Quick Guest Terminal */}
        {activeTab === 'guest' && (
          <div className="space-y-5 animate-fade-up">
            <div className="bg-ink-950/70 border border-white/8 rounded-2xl p-5 text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center">
                <Globe className="w-6 h-6 text-teal-300" />
              </div>
              <h3 className="font-bold text-white text-base mb-1">
                Explore as Guest Trader
              </h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                Direct access to real-time DEX pair feeds, AI scorecards, and paper trading simulations.
              </p>
            </div>

            <button
              onClick={handleGuestEntry}
              disabled={isLoading}
              className="w-full py-3.5 px-6 rounded-2xl font-extrabold text-sm text-white bg-slate-800 hover:bg-slate-700 border border-white/15 transition-all flex items-center justify-center gap-2 active:scale-[0.99]"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>Enter Live Dashboard</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        )}

        {/* Security & Non-Custodial Footer */}
        <div className="mt-6 pt-5 border-t border-white/8 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-500 gap-2">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>256-Bit Encrypted Web3 RPC Connection</span>
          </div>
          <div className="flex items-center gap-1">
            <Lock className="w-3 h-3 text-slate-400" />
            <span>Non-Custodial Terminal</span>
          </div>
        </div>
      </div>
    </div>
  );
}
