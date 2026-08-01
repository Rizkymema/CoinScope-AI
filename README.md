# CoinScope AI

AI-assisted crypto intelligence UI with live DEX market data from DexScreener.

## Stack

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- Zustand
- Lucide React

## Project structure

```
src/
├── app/           # Next.js pages & global styles
├── components/    # UI components
├── services/      # DexScreener + AI (mock) services
├── store/         # Zustand state
└── types/         # Shared TypeScript types
```

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm run build
npm start
```

## Notes

- Market data comes from the public DexScreener API (no key required).
- AI scoring/chat is still mock/placeholder until a real backend is connected.
- Copy `.env.example` to `.env.local` if you add AI API config later.
