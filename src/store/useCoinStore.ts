import { create } from 'zustand';
import { CoinData, CoinAnalysis } from '../types/coin';
import { AIService } from '../services/ai.service';

interface AppState {
  selectedCoin: CoinData | null;
  aiAnalysis: CoinAnalysis | null;
  isAiLoading: boolean;
  aiError: string | null;

  selectCoinDirect: (coin: CoinData) => void;
  fetchAIAnalysis: (symbol: string) => Promise<void>;
}

export const useCoinStore = create<AppState>((set, get) => ({
  selectedCoin: null,
  aiAnalysis: null,
  isAiLoading: false,
  aiError: null,

  selectCoinDirect: (coin: CoinData) => {
    set({ selectedCoin: coin, aiAnalysis: null, aiError: null });
    get().fetchAIAnalysis(coin.symbol);
  },

  fetchAIAnalysis: async (symbol: string) => {
    set({ isAiLoading: true, aiError: null });
    try {
      const analysis = await AIService.analyzeCoin(symbol);
      set({ aiAnalysis: analysis, isAiLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load AI Analysis';
      set({ aiError: message, isAiLoading: false });
    }
  },
}));
