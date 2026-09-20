import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Non-sensor SOS triggers.
 *
 * Motion access is unavailable on desktop, in many in-app webviews (Instagram,
 * LinkedIn), on iOS when the user declines the prompt, and on any insecure
 * origin. Those are exactly the situations where a user might most need the
 * feature to still work, so every one of these paths is always armed —
 * regardless of whether the accelerometer is available.
 *
 *  - Long-press the SOS button for `holdMs`
 *  - Five rapid taps anywhere on the panic surface
 *  - Triple-press Escape, or hold Space (keyboard / desktop)
 *  - Volume-key presses where the browser surfaces them (Android TV, some
 *    Android browsers expose AudioVolume keycodes)
 */

const DEFAULTS = {
  holdMs: 1500,
  tapCount: 5,
  tapWindowMs: 2500,
  keyPressCount: 3,
  keyWindowMs: 2000,
};

export default function useFallbackTriggers(onTrigger, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const { enabled = true } = options;

  const [holdProgress, setHoldProgress] = useState(0);
  const [tapProgress, setTapProgress] = useState(0);

  const onTriggerRef = useRef(onTrigger);
  const holdTimerRef = useRef(null);
  const holdRafRef = useRef(null);
  const tapsRef = useRef([]);
  const keyPressesRef = useRef([]);

  useEffect(() => {
    onTriggerRef.current = onTrigger;
  }, [onTrigger]);

  const fire = useCallback((source) => {
    onTriggerRef.current?.({ source, at: Date.now() });
  }, []);

  /* ------------------------------------------------------------ long press */

  const cancelHold = useCallback(() => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (holdRafRef.current) cancelAnimationFrame(holdRafRef.current);
    holdTimerRef.current = null;
    holdRafRef.current = null;
    setHoldProgress(0);
  }, []);

  const startHold = useCallback(() => {
    if (!enabled || holdTimerRef.current) return;
    const startedAt = Date.now();

    const tick = () => {
      const pct = Math.min(1, (Date.now() - startedAt) / cfg.holdMs);
      setHoldProgress(pct);
      if (pct < 1) holdRafRef.current = requestAnimationFrame(tick);
    };
    holdRafRef.current = requestAnimationFrame(tick);

    holdTimerRef.current = setTimeout(() => {
      cancelHold();
      // Confirm physically that the press registered, for users who cannot
      // look at the screen.
      if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
      fire('button_hold');
    }, cfg.holdMs);
  }, [enabled, cfg.holdMs, cancelHold, fire]);

  /* ----------------------------------------------------------- rapid taps */

  const registerTap = useCallback(() => {
    if (!enabled) return;
    const now = Date.now();
    const taps = [...tapsRef.current, now].filter((t) => now - t <= cfg.tapWindowMs);
    tapsRef.current = taps;
    setTapProgress(taps.length);

    if (taps.length >= cfg.tapCount) {
      tapsRef.current = [];
      setTapProgress(0);
      if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
      fire('fallback');
    }
  }, [enabled, cfg.tapCount, cfg.tapWindowMs, fire]);

  /* ------------------------------------------------- keyboard / volume keys */

  useEffect(() => {
    if (!enabled) return undefined;

    const handleKeyDown = (event) => {
      // Never hijack typing.
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;

      const isVolumeKey =
        event.key === 'AudioVolumeUp' ||
        event.key === 'AudioVolumeDown' ||
        event.keyCode === 174 ||
        event.keyCode === 175;

      if (event.key === 'Escape' || isVolumeKey) {
        const now = Date.now();
        const presses = [...keyPressesRef.current, now].filter(
          (t) => now - t <= cfg.keyWindowMs
        );
        keyPressesRef.current = presses;

        if (presses.length >= cfg.keyPressCount) {
          keyPressesRef.current = [];
          fire(isVolumeKey ? 'volume_keys' : 'fallback');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, cfg.keyPressCount, cfg.keyWindowMs, fire]);

  useEffect(() => cancelHold, [cancelHold]);

  return {
    holdProgress,
    tapProgress,
    tapTarget: cfg.tapCount,
    startHold,
    cancelHold,
    registerTap,
    /** Spread onto the panic surface to wire every gesture at once. */
    bindPanicSurface: () => ({
      onPointerDown: startHold,
      onPointerUp: cancelHold,
      onPointerLeave: cancelHold,
      onPointerCancel: cancelHold,
      onClick: registerTap,
      onContextMenu: (e) => e.preventDefault(),
    }),
  };
}
