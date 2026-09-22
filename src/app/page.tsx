'use client';

import { SearchPanel } from '@/components/SearchPanel';
import { CoinScoreCard } from '@/components/CoinScoreCard';
import { InsightsPanel } from '@/components/InsightsPanel';
import { AIJudgeChat } from '@/components/AIJudgeChat';
import { TrendingCoinsGrid } from '@/components/TrendingCoinsGrid';
import { FeaturedCoinsCarousel } from '@/components/FeaturedCoinsCarousel';
import { FilterTabs, FilterType } from '@/components/FilterTabs';
import { NewCoinsLiveFeed } from '@/components/NewCoinsLiveFeed';
import { LiveMarketTicker } from '@/components/LiveMarketTicker';
import { AutoBotDashboard } from '@/components/AutoBotDashboard';
import { LoginModal } from '@/components/LoginModal';
import { useCoinStore } from '@/store/useCoinStore';
import { useBotStore } from '@/store/useBotStore';
import { useShallow } from 'zustand/react/shallow';
import { Activity, Loader2, Zap, Globe, Bot, X, Key, CheckCircle2 } from 'lucide-react';
import { useState, useEffect } from 'react';

export default function DashboardPage() {
  const [activeFilter, setActiveFilter] = useState<FilterType>('trending');
  const [isAppReady, setIsAppReady] = useState(false);
  const [activeTab, setActiveTab] = useState<'trending' | 'new' | 'bot'>('trending');
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [initProgress, setInitProgress] = useState(25);

  const { selectedCoin, isAiLoading } = useCoinStore();
  const { isBotActive, latestToastNotification, clearToast, positionsCount, settings } = useBotStore(
    useShallow((s) => ({
      isBotActive: s.isActive,
      latestToastNotification: s.latestToastNotification,
      clearToast: s.clearToast,
      positionsCount: s.positions.length,
      settings: s.settings,
    }))
  );

  // Hydrate the persisted bot store on the client only (avoids SSR hydration mismatches),
  // then start the price monitor / wallet auto-reconnect.
  useEffect(() => {
    Promise.resolve(useBotStore.persist.rehydrate()).then(() => useBotStore.getState().boot());
  }, []);

  useEffect(() => {
    const t1 = setTimeout(() => setInitProgress(65), 300);
    const t2 = setTimeout(() => setInitProgress(90), 600);
    const t3 = setTimeout(() => {
      setInitProgress(100);
      setIsAppReady(true);
    }, 900);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  // Auto hide toast after 6 seconds
  useEffect(() => {
    if (latestToastNotification) {
      const timer = setTimeout(() => {
        clearToast();
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [latestToastNotification, clearToast]);

  const handleFilterChange = (filter: FilterType) => {
    setActiveFilter(filter);
  };

  if (!isAppReady) {
    return (
      <div className="min-h-screen gradient-mesh flex flex-col items-center justify-center p-6 relative overflow-hidden">
        {/* Glowing Background Halos */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-gradient-to-tr from-teal-500/20 via-amber-400/15 to-emerald-500/20 blur-[130px]" />

        <div className="relative z-10 animate-brand-in flex flex-col items-center max-w-md w-full bg-ink-900/85 border border-white/12 rounded-3xl p-8 shadow-2xl backdrop-blur-2xl text-center">
          {/* Top Brand Logo */}
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-signal/20 border border-signal/40 p-3.5 rounded-2xl shadow-xl shadow-teal-500/20 animate-pulse">
              <Activity className="w-8 h-8 text-signal-soft" />
            </div>
            <div className="text-left">
              <span className="font-display font-extrabold tracking-tight text-white text-3xl block">
                CoinScope<span className="text-signal-soft">AI</span>
              </span>
              <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-teal-400">
                Institutional DEX Engine
              </span>
            </div>
          </div>

          {/* Progress Indicator */}
          <div className="w-full bg-ink-950 border border-white/10 rounded-full h-2.5 mb-4 overflow-hidden p-0.5">
            <div
              className="bg-gradient-to-r from-teal-400 via-amber-400 to-emerald-400 h-full rounded-full transition-all duration-300 ease-out"
              style={{ width: `${initProgress}%` }}
            />
          </div>

          <div className="flex items-center gap-2 mb-4 text-xs font-semibold text-teal-300">
            <Loader2 className="w-4 h-4 animate-spin text-teal-400" />
            <span>Loading bot engine & market streams... {initProgress}%</span>
          </div>

          {/* Initialization Checklist */}
          <div className="w-full space-y-2 text-left bg-ink-950/60 border border-white/5 rounded-2xl p-3.5 text-[11px] text-slate-400 font-mono">
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>PumpPortal stream + GeckoTerminal / DexScreener feeds</span>
            </div>
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>PumpPortal + Jupiter swap routing (wallet-signed)</span>
            </div>
            <div className="flex items-center gap-2 text-amber-300">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Claude AI gate & copilot (needs ANTHROPIC_API_KEY)</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-200 selection:bg-signal/30 font-sans gradient-mesh relative">
      {/* FLOATING BOT TOAST NOTIFICATION */}
      {latestToastNotification && (
        <div
          className={`fixed top-20 right-4 z-50 animate-bounce-subtle max-w-sm w-full bg-ink-900/95 backdrop-blur-xl rounded-2xl p-4 shadow-2xl flex items-start justify-between gap-3 border ${
            latestToastNotification.type === 'error'
              ? 'border-rose-500/40 shadow-rose-500/10'
              : latestToastNotification.type === 'sell_sl'
              ? 'border-amber-500/40 shadow-amber-500/10'
              : 'border-emerald-500/40 shadow-emerald-500/10'
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`p-2 rounded-xl border ${
                latestToastNotification.type === 'error'
                  ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                  : latestToastNotification.type === 'sell_sl'
                  ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                  : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
              }`}
            >
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-white text-sm">{latestToastNotification.title}</h4>
              <p className="text-xs text-slate-300 mt-0.5">{latestToastNotification.description}</p>
            </div>
          </div>
          <button
            onClick={clearToast}
            className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <LiveMarketTicker />

      {/* LOGIN MODAL */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
      />

      <header className="sticky top-0 z-40 bg-ink-950/75 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="bg-signal/15 border border-signal/25 p-1.5 rounded-xl">
              <Activity className="w-5 h-5 text-signal-soft" />
            </div>
            <span className="font-display font-bold tracking-tight text-white text-lg">
              CoinScope<span className="text-signal-soft">AI</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center bg-ink-850/80 border border-white/8 rounded-xl p-1 gap-1">
              <button
                onClick={() => setActiveTab('trending')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'trending'
                    ? 'bg-signal text-ink-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                Trending
              </button>
              <button
                onClick={() => setActiveTab('new')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'new'
                    ? 'bg-amber-400 text-ink-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                New Coins
              </button>
              <button
                onClick={() => setActiveTab('bot')}
                className={`relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'bot'
                    ? 'bg-emerald-400 text-ink-950 shadow-lg shadow-emerald-400/20 font-bold'
                    : 'text-emerald-400 hover:bg-emerald-500/10'
                }`}
              >
                <Bot className="w-3.5 h-3.5" />
                Auto Bot
                {isBotActive && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                )}
                {positionsCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-ink-950 text-emerald-400 font-mono">
                    {positionsCount}
                  </span>
                )}
              </button>
            </div>

            {/* LOGIN / WALLET CONNECT BUTTON */}
            <button
              onClick={() => setIsLoginModalOpen(true)}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl font-bold text-xs bg-gradient-to-r from-teal-500/20 via-emerald-500/20 to-amber-500/20 hover:from-teal-500/30 hover:to-amber-500/30 border border-teal-500/35 text-white shadow-lg shadow-teal-500/10 transition-all active:scale-95"
            >
              {settings.phantomWalletConnected ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  <span className="font-mono text-emerald-300">
                    {settings.connectedWalletAddress?.slice(0, 4)}...{settings.connectedWalletAddress?.slice(-4)}
                  </span>
                </>
              ) : (
                <>
                  <Key className="w-3.5 h-3.5 text-teal-300" />
                  <span className="text-teal-200">Login / Connect Wallet</span>
                </>
              )}
            </button>

            <div className="flex items-center bg-ink-850/80 border border-white/8 rounded-xl px-3 py-1.5">
              <span className="relative flex h-2 w-2 mr-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-xs font-medium text-slate-400">Live</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12">
        <section className="relative flex flex-col items-center justify-center pt-10 pb-6 min-h-[38vh]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-full overflow-hidden">
            <div className="absolute left-1/2 top-8 h-56 w-[min(720px,90vw)] -translate-x-1/2 rounded-full bg-signal/10 blur-3xl animate-soft-pulse" />
          </div>

          <div className="relative z-10 animate-brand-in text-center">
            <h1 className="font-display text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white mb-3">
              CoinScope<span className="text-signal-soft">AI</span>
            </h1>
            <div className="mx-auto mb-5 h-px w-24 bg-gradient-to-r from-transparent via-signal to-transparent animate-line-draw" />
            <p className="text-slate-400 text-center max-w-xl mx-auto mb-8 leading-relaxed text-base md:text-lg">
              Real-time DEX intelligence & AI-powered Auto-Snipe Bot for newly published tokens.
            </p>
            <SearchPanel />
          </div>
        </section>

        {/* Mobile Navigation Tabs */}
        <div className="md:hidden flex items-center gap-1.5 bg-ink-850/80 border border-white/8 rounded-xl p-1.5">
          <button
            onClick={() => setActiveTab('trending')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'trending'
                ? 'bg-signal text-ink-950'
                : 'text-slate-400'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            Trending
          </button>
          <button
            onClick={() => setActiveTab('new')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'new'
                ? 'bg-amber-400 text-ink-950'
                : 'text-slate-400'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            New Coins
          </button>
          <button
            onClick={() => setActiveTab('bot')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'bot'
                ? 'bg-emerald-400 text-ink-950 font-bold'
                : 'text-emerald-400'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            Auto Bot
          </button>
        </div>

        {activeTab === 'trending' ? (
          <>
            <FeaturedCoinsCarousel />

            {(selectedCoin || isAiLoading) && (
              <>
                <section className="mb-8 animate-fade-up">
                  <CoinScoreCard />
                </section>
                <section className="mb-8 animate-fade-up">
                  <InsightsPanel />
                </section>
              </>
            )}

            <section>
              <FilterTabs onFilterChange={handleFilterChange} activeFilter={activeFilter} />
            </section>

            <section>
              <TrendingCoinsGrid activeFilter={activeFilter} />
            </section>
          </>
        ) : activeTab === 'new' ? (
          <>
            {(selectedCoin || isAiLoading) && (
              <>
                <section className="mb-8 animate-fade-up">
                  <CoinScoreCard />
                </section>
                <section className="mb-8 animate-fade-up">
                  <InsightsPanel />
                </section>
              </>
            )}

            <section>
              <NewCoinsLiveFeed />
            </section>
          </>
        ) : (
          <section>
            <AutoBotDashboard />
          </section>
        )}
      </main>

      <AIJudgeChat />

      <footer className="border-t border-white/5 mt-16">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="bg-signal/15 border border-signal/25 p-1 rounded-lg">
                <Activity className="w-3.5 h-3.5 text-signal-soft" />
              </div>
              <span className="text-sm font-display font-semibold text-slate-400">
                CoinScope<span className="text-signal-soft">AI</span>
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-600">
              <span>Data: PumpPortal · GeckoTerminal · DexScreener</span>
              <span className="hidden sm:inline">·</span>
              <span>Swaps: PumpPortal · Jupiter</span>
              <span className="hidden sm:inline">·</span>
              <span className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${isBotActive ? 'bg-emerald-500' : 'bg-slate-500'}`}></span>
                Bot {isBotActive ? 'running' : 'idle'}
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
