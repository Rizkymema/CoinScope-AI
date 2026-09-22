'use client';

import React, { useState } from 'react';
import { Terminal, Trash2 } from 'lucide-react';
import { useBotStore } from '@/store/useBotStore';

export const BotTerminalLogs: React.FC = () => {
  const { logs, clearLogs } = useBotStore();
  const [logFilter, setLogFilter] = useState<'all' | 'buy' | 'sell' | 'skip'>('all');

  const filteredLogs = logs.filter((log) => {
    if (logFilter === 'all') return true;
    if (logFilter === 'buy') return log.type === 'buy';
    if (logFilter === 'sell') return log.type === 'sell';
    if (logFilter === 'skip') return log.type === 'skip' || log.type === 'warning';
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold text-white flex items-center gap-2">
          <Terminal className="w-5 h-5 text-amber-400" />
          Live Bot Activity Logs
        </h3>
        <button
          onClick={clearLogs}
          className="p-1.5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors"
          title="Clear Logs"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Filter buttons */}
      <div className="flex items-center gap-1 bg-ink-900 border border-white/10 rounded-xl p-1 text-xs">
        {(['all', 'buy', 'sell', 'skip'] as const).map((filter) => (
          <button
            key={filter}
            onClick={() => setLogFilter(filter)}
            className={`flex-1 py-1 rounded-lg font-medium capitalize transition-all ${
              logFilter === filter
                ? 'bg-white/15 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {filter}
          </button>
        ))}
      </div>

      {/* Terminal Window */}
      <div className="bg-black/80 border border-white/10 rounded-2xl p-4 font-mono text-xs h-[450px] overflow-y-auto space-y-2 select-text shadow-inner">
        {filteredLogs.length === 0 ? (
          <div className="text-slate-600 text-center py-20">No logs recorded yet.</div>
        ) : (
          filteredLogs.map((log) => {
            const isBuy = log.type === 'buy';
            const isSell = log.type === 'sell';
            const isSkip = log.type === 'skip';
            const isWarning = log.type === 'warning';

            return (
              <div
                key={log.id}
                className={`leading-relaxed border-b border-white/[0.03] pb-1.5 ${
                  isBuy
                    ? 'text-emerald-400 font-semibold'
                    : isSell
                    ? 'text-amber-400 font-semibold'
                    : isWarning
                    ? 'text-red-400'
                    : isSkip
                    ? 'text-slate-500'
                    : 'text-slate-300'
                }`}
              >
                <span className="text-slate-600 mr-2">[{log.timestamp}]</span>
                {log.message}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
