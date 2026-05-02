import { Inter } from 'next/font/google';
import './globals.css';
import type { Metadata } from 'next';

const inter = Inter({ subsets: ['latin'] });

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
      <body className={`${inter.className} bg-slate-950 min-h-screen antialiased`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
