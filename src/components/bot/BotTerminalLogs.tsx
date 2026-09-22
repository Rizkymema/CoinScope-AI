'use client';

import React, { useState } from 'react';
import { Terminal, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useBotStore } from '@/store/useBotStore';
import { BotLogEntry } from '@/types/bot';

type Filter = 'all' | 'trades' | 'ai' | 'skipped';

const TONE: Record<BotLogEntry['type'], string> = {
  buy: 'text-pos',
  sell: 'text-warn',
  warning: 'text-neg',
  skip: 'text-slate-500',
  ai: 'text-signal',
  tx: 'text-info',
  info: 'text-slate-300',
};

const MATCH: Record<Filter, (t: BotLogEntry['type']) => boolean> = {
  all: () => true,
  trades: (t) => t === 'buy' || t === 'sell' || t === 'tx',
  ai: (t) => t === 'ai',
  skipped: (t) => t === 'skip' || t === 'warning',
};

export const BotTerminalLogs: React.FC = () => {
  const { logs, clearLogs } = useBotStore(useShallow((s) => ({ logs: s.logs, clearLogs: s.clearLogs })));
  const [filter, setFilter] = useState<Filter>('all');
  const visible = logs.filter((l) => MATCH[filter](l.type));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-bold text-white flex items-center gap-2">
          <Terminal className="w-4 h-4 text-slate-500" />
          Activity
        </h3>
        <button
          type="button"
          onClick={clearLogs}
          aria-label="Clear activity log"
          className="p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-white/5 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="tabbar w-full">
        {(['all', 'trades', 'ai', 'skipped'] as Filter[]).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} data-active={filter === f} className="tab flex-1 justify-center capitalize">
            {f}
          </button>
        ))}
      </div>

      <div className="panel terminal h-[460px] overflow-y-auto p-3 select-text">
        {visible.length === 0 ? (
          <p className="text-slate-600 text-center py-16 text-xs">No entries yet.</p>
        ) : (
          <ol className="space-y-1.5">
            {visible.map((log) => (
              <li key={log.id} className="flex gap-2 pb-1.5 border-b border-white/[0.03] last:border-b-0">
                <span className="text-slate-600 shrink-0 tabular-nums">{log.timestamp}</span>
                <span className={`${TONE[log.type]} break-words min-w-0`}>{log.message}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
};
