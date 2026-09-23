'use client';

import React from 'react';
import { useShallow } from 'zustand/react/shallow';

import { CoinScoreCard } from './CoinScoreCard';
import { InsightsPanel } from './InsightsPanel';
import { PriceChart } from './PriceChart';
import { TokenTrades } from './TokenTrades';
import { TokenSafety } from './TokenSafety';
import { useCoinStore } from '@/store/useCoinStore';
import { useBotStore } from '@/store/useBotStore';

/**
 * Detail view for the selected token: chart and trade tape on the left, the
 * scorecard and on-chain checks in a side rail.
 */
export const TokenDetail: React.FC = () => {
  const { selectedCoin, isAiLoading } = useCoinStore(
    useShallow((s) => ({ selectedCoin: s.selectedCoin, isAiLoading: s.isAiLoading }))
  );
  const position = useBotStore((s) =>
    selectedCoin ? s.positions.find((p) => p.coin.id === selectedCoin.id) ?? null : null
  );

  if (!selectedCoin && !isAiLoading) return null;

  return (
    <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr] items-start">
      <div className="space-y-4 min-w-0">
        {selectedCoin && <PriceChart coin={selectedCoin} position={position} />}
        {selectedCoin && <TokenTrades coin={selectedCoin} />}
      </div>

      <div className="space-y-4 min-w-0">
        <CoinScoreCard />
        {selectedCoin && <TokenSafety coin={selectedCoin} />}
        <InsightsPanel />
      </div>
    </div>
  );
};
