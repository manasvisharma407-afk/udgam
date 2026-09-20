import { useCallback, useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import { BACKEND_URL } from '../lib/config';

/**
 * Socket connection.
 *
 * The socket is created once and reused. Reconnection is aggressive by design:
 * a dropped connection during an active SOS is the worst possible time to back
 * off politely, so the delay is capped at three seconds and never gives up.
 */

export const ConnectionState = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  DISCONNECTED: 'disconnected',
  FAILED: 'failed',
};

export default function useSocket({ token = null, profile = null } = {}) {
  const [state, setState] = useState(ConnectionState.CONNECTING);
  const [serverConfig, setServerConfig] = useState(null);
  const [identity, setIdentity] = useState(null);
  const [latencyMs, setLatencyMs] = useState(null);

  const socketRef = useRef(null);
  const listenersRef = useRef(new Map());

  useEffect(() => {
    const socket = io(BACKEND_URL, {
      auth: { token, profile },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      timeout: 12_000,
    });

    socketRef.current = socket;

    socket.on('connect', () => setState(ConnectionState.CONNECTED));
    socket.on('disconnect', (reason) => {
      setState(
        reason === 'io server disconnect'
          ? ConnectionState.DISCONNECTED
          : ConnectionState.RECONNECTING
      );
    });
    socket.io.on('reconnect_attempt', () => setState(ConnectionState.RECONNECTING));
    socket.on('connect_error', () => setState(ConnectionState.RECONNECTING));

    socket.on('CONNECTED', (payload) => {
      setIdentity(payload.user);
      setServerConfig(payload.config);
    });

    socket.on('SERVER_SHUTDOWN', ({ reconnectInMs }) => {
      setState(ConnectionState.RECONNECTING);
      setTimeout(() => socket.connect(), reconnectInMs || 1000);
    });

    // Round-trip measurement, shown in the connection pill. During an SOS a
    // user deserves to know whether her signal is actually getting out.
    const pinger = setInterval(() => {
      if (!socket.connected) return;
      const sentAt = Date.now();
      socket.volatile.emit('PING', null, () => {
        setLatencyMs(Date.now() - sentAt);
      });
    }, 20_000);

    return () => {
      clearInterval(pinger);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, profile]);

  /** Promise-wrapped emit with an ack timeout, so callers can await delivery. */
  const emit = useCallback(
    (event, payload, { timeoutMs = 8000 } = {}) =>
      new Promise((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket || !socket.connected) {
          reject(new Error('offline'));
          return;
        }

        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error('ack_timeout'));
        }, timeoutMs);

        socket.emit(event, payload, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (response && response.ok === false) {
            reject(Object.assign(new Error(response.message || 'request failed'), response));
          } else {
            resolve(response);
          }
        });
      }),
    []
  );

  /** Fire-and-forget: used for the 3s location cadence where a dropped frame is fine. */
  const emitVolatile = useCallback((event, payload) => {
    socketRef.current?.volatile.emit(event, payload);
  }, []);

  const on = useCallback((event, handler) => {
    const socket = socketRef.current;
    if (!socket) return () => {};
    socket.on(event, handler);
    listenersRef.current.set(handler, event);
    return () => {
      socket.off(event, handler);
      listenersRef.current.delete(handler);
    };
  }, []);

  return {
    socket: socketRef.current,
    state,
    connected: state === ConnectionState.CONNECTED,
    identity,
    serverConfig,
    latencyMs,
    emit,
    emitVolatile,
    on,
  };
}
