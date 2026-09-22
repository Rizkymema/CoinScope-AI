import { create } from 'zustand';
import { CoinData, CoinAnalysis } from '../types/coin';
import { AIService } from '../services/ai.service';

interface AppState {
  selectedCoin: CoinData | null;
  aiAnalysis: CoinAnalysis | null;
  isAiLoading: boolean;
  aiError: string | null;

  aiSource: 'ai' | 'heuristic' | null;
  aiNote: string | null;

  selectCoinDirect: (coin: CoinData) => void;
  fetchAIAnalysis: (coin: CoinData) => Promise<void>;
}

export const useCoinStore = create<AppState>((set, get) => ({
  selectedCoin: null,
  aiAnalysis: null,
  isAiLoading: false,
  aiError: null,
  aiSource: null,
  aiNote: null,

  selectCoinDirect: (coin: CoinData) => {
    set({ selectedCoin: coin, aiAnalysis: null, aiError: null, aiSource: null, aiNote: null });
    get().fetchAIAnalysis(coin);
  },

  fetchAIAnalysis: async (coin: CoinData) => {
    set({ isAiLoading: true, aiError: null });
    try {
      const { source, note, ...analysis } = await AIService.analyzeCoin(coin);
      // Ignore stale responses if the user already selected another coin.
      if (get().selectedCoin && get().selectedCoin!.id !== coin.id) return;
      set({ aiAnalysis: analysis, isAiLoading: false, aiSource: source || null, aiNote: note || null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load AI Analysis';
      set({ aiError: message, isAiLoading: false });
    }
  },
}));
