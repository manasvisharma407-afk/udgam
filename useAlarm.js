import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Emergency alarm.
 *
 * The siren is *synthesised* with the Web Audio API rather than loaded from an
 * mp3. Three reasons that matter here: it works with zero network (a distress
 * alert must fire on a dying connection), it adds nothing to the bundle, and
 * it can run indefinitely without a loop seam.
 *
 * Browsers suspend AudioContext until a user gesture. We therefore create the
 * context lazily on the first interaction and keep it warm, so that when an
 * alert arrives later the siren starts instantly.
 */

const SIREN = {
  lowHz: 660,
  highHz: 1180,
  sweepSeconds: 0.55,
  gain: 0.28,
};

const VIBRATION_PATTERN = [400, 150, 400, 150, 400, 600];

export default function useAlarm() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isArmed, setIsArmed] = useState(false);

  const ctxRef = useRef(null);
  const nodesRef = useRef(null);
  const vibrationRef = useRef(null);
  const wakeLockRef = useRef(null);

  const getContext = useCallback(() => {
    if (ctxRef.current) return ctxRef.current;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctxRef.current = new AudioCtx();
    return ctxRef.current;
  }, []);

  /**
   * Call from any user gesture to unlock audio ahead of time. Playing a
   * one-sample silent buffer is the standard iOS unlock trick.
   */
  const arm = useCallback(async () => {
    const ctx = getContext();
    if (!ctx) return false;
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      setIsArmed(true);
      return true;
    } catch {
      return false;
    }
  }, [getContext]);

  const stop = useCallback(() => {
    const nodes = nodesRef.current;
    if (nodes) {
      try {
        // Short fade instead of a hard stop, which otherwise clicks audibly.
        const ctx = ctxRef.current;
        nodes.gain.gain.cancelScheduledValues(ctx.currentTime);
        nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, ctx.currentTime);
        nodes.gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
        nodes.osc.stop(ctx.currentTime + 0.1);
      } catch {
        /* already stopped */
      }
      nodesRef.current = null;
    }

    if (vibrationRef.current) {
      clearInterval(vibrationRef.current);
      vibrationRef.current = null;
    }
    if (navigator.vibrate) navigator.vibrate(0);

    if (wakeLockRef.current) {
      wakeLockRef.current.release?.().catch(() => {});
      wakeLockRef.current = null;
    }

    setIsPlaying(false);
  }, []);

  const start = useCallback(async () => {
    const ctx = getContext();
    if (!ctx) {
      // No Web Audio: at least buzz.
      if (navigator.vibrate) navigator.vibrate(VIBRATION_PATTERN);
      return;
    }

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        /* blocked until a gesture; vibration still fires below */
      }
    }

    if (nodesRef.current) return; // already sounding

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth'; // harsher than a sine — it needs to cut through
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(SIREN.gain, ctx.currentTime + 0.08);

    // Schedule a continuous two-tone sweep well into the future.
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(SIREN.lowHz, now);
    for (let i = 0; i < 400; i += 1) {
      const t = now + i * SIREN.sweepSeconds;
      const target = i % 2 === 0 ? SIREN.highHz : SIREN.lowHz;
      osc.frequency.linearRampToValueAtTime(target, t + SIREN.sweepSeconds);
    }

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();

    nodesRef.current = { osc, gain };
    setIsPlaying(true);

    if (navigator.vibrate) {
      navigator.vibrate(VIBRATION_PATTERN);
      vibrationRef.current = setInterval(() => navigator.vibrate(VIBRATION_PATTERN), 2100);
    }

    // Keep the screen on so the flashing visual alert stays visible.
    if ('wakeLock' in navigator) {
      navigator.wakeLock
        .request('screen')
        .then((lock) => {
          wakeLockRef.current = lock;
        })
        .catch(() => {});
    }
  }, [getContext]);

  // Re-acquire the wake lock when the tab returns to the foreground.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && isPlaying && 'wakeLock' in navigator) {
        navigator.wakeLock
          .request('screen')
          .then((lock) => {
            wakeLockRef.current = lock;
          })
          .catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isPlaying]);

  useEffect(() => stop, [stop]);

  return { start, stop, arm, isPlaying, isArmed };
}
