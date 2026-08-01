'use client';

import React from 'react';
import { useCoinStore } from '@/store/useCoinStore';
import { Lightbulb, Flame, AlertOctagon, TrendingUp } from 'lucide-react';

export const InsightsPanel: React.FC = () => {
  const { aiAnalysis, isAiLoading, selectedCoin } = useCoinStore();

  if (isAiLoading || !selectedCoin) return null;

  if (!aiAnalysis) return null;

  // Mocking insights generation based on the analysis returned
  const insights = [
    {
      type: 'trending',
      title: 'Why it is trending',
      description: aiAnalysis.score > 60 
        ? "High social velocity combined with accumulation by smart money addresses." 
        : "Recent protocol updates have triggered algorithmic buying pressure.",
      icon: Flame,
      color: "text-amber-500",
      bg: "bg-amber-500/10"
    },
    {
      type: 'risk',
      title: 'Hidden Risks',
      description: aiAnalysis.risk_protocol.flags.length > 0 
        ? aiAnalysis.risk_protocol.flags.join(", ") 
        : "No significant algorithmic anomalies detected.",
      icon: AlertOctagon,
      color: "text-red-400",
      bg: "bg-red-400/10"
    },
    {
      type: 'outlook',
      title: 'Short-term Outlook',
      description: aiAnalysis.category === 'Buy' || aiAnalysis.category === 'Watchlist'
        ? "Bullish indicators clustering in the 4H timeframe."
        : "Bearish divergence signaling potential macro consolidation.",
      icon: TrendingUp,
      color: "text-signal-soft",
      bg: "bg-signal/10"
    }
  ];

  return (
    <div className="surface rounded-2xl overflow-hidden flex flex-col">
      <div className="px-6 py-4 border-b border-white/8 flex items-center justify-between">
        <h3 className="font-display font-semibold text-white flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-emerald-400" />
          Smart Insights
        </h3>
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">AI Generated</span>
      </div>
      
      <div className="p-6 grid gap-4">
        {insights.map((insight, i) => (
          <div key={i} className="flex gap-4">
            <div className={`mt-1 shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${insight.bg}`}>
              <insight.icon className={`w-4 h-4 ${insight.color}`} />
            </div>
            <div>
              <h4 className="text-sm font-medium text-slate-200 mb-1">{insight.title}</h4>
              <p className="text-sm text-slate-400 leading-relaxed">
                {insight.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
