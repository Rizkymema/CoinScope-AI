# CoinScope AI - Crypto Intelligence Platform

🚀 **AI-Powered Cryptocurrency Analysis & Scoring System**

## 📋 Features

### ✨ Core Features
- **Real-time Coin Search**: Autocomplete search dengan debouncing 300ms
- **AI Coin Scoring**: Aggregates fundamental, technical, sentiment, dan risk metrics (0-100 scale)
- **Smart Insights**: AI-generated insights tentang trending coins dan hidden risks
- **AI Judge Chat**: Chat interface untuk bertanya tentang coin analysis
- **Live Market Feed**: Real-time data dari DexScreener API dengan auto-refresh 10 detik
- **Featured Coins Carousel**: Carousel horizontal dengan top performing coins
- **Filter Tabs**: Filter coins berdasarkan category (Movers, Trending, Mayhem, Live, New, Market Cap, dll)
- **Responsive Grid**: Responsive grid layout untuk explore coins

### 🔌 API Integration Ready
- **DexScreener API**: Live coin data dari seluruh DEX (Solana, Ethereum, Base, dll)
- **Pump.fun Support**: Otomatis detect dan fetch Pump.fun tokens
- **Streaming Ready**: Chat interface siap untuk streaming responses dari LLM backend
- **Mock Data**: All components memiliki fallback mock data untuk development

## 🛠️ Tech Stack

- **Frontend**: Next.js 14 (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS + Shadcn system
- **State Management**: Zustand
- **Icons**: Lucide React
- **HTTP Client**: Fetch API

## 📦 Struktur Project

```
src/
├── app/
│   ├── page.tsx              # Main dashboard page
│   ├── layout.tsx            # Root layout
│   └── globals.css           # Global styles
├── components/
│   ├── SearchPanel.tsx       # Debounced search + autocomplete
│   ├── CoinScoreCard.tsx     # AI scoring display
│   ├── AIJudgeChat.tsx       # Chat interface for AI
│   ├── InsightsPanel.tsx     # Smart insights component
│   ├── TrendingCoinsGrid.tsx # Grid layout untuk trending coins
│   ├── FeaturedCoinsCarousel.tsx  # Carousel untuk featured coins
│   └── FilterTabs.tsx        # Filter/category tabs
├── services/
│   ├── ai.service.ts         # AI integration layer (analyzeCoin, judgeCoin)
│   └── coin.service.ts       # Coin data fetching (DexScreener API)
├── store/
│   └── useCoinStore.ts       # Zustand global state management
└── types/
    └── coin.ts              # TypeScript interfaces
```

## 🚀 Quick Start

### 1. Install Dependencies
```bash
cd apps/coinscope-ui
npm install
```

### 2. Run Development Server
```bash
npm run dev
```

Server akan jalan di **http://localhost:3000**

### 3. Build for Production
```bash
npm run build
npm start
```

## 🎯 How to Use

### Search Coins
1. Gunakan search bar di bagian atas
2. Type nama coin atau symbol (e.g., "Bitcoin", "SOL", "PEPE")
3. Results akan auto-populate dengan DexScreener data
4. Click result untuk select coin

### View AI Analysis
1. Setelah select coin, AI Score Card akan menampilkan:
   - Overall score (0-100)
   - Breakdown: Fundamental, Technical, Sentiment, Risk
   - Risk flags dan category (Buy/Watchlist/Hold/Avoid)

### Ask AI Judge
1. Input pertanyaan di chat panel sebelah kanan
2. e.g., "Should I buy this coin?"
3. AI akan memberikan response yang di-stream secara real-time

### Explore Trending
1. Scroll ke bawah untuk melihat trending coins grid
2. Use filter tabs untuk change view (Movers, Trending, dll)
3. Click card untuk analyze coin

### Featured Carousel
1. Lihat featured coins section
2. Use arrow buttons untuk navigate carousel
3. Click coin untuk quick analysis

## 🔧 Configuration

### Environment Variables (.env.local)
```env
# Optional: AI backend
NEXT_PUBLIC_AI_API_URL=https://api.yourbackend.com/v1

# DexScreener (public API, no key needed)
NEXT_PUBLIC_DEX_API=https://api.dexscreener.com/latest/dex
```

## 📱 Responsive Design
- ✅ Mobile-first approach
- ✅ Breakpoints: sm (640px), md (768px), lg (1024px), xl (1280px)
- ✅ Touch-friendly UI elements
- ✅ Optimized for all screen sizes

## 🎨 Design System
- **Color Scheme**: Dark mode (Slate 950 base)
- **Primary Color**: Indigo (600-700)
- **Accent Colors**: Emerald (success), Red (danger), Amber (warning)
- **Typography**: Inter font, strict hierarchy
- **Spacing**: 8pt system
- **Shadows**: Soft, subtle shadows dengan hover effects

## 🔐 Security Features
- ✅ TypeScript strict mode
- ✅ No API keys exposed in frontend
- ✅ Debounced search (prevent API spam)
- ✅ Error boundaries & fallbacks
- ✅ Input validation & sanitization

## 🤖 AI Integration Points

### Current Implementation (Mock)
- `ai.service.ts::analyzeCoin()` - Mock AI scoring
- `ai.service.ts::judgeCoin()` - Mock streaming chat

### Ready for Backend Integration
1. Replace `AIService.analyzeCoin()` dengan actual API call
2. Replace `AIService.judgeCoin()` dengan streaming response handler
3. Update `coin.service.ts` untuk fetch live data jika diperlukan

## 📊 API Response Structures

### Coin Analysis Response
```json
{
  "symbol": "BTC",
  "score": 78,
  "category": "Buy",
  "analysis": "Strong fundamentals with bullish technical setup",
  "risk_protocol": {
    "flags": ["High volatility"],
    "level": "Medium"
  },
  "breakdown": {
    "fundamental": 85,
    "technical": 78,
    "sentiment": 72,
    "risk": 90
  },
  "generated_at": "2025-05-01T12:00:00Z"
}
```

## 🎯 Future Enhancements

- [ ] Real-time WebSocket support untuk live price updates
- [ ] Portfolio tracking & alerts
- [ ] Advanced charting (TradingView integration)
- [ ] Notification system untuk price alerts
- [ ] User authentication & saved watchlists
- [ ] Advanced AI models dengan fine-tuning
- [ ] Social sentiment aggregation
- [ ] Historical analysis trends

## 📝 License

Proprietary - Built for CoinScope AI

## 💡 Support

For issues atau questions, silakan check:
1. Terminal error messages
2. Browser console (F12)
3. Check `.env.local` configuration
