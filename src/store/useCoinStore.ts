import { create } from 'zustand';
import { CoinData, CoinAnalysis } from '../types/coin';
import { AIService } from '../services/ai.service';
import { wsService } from '../services/websocket.service';
import { useBotStore } from './useBotStore';

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
    const previous = get().selectedCoin;
    set({ selectedCoin: coin, aiAnalysis: null, aiError: null, aiSource: null, aiNote: null });

    // Follow this token's trades so its chart keeps ticking, and stop following the last one
    // unless the bot still holds it.
    const mintOf = (c: CoinData) => c.mint || (c.id.includes(':') ? c.id.split(':')[1] : '');
    if ((coin.chainId || '').toLowerCase() === 'solana') {
      const mint = mintOf(coin);
      if (mint) {
        wsService.connect();
        wsService.subscribeTokenTrades([mint]);
      }
    }
    if (previous && previous.id !== coin.id && (previous.chainId || '').toLowerCase() === 'solana') {
      const prevMint = mintOf(previous);
      const stillHeld = useBotStore.getState().positions.some((p) => (p.mint || mintOf(p.coin)) === prevMint);
      if (prevMint && !stillHeld) wsService.unsubscribeTokenTrades([prevMint]);
    }

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
