import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Geolocation with two modes.
 *
 * Ambient: a low-power watch that keeps presence roughly fresh so the user can
 * be matched as a responder without draining the battery.
 *
 * Streaming (SOS active): `enableHighAccuracy`, and every fix is pushed on a
 * fixed 3-second cadence. The cadence is decoupled from the sensor: GPS can
 * deliver 1 Hz or 0.1 Hz depending on the device and sky view, so we keep the
 * newest fix in a ref and emit on an interval. That guarantees the responder's
 * map updates predictably instead of stalling silently when the fix rate drops.
 */

export const GeoStatus = {
  IDLE: 'idle',
  REQUESTING: 'requesting',
  WATCHING: 'watching',
  DENIED: 'denied',
  UNAVAILABLE: 'unavailable',
  ERROR: 'error',
};

const AMBIENT_OPTIONS = {
  enableHighAccuracy: false,
  maximumAge: 30_000,
  timeout: 20_000,
};

const SOS_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 0, // never reuse a cached fix during an emergency
  timeout: 15_000,
};

export default function useGeoStream({
  streaming = false,
  intervalMs = 3000,
  onFix,
  onStreamTick,
} = {}) {
  const [position, setPosition] = useState(null);
  const [status, setStatus] = useState(GeoStatus.IDLE);
  const [error, setError] = useState(null);
  const [fixCount, setFixCount] = useState(0);

  const watchIdRef = useRef(null);
  const latestRef = useRef(null);
  const tickRef = useRef(null);
  const onFixRef = useRef(onFix);
  const onStreamTickRef = useRef(onStreamTick);

  useEffect(() => {
    onFixRef.current = onFix;
  }, [onFix]);
  useEffect(() => {
    onStreamTickRef.current = onStreamTick;
  }, [onStreamTick]);

  const toFix = (pos) => ({
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    speed: Number.isFinite(pos.coords.speed) ? pos.coords.speed : null,
    heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
    at: pos.timestamp || Date.now(),
  });

  /* ------------------------------------------------------------- the watch */

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus(GeoStatus.UNAVAILABLE);
      return undefined;
    }

    setStatus(GeoStatus.REQUESTING);

    const handleSuccess = (pos) => {
      const fix = toFix(pos);
      latestRef.current = fix;
      setPosition(fix);
      setStatus(GeoStatus.WATCHING);
      setError(null);
      setFixCount((n) => n + 1);
      onFixRef.current?.(fix);
    };

    const handleError = (err) => {
      setError({ code: err.code, message: err.message });
      // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
      if (err.code === 1) setStatus(GeoStatus.DENIED);
      else if (err.code === 2) setStatus(GeoStatus.UNAVAILABLE);
      // A timeout is not fatal: watchPosition keeps trying, so we hold the
      // previous status rather than telling the user location is broken.
      else if (!latestRef.current) setStatus(GeoStatus.ERROR);
    };

    const id = navigator.geolocation.watchPosition(
      handleSuccess,
      handleError,
      streaming ? SOS_OPTIONS : AMBIENT_OPTIONS
    );
    watchIdRef.current = id;

    return () => {
      navigator.geolocation.clearWatch(id);
      watchIdRef.current = null;
    };
    // Re-subscribing when `streaming` flips is intentional: it swaps the
    // accuracy profile on the underlying watch.
  }, [streaming]);

  /* ---------------------------------------------- fixed-cadence broadcasting */

  useEffect(() => {
    if (!streaming) {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      return undefined;
    }

    // Emit immediately so the responder map does not wait a full interval.
    if (latestRef.current) onStreamTickRef.current?.(latestRef.current);

    tickRef.current = setInterval(() => {
      const fix = latestRef.current;
      if (!fix) return;
      onStreamTickRef.current?.({ ...fix, emittedAt: Date.now() });
    }, intervalMs);

    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [streaming, intervalMs]);

  /** One-shot high-accuracy read, used at the moment an SOS is raised. */
  const getCurrentFix = useCallback(
    () =>
      new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Geolocation unavailable'));
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const fix = toFix(pos);
            latestRef.current = fix;
            setPosition(fix);
            resolve(fix);
          },
          (err) => {
            // Fall back to the last known fix rather than failing the SOS.
            if (latestRef.current) resolve(latestRef.current);
            else reject(err);
          },
          SOS_OPTIONS
        );
      }),
    []
  );

  return {
    position,
    latest: () => latestRef.current,
    status,
    error,
    fixCount,
    getCurrentFix,
    isTracking: status === GeoStatus.WATCHING,
  };
}
