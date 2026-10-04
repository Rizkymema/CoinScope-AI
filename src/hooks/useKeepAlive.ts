'use client';

import { useEffect } from 'react';

/**
 * The bot runs inside this tab. While it is trading (or holding live positions) this hook
 * 1) asks the browser to keep the screen awake, so the machine does not sleep mid-trade, and
 * 2) warns before the tab is closed or reloaded, which would stop entries and exits.
 */
export function useKeepAlive(active: boolean) {
  useEffect(() => {
    if (!active || typeof window === 'undefined') return;

    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } };

    const acquire = async () => {
      if (!nav.wakeLock || document.visibilityState !== 'visible') return;
      try {
        const l = await nav.wakeLock.request('screen');
        if (cancelled) l.release().catch(() => {});
        else lock = l;
      } catch {
        // Denied (battery saver, unsupported) - the warning below still applies.
      }
    };
    // Wake locks are dropped whenever the tab is hidden; take it again when it comes back.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    acquire();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      cancelled = true;
      lock?.release().catch(() => {});
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [active]);
}
