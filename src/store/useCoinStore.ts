import { create } from 'zustand';
import { CoinData, CoinAnalysis } from '../types/coin';
import { AIService } from '../services/ai.service';
import { CoinService } from '../services/coin.service';

interface AppState {
  // Coin Data
  selectedCoin: CoinData | null;
  isCoinLoading: boolean;
  
  // AI Metrics
  aiAnalysis: CoinAnalysis | null;
  isAiLoading: boolean;
  aiError: string | null;

  // Live feeds
  topCoins: CoinData[];
  boostedCoins: CoinData[];
  latestCoins: CoinData[];
  isTopCoinsLoading: boolean;
  isBoostedLoading: boolean;
  isLatestLoading: boolean;
  lastUpdated: number;

  // Actions
  selectCoin: (symbol: string) => Promise<void>;
  selectCoinDirect: (coin: CoinData) => void;
  fetchAIAnalysis: (symbol: string) => Promise<void>;
  fetchTopCoins: () => Promise<void>;
  fetchBoostedCoins: () => Promise<void>;
  fetchLatestCoins: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

export const useCoinStore = create<AppState>((set, get) => ({
  selectedCoin: null,
  isCoinLoading: false,
  aiAnalysis: null,
  isAiLoading: false,
  aiError: null,
  topCoins: [],
  boostedCoins: [],
  latestCoins: [],
  isTopCoinsLoading: false,
  isBoostedLoading: false,
  isLatestLoading: false,
  lastUpdated: 0,

  selectCoin: async (symbol: string) => {
    set({ isCoinLoading: true, aiAnalysis: null, aiError: null });
    try {
      const coin = await CoinService.getCoinBySymbol(symbol);
      set({ selectedCoin: coin, isCoinLoading: false });
      
      // Chain AI fetching immediately after fetching coin details
      if (coin) {
        await get().fetchAIAnalysis(coin.symbol);
      }
    } catch (err) {
      set({ selectedCoin: null, isCoinLoading: false });
    }
  },

  selectCoinDirect: (coin: CoinData) => {
    set({ selectedCoin: coin, aiAnalysis: null, aiError: null });
    // Fire AI analysis in background
    get().fetchAIAnalysis(coin.symbol);
  },

  fetchAIAnalysis: async (symbol: string) => {
    set({ isAiLoading: true, aiError: null });
    try {
      const analysis = await AIService.analyzeCoin(symbol);
      set({ aiAnalysis: analysis, isAiLoading: false });
    } catch (err: any) {
      set({ aiError: err.message || "Failed to load AI Analysis", isAiLoading: false });
    }
  },

  fetchTopCoins: async () => {
    set({ isTopCoinsLoading: true });
    try {
      const coins = await CoinService.getTopCoins();
      set({ topCoins: coins, isTopCoinsLoading: false, lastUpdated: Date.now() });
    } catch {
      set({ isTopCoinsLoading: false });
    }
  },

  fetchBoostedCoins: async () => {
    set({ isBoostedLoading: true });
    try {
      const coins = await CoinService.getBoostedTokens();
      set({ boostedCoins: coins, isBoostedLoading: false });
    } catch {
      set({ isBoostedLoading: false });
    }
  },

  fetchLatestCoins: async () => {
    set({ isLatestLoading: true });
    try {
      const coins = await CoinService.getLatestProfiles();
      set({ latestCoins: coins, isLatestLoading: false });
    } catch {
      set({ isLatestLoading: false });
    }
  },

  refreshAll: async () => {
    const { fetchTopCoins, fetchBoostedCoins, fetchLatestCoins } = get();
    await Promise.allSettled([
      fetchTopCoins(),
      fetchBoostedCoins(),
      fetchLatestCoins(),
    ]);
  },
}));
