'use client';

import { SearchPanel } from '@/components/SearchPanel';
import { CoinScoreCard } from '@/components/CoinScoreCard';
import { InsightsPanel } from '@/components/InsightsPanel';
import { AIJudgeChat } from '@/components/AIJudgeChat';
import { TrendingCoinsGrid } from '@/components/TrendingCoinsGrid';
import { FeaturedCoinsCarousel } from '@/components/FeaturedCoinsCarousel';
import { FilterTabs } from '@/components/FilterTabs';
import { NewCoinsLiveFeed } from '@/components/NewCoinsLiveFeed';
import { LiveMarketTicker } from '@/components/LiveMarketTicker';
import { useCoinStore } from '@/store/useCoinStore';
import { Activity, Loader2, Zap, Globe } from 'lucide-react';
import { useState, useEffect } from 'react';
import { FilterType } from '@/components/FilterTabs';

export default function DashboardPage() {
  const [activeFilter, setActiveFilter] = useState<FilterType>('trending');
  const [isAppReady, setIsAppReady] = useState(false);
  const [activeTab, setActiveTab] = useState<'trending' | 'new'>('trending');
  const { selectedCoin, isAiLoading } = useCoinStore();

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      setIsAppReady(true);
    });
    return () => cancelAnimationFrame(rafId);
  }, []);

  const handleFilterChange = (filter: FilterType) => {
    setActiveFilter(filter);
  };

  if (!isAppReady) {
    return (
      <div className="min-h-screen gradient-mesh flex flex-col items-center justify-center">
        <div className="animate-brand-in flex flex-col items-center">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-signal/15 border border-signal/30 p-3 rounded-2xl">
              <Activity className="w-8 h-8 text-signal-soft" />
            </div>
            <span className="font-display font-extrabold tracking-tight text-white text-3xl">
              CoinScope<span className="text-signal-soft">AI</span>
            </span>
          </div>
          <Loader2 className="w-5 h-5 text-signal animate-spin" />
          <p className="text-slate-500 text-sm mt-3">Connecting to live markets...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-200 selection:bg-signal/30 font-sans gradient-mesh">
      <LiveMarketTicker />

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
            <div className="hidden md:flex items-center bg-ink-850/80 border border-white/8 rounded-xl p-1">
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
            </div>

            <div className="flex items-center bg-ink-850/80 border border-white/8 rounded-xl px-3 py-1.5">
              <span className="relative flex h-2 w-2 mr-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-medium text-slate-400">Live</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12">
        <section className="relative flex flex-col items-center justify-center pt-10 pb-6 min-h-[42vh]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-full overflow-hidden">
            <div className="absolute left-1/2 top-8 h-56 w-[min(720px,90vw)] -translate-x-1/2 rounded-full bg-signal/10 blur-3xl animate-soft-pulse" />
          </div>

          <div className="relative z-10 animate-brand-in text-center">
            <h1 className="font-display text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white mb-3">
              CoinScope<span className="text-signal-soft">AI</span>
            </h1>
            <div className="mx-auto mb-5 h-px w-24 bg-gradient-to-r from-transparent via-signal to-transparent animate-line-draw" />
            <p className="text-slate-400 text-center max-w-xl mx-auto mb-8 leading-relaxed text-base md:text-lg">
              Real-time DEX intelligence with AI scoring across every major chain.
            </p>
            <SearchPanel />
          </div>
        </section>

        <div className="md:hidden flex items-center gap-2 bg-ink-850/80 border border-white/8 rounded-xl p-1.5">
          <button
            onClick={() => setActiveTab('trending')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'trending'
                ? 'bg-signal text-ink-950'
                : 'text-slate-400'
            }`}
          >
            <Zap className="w-4 h-4" />
            Trending
          </button>
          <button
            onClick={() => setActiveTab('new')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'new'
                ? 'bg-amber-400 text-ink-950'
                : 'text-slate-400'
            }`}
          >
            <Globe className="w-4 h-4" />
            New Coins
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
        ) : (
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
              <span>Data: DexScreener API</span>
              <span className="hidden sm:inline">·</span>
              <span>Updates every 10s</span>
              <span className="hidden sm:inline">·</span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                All systems operational
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
