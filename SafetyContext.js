import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import useSocket from '../hooks/useSocket';
import useGeoStream from '../hooks/useGeoStream';
import useShakeDetector, { MotionPermission } from '../hooks/useShakeDetector';
import useFallbackTriggers from '../hooks/useFallbackTriggers';
import useAlarm from '../hooks/useAlarm';
import api from '../lib/api';
import { LOCATION_BROADCAST_MS } from '../lib/config';

const SafetyContext = createContext(null);

/** Demo identity used until Supabase Auth is wired in front of the app. */
const DEFAULT_PROFILE = {
  displayName: 'Commuter',
  gender: 'female',
  role: 'commuter',
  availableAsResponder: true,
};

export function SafetyProvider({ children }) {
  const [profile, setProfile] = useState(() => {
    try {
      const saved = localStorage.getItem('raahsaathi:profile');
      return saved ? { ...DEFAULT_PROFILE, ...JSON.parse(saved) } : DEFAULT_PROFILE;
    } catch {
      return DEFAULT_PROFILE;
    }
  });

  const [activeSos, setActiveSos] = useState(null); // SOS *I* raised
  const [incomingAlerts, setIncomingAlerts] = useState([]); // SOS near me
  const [dispatchInfo, setDispatchInfo] = useState(null);
  const [safetyScore, setSafetyScore] = useState(null);
  const [sosError, setSosError] = useState(null);
  const [toast, setToast] = useState(null);

  const socket = useSocket({ profile });
  const alarm = useAlarm();

  const isSosActive = Boolean(activeSos);
  const hasIncoming = incomingAlerts.some((a) => a.status !== 'resolved');

  /* ------------------------------------------------------ location plumbing */

  const handleAmbientFix = useCallback(
    (fix) => {
      if (!socket.connected) return;
      socket.emitVolatile('UPDATE_LOCATION', fix);
    },
    [socket]
  );

  const activeSosIdRef = useRef(null);
  useEffect(() => {
    activeSosIdRef.current = activeSos?.id || null;
  }, [activeSos]);

  const handleStreamTick = useCallback(
    (fix) => {
      const sosId = activeSosIdRef.current;
      if (!sosId) return;
      // Volatile: a dropped frame is immediately superseded 3 seconds later
      socket.emitVolatile('SOS_LOCATION_UPDATE', { sosId, ...fix });
      setActiveSos((prev) => (prev ? { ...prev, latest: fix } : prev));
    },
    [socket]
  );

  const geo = useGeoStream({
    streaming: isSosActive,
    intervalMs: socket.serverConfig?.locationBroadcastMs || LOCATION_BROADCAST_MS,
    onFix: handleAmbientFix,
    onStreamTick: handleStreamTick,
  });

  /* ---------------------------------------------------------- raising an SOS */

  const raiseSos = useCallback(
    async ({ source = 'manual', note = null } = {}) => {
      if (activeSosIdRef.current) return null; // already live
      setSosError(null);

      // Arm audio inside the triggering gesture where possible.
      alarm.arm();

      let fix;
      try {
        fix = await geo.getCurrentFix();
      } catch {
        setSosError(
          'Location is unavailable. Turn on location access, or call 112 directly.'
        );
        return null;
      }

      const payload = {
        lat: fix.lat,
        lng: fix.lng,
        accuracy: fix.accuracy,
        trigger: source,
        note,
      };

      const optimistic = {
        id: `pending-${Date.now()}`,
        status: 'active',
        trigger: source,
        origin: fix,
        latest: fix,
        pending: true,
        createdAt: Date.now(),
        acknowledgedBy: [],
      };
      setActiveSos(optimistic);
      activeSosIdRef.current = optimistic.id;
      if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300]);

      try {
        const ack = await socket.emit('SEND_SOS', payload, { timeoutMs: 8000 });
        const confirmed = {
          ...optimistic,
          id: ack.sosId,
          pending: false,
        };
        setActiveSos(confirmed);
        activeSosIdRef.current = ack.sosId;
        setDispatchInfo({
          responderCount: ack.responderCount,
          radiusKm: ack.radiusKm,
          escalate: ack.escalateToEmergencyServices,
        });
        return confirmed;
      } catch (socketErr) {
        try {
          const result = await api.raiseSos(payload);
          const confirmed = { ...optimistic, id: result.sos.id, pending: false, viaHttp: true };
          setActiveSos(confirmed);
          activeSosIdRef.current = result.sos.id;
          setDispatchInfo({
            responderCount: result.responderCount,
            radiusKm: result.radiusKm,
            escalate: result.responderCount === 0,
          });
          return confirmed;
        } catch (httpErr) {
          setSosError(
            'Could not reach the RaahSaathi network. Call 112 now — your alert has not been delivered.'
          );
          setDispatchInfo({ responderCount: 0, escalate: true, undelivered: true });
          return null;
        }
      }
    },
    [alarm, geo, socket]
  );

  const cancelSos = useCallback(async () => {
    const sosId = activeSosIdRef.current;
    if (!sosId) return;
    try {
      await socket.emit('RESOLVE_SOS', { sosId, resolution: 'safe' });
    } catch {
      api.resolveSos(sosId).catch(() => {});
    }
    setActiveSos(null);
    activeSosIdRef.current = null;
    setDispatchInfo(null);
    setSosError(null);
    alarm.stop();
    setToast({ tone: 'success', message: 'Alert stood down. Responders notified you are safe.' });
  }, [socket, alarm]);

  /* ---------------------------------------------------------------- triggers */

  const shake = useShakeDetector(
    useCallback(() => raiseSos({ source: 'shake' }), [raiseSos]),
    { enabled: !isSosActive }
  );

  const fallback = useFallbackTriggers(
    useCallback(({ source }) => raiseSos({ source }), [raiseSos]),
    { enabled: !isSosActive }
  );

  /* ------------------------------------------------------- inbound alerts */

  useEffect(() => {
    if (!socket.socket) return undefined;

    const handleAlert = (alert) => {
      setIncomingAlerts((prev) => {
        if (prev.some((a) => a.id === alert.id)) return prev;
        return [{ ...alert, receivedAt: Date.now() }, ...prev].slice(0, 20);
      });
      alarm.start();
    };

    const handleStream = (frame) => {
      setIncomingAlerts((prev) =>
        prev.map((a) =>
          a.id === frame.sosId
            ? { ...a, latest: { lat: frame.lat, lng: frame.lng, at: frame.at } }
            : a
        )
      );
    };

    const handleResolved = ({ sosId }) => {
      setIncomingAlerts((prev) =>
        prev.map((a) => (a.id === sosId ? { ...a, status: 'resolved' } : a))
      );
      setActiveSos((prev) => (prev?.id === sosId ? null : prev));
      if (activeSosIdRef.current === sosId) activeSosIdRef.current = null;
    };

    const handleAccepted = ({ sosId, responder, totalResponders }) => {
      setActiveSos((prev) =>
        prev?.id === sosId
          ? { ...prev, acknowledgedBy: [...(prev.acknowledgedBy || []), responder] }
          : prev
      );
      setToast({
        tone: 'info',
        message: `${responder.displayName} is responding — ${responder.etaMinutes} min away (${totalResponders} total).`,
      });
    };

    // Attach listeners
    const offAlert = socket.on('EMERGENCY_ALERT_BROADCAST', handleAlert);
    const offStream = socket.on('SOS_LOCATION_STREAM', handleStream);
    const offResolved = socket.on('SOS_RESOLVED', handleResolved);
    const offAccepted = socket.on('SOS_RESPONDER_ACCEPTED', handleAccepted);

    // Safe Teardown: Handles both custom unsubscribe functions AND standard socket.off calls
    return () => {
      if (typeof offAlert === 'function') {
        offAlert();
        offStream?.();
        offResolved?.();
        offAccepted?.();
      } else if (socket.off) {
        socket.off('EMERGENCY_ALERT_BROADCAST', handleAlert);
        socket.off('SOS_LOCATION_STREAM', handleStream);
        socket.off('SOS_RESOLVED', handleResolved);
        socket.off('SOS_RESPONDER_ACCEPTED', handleAccepted);
      }
    };
  }, [socket, alarm]);

  // Silence the alarm once every nearby alert has been stood down.
  useEffect(() => {
    if (!hasIncoming && alarm.isPlaying && !isSosActive) alarm.stop();
  }, [hasIncoming, alarm, isSosActive]);

  /* -------------------------------------------------- register presence */

  const registeredRef = useRef(false);
  useEffect(() => {
    if (!socket.connected) {
      registeredRef.current = false;
      return;
    }
    if (registeredRef.current) return;

    const fix = geo.latest();
    socket
      .emit('REGISTER_USER', {
        ...profile,
        lat: fix?.lat,
        lng: fix?.lng,
        accuracy: fix?.accuracy,
      })
      .then(() => {
        registeredRef.current = true;
      })
      .catch(() => {});
  }, [socket, profile, geo]);

  /* ------------------------------------------------- ambient safety score */

  useEffect(() => {
    const position = geo.position;
    if (!position) return undefined;
    let cancelled = false;

    const load = () => {
      api
        .safetyScore({ lat: position.lat, lng: position.lng })
        .then((result) => !cancelled && setSafetyScore(result))
        .catch(() => {});
    };

    load();
    const timer = setInterval(load, 120_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [Math.round((geo.position?.lat || 0) * 300), Math.round((geo.position?.lng || 0) * 300)]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------------------------------- responder actions */

  const acknowledgeAlert = useCallback(
    async (sosId) => {
      try {
        const ack = await socket.emit('ACKNOWLEDGE_SOS', { sosId });
        setIncomingAlerts((prev) =>
          prev.map((a) => (a.id === sosId ? { ...a, accepted: true, incident: ack.incident } : a))
        );
        alarm.stop();
        setToast({ tone: 'success', message: 'You are responding. Live location is now tracking.' });
      } catch (err) {
        setToast({ tone: 'error', message: err.message || 'Could not accept the alert.' });
      }
    },
    [socket, alarm]
  );

  const dismissAlert = useCallback(
    (sosId) => {
      setIncomingAlerts((prev) => prev.filter((a) => a.id !== sosId));
      alarm.stop();
    },
    [alarm]
  );

  const updateProfile = useCallback((patch) => {
    setProfile((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem('raahsaathi:profile', JSON.stringify(next));
      } catch {
        /* private browsing */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const value = useMemo(
    () => ({
      profile,
      updateProfile,
      socket,
      geo,
      shake,
      fallback,
      alarm,
      activeSos,
      isSosActive,
      incomingAlerts,
      hasIncoming,
      dispatchInfo,
      safetyScore,
      sosError,
      toast,
      setToast,
      raiseSos,
      cancelSos,
      acknowledgeAlert,
      dismissAlert,
      motionPermission: shake.permission,
      MotionPermission,
    }),
    [
      profile,
      updateProfile,
      socket,
      geo,
      shake,
      fallback,
      alarm,
      activeSos,
      isSosActive,
      incomingAlerts,
      hasIncoming,
      dispatchInfo,
      safetyScore,
      sosError,
      toast,
      raiseSos,
      cancelSos,
      acknowledgeAlert,
      dismissAlert,
    ]
  );

  return <SafetyContext.Provider value={value}>{children}</SafetyContext.Provider>;
}

export function useSafety() {
  const ctx = useContext(SafetyContext);
  if (!ctx) throw new Error('useSafety must be used inside <SafetyProvider>');
  return ctx;
}

export default SafetyContext;