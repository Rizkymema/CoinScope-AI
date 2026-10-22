'use client';

import React, { useState } from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useConvergenceStore } from '@/store/useConvergenceStore';
import type { ConvergenceConfig } from '@/types/convergence';

type NumKey = { [K in keyof ConvergenceConfig]: ConvergenceConfig[K] extends number ? K : never }[keyof ConvergenceConfig];

interface Field {
  key: NumKey;
  label: string;
  step?: number;
  /** Shown x100 (fractions edited as %). */
  percentOfOne?: boolean;
  /** Smallest accepted value (as shown). A cleared or half-typed field never saves 0. */
  min?: number;
  max?: number;
}

const GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: 'Stage 0 · wallet criteria',
    fields: [
      { key: 'minTokensTraded30d', label: 'Min tokens traded, 30d', min: 1 },
      { key: 'minWinRate', label: 'Min win rate %', min: 1, max: 100 },
      { key: 'maxLargestWinShare', label: 'Best trade max % of profit', percentOfOne: true, min: 1, max: 100 },
      { key: 'minAvgHoldMinutes', label: 'Min average hold (min)', step: 0.5 },
      { key: 'inactiveDays', label: 'Inactive after (days)', min: 1 },
    ],
  },
  {
    title: 'Stage 1 · trigger',
    fields: [
      { key: 'tierAPoints', label: 'Tier A points', min: 1 },
      { key: 'tierBPoints', label: 'Tier B points', min: 1 },
      { key: 'triggerPoints', label: 'Points to trigger', min: 1 },
      { key: 'windowMinutes', label: 'Window (min)', min: 1 },
      { key: 'minBuySol', label: 'Ignore buys under (SOL)', step: 0.05 },
      { key: 'maxPriceMultipleVsFirst', label: 'Too late above x first buy', step: 0.5, min: 1.1 },
      { key: 'pollSeconds', label: 'Poll each wallet every (s)', min: 5 },
    ],
  },
  {
    title: 'Stage 2 · safety',
    fields: [
      { key: 'minLiquidityUsd', label: 'Min liquidity $', step: 1000 },
      { key: 'minLpLockedPct', label: 'Min LP locked %', max: 100 },
      { key: 'maxTop10Pct', label: 'Max top 10 holders %', min: 1, max: 100 },
      { key: 'maxDevPct', label: 'Max dev holding %', max: 100 },
      { key: 'maxBundlePct', label: 'Max bundle / insiders %', max: 100 },
      { key: 'curveMinPct', label: 'Curve min %' },
      { key: 'curveMaxPct', label: 'Curve max %', min: 1, max: 100 },
      { key: 'maxRoundTripPct', label: 'Max sell-test round trip %', step: 0.5, min: 1, max: 100 },
    ],
  },
  {
    title: 'Stage 3-4 · momentum and AI',
    fields: [
      { key: 'aiScore', label: 'Score for AI', min: 1, max: 100 },
      { key: 'watchScore', label: 'Score for watchlist', min: 1, max: 100 },
      { key: 'watchMinutes', label: 'Watchlist window (min)', min: 1 },
      { key: 'recheckMinutes', label: 'Re-check every (min)', min: 1 },
      { key: 'washMinVolumeUsd', label: 'Wash check from volume $', step: 1000 },
      { key: 'aiMinConfidence', label: 'ENTRY min confidence %', min: 1, max: 100 },
      { key: 'noAiMinScore', label: 'No-AI min score', min: 1, max: 100 },
    ],
  },
  {
    title: 'Stage 5 · execution',
    fields: [
      { key: 'positionPct', label: 'Position % of capital', step: 0.1, min: 0.1, max: 10 },
      { key: 'dailyLossPct', label: 'Daily loss limit %', step: 0.5 },
      { key: 'maxPriceImpactPct', label: 'Max price impact %', step: 0.5, min: 0.1 },
      { key: 'maxSlippagePct', label: 'Max slippage %', min: 0.5, max: 50 },
      { key: 'maxChaseUpPct', label: 'Cancel if price ran +%', min: 1 },
    ],
  },
  {
    title: 'Stage 6 · exits',
    fields: [
      { key: 'tp1Multiple', label: 'TP1 at x', step: 0.5, min: 1.1 },
      { key: 'tp1SellPct', label: 'TP1 sell % of position', min: 1, max: 100 },
      { key: 'tp2Multiple', label: 'TP2 at x', step: 0.5, min: 1.2 },
      { key: 'tp2SellPct', label: 'TP2 sell % of original', min: 1, max: 100 },
      { key: 'moonbagTrailPct', label: 'Moonbag trail %', min: 1, max: 99 },
      { key: 'stopLossPct', label: 'Stop loss %', min: 1, max: 99 },
      { key: 'timeStopMinutes', label: 'Time stop (min)', min: 1 },
      { key: 'timeStopMinGainPct', label: 'Time stop needs +%' },
      { key: 'emergencyTriggerSellers', label: 'Emergency: trigger sellers', min: 1 },
      { key: 'emergencySellFraction', label: 'Emergency: sold over %', percentOfOne: true, min: 1, max: 100 },
      { key: 'emergencyLiquidityDropPct', label: 'Emergency: liquidity drop %', min: 1, max: 100 },
    ],
  },
];

