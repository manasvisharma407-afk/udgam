import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Three-shake SOS trigger.
 *
 * The naive version (magnitude > 22 three times inside a rolling window) fires
 * constantly in a handbag and on a bus. This implementation fixes four things:
 *
 * 1. **Gravity removal.** `accelerationIncludingGravity` always reads ~9.81 at
 *    rest. We high-pass filter it so the threshold applies to *deliberate*
 *    motion, not orientation. Where the device exposes linear `acceleration`
 *    (gravity already removed) we prefer that and skip the filter.
 *
 * 2. **Direction reversal.** A shake is a back-and-forth. We require the
 *    dominant-axis sign to flip between peaks, which rejects a single jolt
 *    (dropping the phone, a pothole) no matter how hard it is.
 *
 * 3. **Refractory period.** After a peak is counted, further samples are
 *    ignored for REFRACTORY_MS. Without this, one 300 ms shake registers as
 *    fifteen peaks at 60 Hz and fires instantly.
 *
 * 4. **Window expiry + cooldown.** Peaks must land inside WINDOW_MS of each
 *    other, and after a trigger the detector sleeps for COOLDOWN_MS so the
 *    residual motion of pulling the phone out of a pocket cannot re-fire it.
 */

const DEFAULTS = {
  threshold: 14, // m/s² of gravity-free acceleration
  requiredShakes: 3,
  windowMs: 1600, // all peaks must land inside this rolling window
  refractoryMs: 120, // minimum gap between counted peaks
  cooldownMs: 6000, // dead time after a successful trigger
  highPassAlpha: 0.85,
};

export const MotionPermission = {
  UNKNOWN: 'unknown',
  UNSUPPORTED: 'unsupported',
  PROMPT_REQUIRED: 'prompt_required',
  GRANTED: 'granted',
  DENIED: 'denied',
};

function needsExplicitPermission() {
  return (
    typeof window !== 'undefined' &&
    typeof window.DeviceMotionEvent !== 'undefined' &&
    typeof window.DeviceMotionEvent.requestPermission === 'function'
  );
}

