'use client';

import { useEffect, useState } from 'react';
import { Activity, Bot, Globe, Key, SlidersHorizontal, TrendingUp, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { SearchPanel } from '@/components/SearchPanel';
import { TokenDetail } from '@/components/TokenDetail';
import { AIJudgeChat } from '@/components/AIJudgeChat';
import { TrendingCoinsGrid } from '@/components/TrendingCoinsGrid';
import { FeaturedCoinsCarousel } from '@/components/FeaturedCoinsCarousel';
import { FilterTabs, FilterType } from '@/components/FilterTabs';
import { NewCoinsLiveFeed } from '@/components/NewCoinsLiveFeed';
import { LiveMarketTicker } from '@/components/LiveMarketTicker';
import { AutoTradePage } from '@/components/AutoTradePage';
import { BotSettingsPanel } from '@/components/bot/BotSettingsPanel';
import { useScannerStore } from '@/store/useScannerStore';
import { LoginModal } from '@/components/LoginModal';
import { useBotStore } from '@/store/useBotStore';
import { useKeepAlive } from '@/hooks/useKeepAlive';

type Tab = 'trending' | 'new' | 'auto' | 'settings';

const TABS: { id: Tab; label: string; icon: typeof TrendingUp }[] = [
  { id: 'trending', label: 'Market', icon: TrendingUp },
  { id: 'new', label: 'New Launches', icon: Globe },
  { id: 'auto', label: 'Auto Trade', icon: Bot },
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
];

export default function DashboardPage() {
  const [activeFilter, setActiveFilter] = useState<FilterType>('trending');
  const [activeTab, setActiveTab] = useState<Tab>('trending');

  const {
    isSniperActive,
    isWsConnected,
    solPriceUsd,
    toast,
    clearToast,
    positionsCount,
    hasLivePositions,
    settings,
    isLoginOpen,
    setWalletDialogOpen,
  } = useBotStore(
    useShallow((s) => ({
      isSniperActive: s.isActive,
      isWsConnected: s.isWsConnected,
      solPriceUsd: s.solPriceUsd,
      toast: s.latestToastNotification,
      clearToast: s.clearToast,
      positionsCount: s.positions.length,
      hasLivePositions: s.positions.some((p) => p.isLive),
      settings: s.settings,
      isLoginOpen: s.walletDialogOpen,
      setWalletDialogOpen: s.setWalletDialogOpen,
    }))
  );
  const setIsLoginOpen = setWalletDialogOpen;
  const readyCount = useScannerStore((s) => s.readyIds.length);
  const autoTradeOn = settings.scannerAutoBuy;

  // Entries and exits run in this tab: keep it awake (screen, and an inaudible tone so the browser
  // does not throttle or freeze it when hidden) and warn before closing it.
  useKeepAlive(isSniperActive || hasLivePositions || autoTradeOn);

  // Hydrate the persisted store on the client only, then start streams and wallet reconnect.
  useEffect(() => {
    Promise.resolve(useBotStore.persist.rehydrate()).then(() => {
      useBotStore.getState().boot();
      // The scanner reads buy size and fees from the bot settings, so it starts after they load.
      useScannerStore.getState().init();
    });
  }, []);

  // Other pages can ask for a tab (e.g. "Wallet & mode settings" on the Auto Trade page).
  useEffect(() => {
    const onTab = (e: Event) => {
      const tab = (e as CustomEvent<Tab>).detail;
      if (TABS.some((t) => t.id === tab)) {
        setActiveTab(tab);
        window.scrollTo({ top: 0 });
      }
    };
    window.addEventListener('coinscope:tab', onTab);
    return () => window.removeEventListener('coinscope:tab', onTab);
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
  const walletName = settings.walletType === 'solflare' ? 'Solflare' : 'Phantom';

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
                {id === 'auto' && positionsCount > 0 && (
                  <span className="ml-0.5 px-1.5 rounded-[5px] bg-signal/15 text-signal text-[10px] font-bold" title={`${positionsCount} open position(s)`}>
                    {positionsCount}
                  </span>
                )}
                {id === 'auto' && readyCount > 0 && (
                  <span className="ml-0.5 px-1.5 rounded-[5px] bg-pos/15 text-pos text-[10px] font-bold" title={`${readyCount} setup(s) ready`}>
                    {readyCount}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {solPriceUsd > 0 && (
              <span className="hidden md:flex items-baseline gap-1.5 text-xs" title="Price of 1 SOL in US dollars">
                <span className="text-slate-500">SOL</span>
                <span className="font-semibold text-slate-200 font-mono">${solPriceUsd.toFixed(2)}</span>
              </span>
            )}

            <span
              className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400"
              title={autoTradeOn ? 'Auto trade is buying confirmed signals' : isWsConnected ? 'Launch stream connected' : 'Launch stream reconnecting'}
            >
              <span className={`dot ${autoTradeOn || isSniperActive ? 'dot-live' : isWsConnected ? 'dot-live' : 'dot-idle'}`} />
              {autoTradeOn ? 'Auto trade on' : isSniperActive ? 'Sniper running' : isWsConnected ? 'Streaming' : 'Offline'}
            </span>

            <button
              type="button"
              onClick={() => setIsLoginOpen(true)}
              className="btn btn-secondary"
              title={walletLabel ? `${walletName} connected: ${settings.connectedWalletAddress}` : 'Connect a wallet'}
            >
              {walletLabel ? (
                <>
                  <span className="dot dot-live" />
                  <span className="hidden lg:inline text-slate-400">{walletName}</span>
                  <span className="font-mono">{walletLabel}</span>
                  <span className="hidden md:inline font-mono text-slate-400">· {settings.solBalance.toFixed(2)} SOL</span>
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
        {(activeTab === 'trending' || activeTab === 'new') && (
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="min-w-0">
              <h1 className="text-[15px] font-bold text-white leading-tight">
                {activeTab === 'trending' ? 'Market overview' : 'New launches'}
              </h1>
              <p className="text-[13px] text-slate-400 mt-0.5">
                {activeTab === 'trending'
                  ? 'Most active tokens across Solana and EVM pools, refreshed continuously. Click a token for its chart, trades and safety check.'
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

            <TokenDetail />

            <FilterTabs onFilterChange={setActiveFilter} activeFilter={activeFilter} />
            <TrendingCoinsGrid activeFilter={activeFilter} />
          </>
        )}

        {activeTab === 'new' && (
          <>
            <TokenDetail />
            <NewCoinsLiveFeed />
          </>
        )}

        {activeTab === 'auto' && <AutoTradePage />}

        {activeTab === 'settings' && (
          <>
            <div>
              <h1 className="text-[15px] font-bold text-white leading-tight">Settings</h1>
              <p className="text-[13px] text-slate-400 mt-0.5">Money and wallets, sizing and risk, the Claude model, and the connection. The launch sniper and MCP are at the bottom.</p>
            </div>
            <BotSettingsPanel />
          </>
        )}
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
          <span>Data: PumpPortal · GeckoTerminal · DexScreener — Routing: Jupiter · PumpPortal — AI: Claude</span>
          <span>Speculative assets. Most new tokens go to zero.</span>
        </div>
      </footer>
    </div>
  );
}
