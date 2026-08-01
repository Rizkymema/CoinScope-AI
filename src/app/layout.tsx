import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'CoinScope AI - AI-Powered Crypto Intelligence',
  description: 'Discover, analyze, and score high-potential tokens across all DEX platforms in real-time using advanced AI models.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Syne:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans bg-ink-950 text-slate-200 min-h-screen antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