export default function useShakeDetector(onShake, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const { enabled = true } = options;

  const [permission, setPermission] = useState(MotionPermission.UNKNOWN);
  const [shakeProgress, setShakeProgress] = useState(0);
  const [lastMagnitude, setLastMagnitude] = useState(0);
  const [isListening, setIsListening] = useState(false);

  // Refs everywhere: this handler runs at 60Hz and must not trigger renders.
  const onShakeRef = useRef(onShake);
  const gravityRef = useRef({ x: 0, y: 0, z: 0 });
  const peaksRef = useRef([]); // [{ at, axis, sign }]
  const lastPeakAtRef = useRef(0);
  const cooldownUntilRef = useRef(0);
  const samplesSeenRef = useRef(0);

  useEffect(() => {
    onShakeRef.current = onShake;
  }, [onShake]);

  /* ------------------------------------------------- capability detection */

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (typeof window.DeviceMotionEvent === 'undefined') {
      setPermission(MotionPermission.UNSUPPORTED);
      return;
    }
    if (needsExplicitPermission()) {
      setPermission(MotionPermission.PROMPT_REQUIRED);
      return;
    }
    // Android/Chrome: no prompt, but the sensor is only delivered over HTTPS.
    const secure = window.isSecureContext || window.location.hostname === 'localhost';
    setPermission(secure ? MotionPermission.GRANTED : MotionPermission.UNSUPPORTED);
  }, []);

  /**
   * iOS 13+ gate. `requestPermission()` throws unless it is called from inside
   * a real user gesture, which is why this is exposed as a function the UI
   * wires to a button rather than something we call on mount.
   */
  const requestPermission = useCallback(async () => {
    if (!needsExplicitPermission()) {
      const secure = window.isSecureContext || window.location.hostname === 'localhost';
      const next = secure ? MotionPermission.GRANTED : MotionPermission.UNSUPPORTED;
      setPermission(next);
      return next;
    }

    try {
      const result = await window.DeviceMotionEvent.requestPermission();
      const next = result === 'granted' ? MotionPermission.GRANTED : MotionPermission.DENIED;
      setPermission(next);

      // Some iOS builds also gate orientation separately; request it while we
      // still hold the user gesture so the compass heading works later.
      if (
        next === MotionPermission.GRANTED &&
        typeof window.DeviceOrientationEvent?.requestPermission === 'function'
      ) {
        window.DeviceOrientationEvent.requestPermission().catch(() => {});
      }

      return next;
    } catch (err) {
      // Thrown when not in a user gesture, or in an embedded webview.
      setPermission(MotionPermission.DENIED);
      return MotionPermission.DENIED;
    }
  }, []);

  const reset = useCallback(() => {
    peaksRef.current = [];
    setShakeProgress(0);
  }, []);

  /* ----------------------------------------------------- the detector loop */

  useEffect(() => {
    if (!enabled || permission !== MotionPermission.GRANTED) {
      setIsListening(false);
      return undefined;
    }

    const handleMotion = (event) => {
      const now = Date.now();
      if (now < cooldownUntilRef.current) return;

      // Prefer gravity-free readings when the platform provides them.
      const linear = event.acceleration;
      const raw = event.accelerationIncludingGravity;
      let ax;
      let ay;
      let az;

      if (linear && (linear.x !== null || linear.y !== null || linear.z !== null)) {
        ax = linear.x || 0;
        ay = linear.y || 0;
        az = linear.z || 0;
      } else if (raw && (raw.x !== null || raw.y !== null || raw.z !== null)) {
        // High-pass filter: estimate gravity, subtract it out.
        const a = cfg.highPassAlpha;
        const g = gravityRef.current;
        g.x = a * g.x + (1 - a) * (raw.x || 0);
        g.y = a * g.y + (1 - a) * (raw.y || 0);
        g.z = a * g.z + (1 - a) * (raw.z || 0);
        ax = (raw.x || 0) - g.x;
        ay = (raw.y || 0) - g.y;
        az = (raw.z || 0) - g.z;

        // Let the gravity estimate settle before trusting any reading.
        samplesSeenRef.current += 1;
        if (samplesSeenRef.current < 12) return;
      } else {
        return;
      }

      const magnitude = Math.sqrt(ax * ax + ay * ay + az * az);
      setLastMagnitude(Math.round(magnitude * 10) / 10);

      if (magnitude < cfg.threshold) return;
      if (now - lastPeakAtRef.current < cfg.refractoryMs) return;

      // Which axis dominated this peak, and in which direction?
      const abs = [Math.abs(ax), Math.abs(ay), Math.abs(az)];
      const axis = abs.indexOf(Math.max(...abs));
      const sign = Math.sign([ax, ay, az][axis]) || 1;

      const peaks = peaksRef.current.filter((p) => now - p.at <= cfg.windowMs);
      const previous = peaks[peaks.length - 1];

      // A genuine shake reverses direction. Same axis, same sign, in quick
      // succession is sustained vibration (a bus, a washing machine) — replace
      // the peak rather than counting it.
      if (previous && previous.axis === axis && previous.sign === sign) {
        peaks[peaks.length - 1] = { at: now, axis, sign };
      } else {
        peaks.push({ at: now, axis, sign });
      }

      peaksRef.current = peaks;
      lastPeakAtRef.current = now;
      setShakeProgress(Math.min(peaks.length, cfg.requiredShakes));

      if (peaks.length >= cfg.requiredShakes) {
        peaksRef.current = [];
        cooldownUntilRef.current = now + cfg.cooldownMs;
        setShakeProgress(0);
        onShakeRef.current?.({ magnitude, at: now, source: 'shake' });
      }
    };

    window.addEventListener('devicemotion', handleMotion, { passive: true });
    setIsListening(true);

    // Decay the progress ring when the user stops mid-sequence.
    const decay = setInterval(() => {
      const now = Date.now();
      const live = peaksRef.current.filter((p) => now - p.at <= cfg.windowMs);
      if (live.length !== peaksRef.current.length) {
        peaksRef.current = live;
        setShakeProgress(live.length);
      }
    }, 300);

    return () => {
      window.removeEventListener('devicemotion', handleMotion);
      clearInterval(decay);
      setIsListening(false);
    };
  }, [
    enabled,
    permission,
    cfg.threshold,
    cfg.requiredShakes,
    cfg.windowMs,
    cfg.refractoryMs,
    cfg.cooldownMs,
    cfg.highPassAlpha,
  ]);

  return {
    permission,
    requestPermission,
    isListening,
    shakeProgress,
    requiredShakes: cfg.requiredShakes,
    lastMagnitude,
    reset,
    supported: permission !== MotionPermission.UNSUPPORTED,
  };
}
