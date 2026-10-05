'use client';

import { useEffect } from 'react';

/** 20 Hz at about -57 dBFS: inaudible on speakers, but above Chrome's silence threshold (about -72 dBFS). */
const TONE_HZ = 20;
const TONE_GAIN = 0.002;

/**
 * The bot runs inside this tab. While it is trading (or holding live positions) this hook
 * 1) asks the browser to keep the screen awake, so the machine does not sleep mid-trade,
 * 2) warns before the tab is closed or reloaded, which would stop entries and exits, and
 * 3) plays an inaudible tone. Hidden tabs are throttled to one timer tick a minute and later
 *    frozen, which stalls stop-losses; tabs playing audio are exempt. Autoplay rules mean the tone
 *    starts on the first click or key press, and the tab shows a speaker icon while it runs.
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

    let ctx: AudioContext | null = null;
    let osc: OscillatorNode | null = null;
    const startTone = () => {
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return;
      }
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      try {
        ctx = new AudioCtx();
        osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = TONE_HZ;
        gain.gain.value = TONE_GAIN;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      } catch {
        ctx = null;
        osc = null;
      }
    };

    acquire();
    startTone();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pointerdown', startTone);
    window.addEventListener('keydown', startTone);
    return () => {
      cancelled = true;
      lock?.release().catch(() => {});
      try {
        osc?.stop();
      } catch {
        // already stopped
      }
      ctx?.close().catch(() => {});
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pointerdown', startTone);
      window.removeEventListener('keydown', startTone);
    };
  }, [active]);
}