/** Every threshold of the flow. The defaults are the document's starting points, not proven values. */
export const ConvergenceSettings: React.FC = () => {
  const { config, setConfig, resetConfig } = useConvergenceStore(useShallow((s) => ({ config: s.config, setConfig: s.setConfig, resetConfig: s.resetConfig })));
  const [narr, setNarr] = useState(config.narratives.join(', '));

  return (
    <details className="panel overflow-hidden">
      <summary className="px-5 py-4 text-[15px] font-bold text-white cursor-pointer select-none flex items-center gap-2">
        <SlidersHorizontal className="w-4 h-4 text-slate-500" />
        Convergence thresholds <span className="text-slate-500 font-normal text-[13px]">— starting points to test in paper mode</span>
      </summary>
      <div className="border-t border-line px-5 py-4 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="min-w-0">
            <span className="label">This week&apos;s narratives (comma separated, matched in name / symbol / description)</span>
            <input
              className="field"
              placeholder="ai, cat, political, ..."
              value={narr}
              onChange={(e) => setNarr(e.target.value)}
              onBlur={() => setConfig({ narratives: narr.split(',').map((x) => x.trim()).filter(Boolean) })}
            />
          </label>
          <div className="flex items-end gap-3">
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-[13px] text-slate-300">
                <input type="checkbox" checked={config.requireAi} onChange={(e) => setConfig({ requireAi: e.target.checked })} />
                AI verdict required for every entry
              </label>
              <label className="flex items-center gap-2 text-[13px] text-slate-300" title="Off: wallets whose criteria are incomplete (not every figure known) count too">
                <input type="checkbox" checked={config.onlyVerifiedWallets} onChange={(e) => setConfig({ onlyVerifiedWallets: e.target.checked })} />
                Only fully verified wallets count
              </label>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ghost ml-auto"
              onClick={() => {
                if (window.confirm('Reset every threshold to the document defaults? (narratives are kept)')) resetConfig();
              }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Defaults
            </button>
          </div>
        </div>
        {!config.requireAi && (
          <p className="text-[11px] text-warn">Without the AI requirement, a signal can trade while Claude is unreachable only when momentum is at least {config.noAiMinScore}.</p>
        )}
        {GROUPS.map((g) => (
          <fieldset key={g.title}>
            <legend className="text-[13px] font-semibold text-white mb-2">{g.title}</legend>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {g.fields.map((f) => {
                const raw = config[f.key] as number;
                const shown = f.percentOfOne ? Math.round(raw * 100) : raw;
                return (
                  <label key={f.key} className="min-w-0">
                    <span className="label truncate" title={f.label}>
                      {f.label}
                    </span>
                    <input
                      type="number"
                      step={f.step ?? 1}
                      min={f.min ?? 0}
                      max={f.max}
                      className="field font-mono"
                      value={shown}
                      onChange={(e) => {
                        if (e.target.value === '') return;
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v) || v < (f.min ?? 0) || (f.max !== undefined && v > f.max)) return;
                        setConfig({ [f.key]: f.percentOfOne ? v / 100 : v } as Partial<ConvergenceConfig>);
                      }}
                    />
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </details>
  );
};
