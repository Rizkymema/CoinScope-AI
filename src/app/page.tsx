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
import { Activity, Loader2, Zap, Shield, Globe } from 'lucide-react';
import { useState, useEffect } from 'react';
import { FilterType } from '@/components/FilterTabs';

export default function DashboardPage() {
  const [activeFilter, setActiveFilter] = useState<FilterType>('trending');
  const [isAppReady, setIsAppReady] = useState(false);
  const [activeTab, setActiveTab] = useState<'trending' | 'new'>('trending');
  const { selectedCoin, isAiLoading } = useCoinStore();

  useEffect(() => {
    // Use requestAnimationFrame for better performance
    const rafId = requestAnimationFrame(() => {
      setIsAppReady(true);
    });
    return () => cancelAnimationFrame(rafId);
  }, []);

  const handleFilterChange = (filter: FilterType) => {
    setActiveFilter(filter);
  };

  // Show a branded loading splash while the app hydrates
  if (!isAppReady) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gradient-mesh">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-gradient-to-br from-indigo-600 to-purple-600 p-3 rounded-2xl shadow-lg shadow-indigo-500/20">
            <Activity className="w-8 h-8 text-white" />
          </div>
          <span className="font-bold tracking-tight text-white text-3xl">CoinScope<span className="text-indigo-400">AI</span></span>
        </div>
        <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
        <p className="text-slate-500 text-sm mt-3">Connecting to live markets...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 selection:bg-indigo-500/30 font-sans gradient-mesh">
      {/* Live Market Ticker */}
      <LiveMarketTicker />

      {/* Header */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800/50">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="bg-gradient-to-br from-indigo-600 to-purple-600 p-1.5 rounded-xl shadow-lg shadow-indigo-500/20">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold tracking-tight text-white text-lg">CoinScope<span className="text-indigo-400">AI</span></span>
          </div>
          <div className="flex items-center gap-3">
            {/* Navigation tabs */}
            <div className="hidden md:flex items-center bg-slate-900/80 border border-slate-800/50 rounded-full p-1">
              <button
                onClick={() => setActiveTab('trending')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  activeTab === 'trending'
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                Trending
              </button>
              <button
                onClick={() => setActiveTab('new')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  activeTab === 'new'
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                New Coins
              </button>
            </div>

            <div className="flex items-center bg-slate-900/80 border border-slate-800/50 rounded-full px-3 py-1.5">
              <span className="relative flex h-2 w-2 mr-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-medium text-slate-400">Live</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12">
        
        {/* Hero Section */}
        <section className="flex flex-col items-center justify-center py-8">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-4 h-4 text-indigo-400" />
            <span className="text-xs text-indigo-400 font-medium uppercase tracking-widest">Real-time DEX Intelligence</span>
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-4 tracking-tight text-center">
            AI-Powered Crypto
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent"> Intelligence</span>
          </h1>
          <p className="text-slate-400 text-center max-w-2xl mb-8 leading-relaxed">
            Discover, analyze, and score tokens across all DEX platforms. Real-time data from DexScreener with AI-powered risk analysis.
          </p>
          <SearchPanel />
        </section>

        {/* Mobile tab switch */}
        <div className="md:hidden flex items-center gap-2 bg-slate-900/80 border border-slate-800/50 rounded-2xl p-1.5">
          <button
            onClick={() => setActiveTab('trending')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'trending'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400'
            }`}
          >
            <Zap className="w-4 h-4" />
            Trending
          </button>
          <button
            onClick={() => setActiveTab('new')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'new'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400'
            }`}
          >
            <Globe className="w-4 h-4" />
            New Coins
          </button>
        </div>

        {activeTab === 'trending' ? (
          <>
            {/* Featured Carousel */}
            <FeaturedCoinsCarousel />

            {/* AI Analysis Section */}
            {(selectedCoin || isAiLoading) && (
              <>
                <section className="mb-8">
                  <CoinScoreCard />
                </section>
                <section className="mb-8">
                  <InsightsPanel />
                </section>
              </>
            )}

            {/* Filter Tabs */}
            <section>
              <FilterTabs onFilterChange={handleFilterChange} activeFilter={activeFilter} />
            </section>

            {/* Trending Grid */}
            <section>
              <TrendingCoinsGrid activeFilter={activeFilter} />
            </section>
          </>
        ) : (
          <>
            {/* AI Analysis Section (stays visible) */}
            {(selectedCoin || isAiLoading) && (
              <>
                <section className="mb-8">
                  <CoinScoreCard />
                </section>
                <section className="mb-8">
                  <InsightsPanel />
                </section>
              </>
            )}

            {/* New Coins Live Feed */}
            <section>
              <NewCoinsLiveFeed />
            </section>
          </>
        )}

      </main>

      {/* Floating Chat Widget */}
      <AIJudgeChat />

      {/* Footer */}
      <footer className="border-t border-slate-800/50 mt-16">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="bg-gradient-to-br from-indigo-600 to-purple-600 p-1 rounded-lg">
                <Activity className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-sm font-semibold text-slate-400">CoinScope<span className="text-indigo-400">AI</span></span>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-600">
              <span>Data: DexScreener API</span>
              <span>•</span>
              <span>Real-time updates every 10s</span>
              <span>•</span>
              <span className="flex items-center gap-1">
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
