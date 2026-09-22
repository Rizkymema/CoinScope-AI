'use client';

import { useEffect, useState } from 'react';
import { Activity, Bot, Globe, Key, TrendingUp, Wallet, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

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

type Tab = 'trending' | 'new' | 'bot';

const TABS: { id: Tab; label: string; icon: typeof TrendingUp }[] = [
  { id: 'trending', label: 'Market', icon: TrendingUp },
  { id: 'new', label: 'New Launches', icon: Globe },
  { id: 'bot', label: 'Bot', icon: Bot },
];

export default function DashboardPage() {
  const [activeFilter, setActiveFilter] = useState<FilterType>('trending');
  const [activeTab, setActiveTab] = useState<Tab>('trending');
  const [isLoginOpen, setIsLoginOpen] = useState(false);

  const { selectedCoin, isAiLoading } = useCoinStore();
  const { isBotActive, isWsConnected, solPriceUsd, toast, clearToast, positionsCount, settings } = useBotStore(
    useShallow((s) => ({
      isBotActive: s.isActive,
      isWsConnected: s.isWsConnected,
      solPriceUsd: s.solPriceUsd,
      toast: s.latestToastNotification,
      clearToast: s.clearToast,
      positionsCount: s.positions.length,
      settings: s.settings,
    }))
  );

  // Hydrate the persisted store on the client only, then start streams and wallet reconnect.
  useEffect(() => {
    Promise.resolve(useBotStore.persist.rehydrate()).then(() => useBotStore.getState().boot());
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(clearToast, 6000);
    return () => clearTimeout(timer);
  }, [toast, clearToast]);

  const walletLabel =
    settings.phantomWalletConnected && settings.connectedWalletAddress
      ? `${settings.connectedWalletAddress.slice(0, 4)}…${settings.connectedWalletAddress.slice(-4)}`
      : null;

  const toastTone =
    toast?.type === 'error' ? 'neg' : toast?.type === 'sell_sl' ? 'warn' : toast?.type === 'buy' ? 'accent' : 'pos';

  return (
    <div className="min-h-screen app-bg text-slate-200">
      <LoginModal isOpen={isLoginOpen} onClose={() => setIsLoginOpen(false)} />

      {/* ---------------------------------------------------------------- header */}
      <header className="sticky top-0 z-40 bg-ink-950/95 border-b border-line">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <span className="grid place-items-center w-7 h-7 rounded-md bg-signal/12 border border-signal/25">
              <Activity className="w-4 h-4 text-signal" />
            </span>
            <span className="font-bold tracking-tight text-[15px] text-white hidden sm:block">CoinScope</span>
          </div>

          <nav className="tabbar" aria-label="Sections">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                data-active={activeTab === id}
                aria-current={activeTab === id ? 'page' : undefined}
                className="tab"
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{label}</span>
                {id === 'bot' && positionsCount > 0 && (
                  <span className="ml-0.5 px-1.5 rounded-[5px] bg-signal/15 text-signal text-[10px] font-bold">
                    {positionsCount}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {solPriceUsd > 0 && (
              <span className="hidden md:flex items-baseline gap-1.5 text-xs">
                <span className="text-slate-500">SOL</span>
                <span className="font-semibold text-slate-200 font-mono">${solPriceUsd.toFixed(2)}</span>
              </span>
            )}

            <span
              className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400"
              title={isWsConnected ? 'Launch stream connected' : 'Launch stream reconnecting'}
            >
              <span className={`dot ${isWsConnected ? 'dot-live' : 'dot-idle'}`} />
              {isBotActive ? 'Bot running' : isWsConnected ? 'Streaming' : 'Offline'}
            </span>

            <button type="button" onClick={() => setIsLoginOpen(true)} className="btn btn-secondary">
              {walletLabel ? (
                <>
                  <Wallet className="w-3.5 h-3.5 text-signal" />
                  <span className="font-mono">{walletLabel}</span>
                </>
              ) : (
                <>
                  <Key className="w-3.5 h-3.5" />
                  <span>Connect</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <LiveMarketTicker />

      {/* ---------------------------------------------------------------- content */}
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {activeTab !== 'bot' && (
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="min-w-0">
              <h1 className="text-[15px] font-bold text-white leading-tight">
                {activeTab === 'trending' ? 'Market overview' : 'New launches'}
              </h1>
              <p className="text-[13px] text-slate-400 mt-0.5">
                {activeTab === 'trending'
                  ? 'Most active tokens across Solana and EVM pools, refreshed continuously.'
                  : 'Pump.fun mints and fresh DEX pools, newest first.'}
              </p>
            </div>
            <div className="lg:ml-auto w-full lg:w-[420px]">
              <SearchPanel />
            </div>
          </div>
        )}

        {activeTab === 'trending' && (
          <>
            <FeaturedCoinsCarousel />

            {(selectedCoin || isAiLoading) && (
              <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr] items-start">
                <CoinScoreCard />
                <InsightsPanel />
              </div>
            )}

            <FilterTabs onFilterChange={setActiveFilter} activeFilter={activeFilter} />
            <TrendingCoinsGrid activeFilter={activeFilter} />
          </>
        )}

        {activeTab === 'new' && (
          <>
            {(selectedCoin || isAiLoading) && (
              <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr] items-start">
                <CoinScoreCard />
                <InsightsPanel />
              </div>
            )}
            <NewCoinsLiveFeed />
          </>
        )}

        {activeTab === 'bot' && <AutoBotDashboard />}
      </main>

      <AIJudgeChat />

      {/* ---------------------------------------------------------------- toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-4 z-50 w-[min(24rem,calc(100vw-2rem))] panel p-3.5 pr-10 animate-fade-up"
        >
          <div className="flex items-start gap-2.5">
            <span
              className={`mt-0.5 shrink-0 w-1 self-stretch rounded-full ${
                toastTone === 'neg' ? 'bg-neg' : toastTone === 'warn' ? 'bg-warn' : toastTone === 'accent' ? 'bg-signal' : 'bg-pos'
              }`}
            />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-white">{toast.title}</p>
              <p className="text-xs text-slate-400 mt-0.5 break-words">{toast.description}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={clearToast}
            aria-label="Dismiss notification"
            className="absolute top-2.5 right-2.5 p-1 rounded-md text-slate-500 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ---------------------------------------------------------------- footer */}
      <footer className="border-t border-line mt-10">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>Data: PumpPortal · GeckoTerminal · DexScreener — Routing: Jupiter · PumpPortal</span>
          <span>Speculative assets. Most new tokens go to zero.</span>
        </div>
      </footer>
    </div>
  );
}
