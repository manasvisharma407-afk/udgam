import React from 'react';
import { useSafety } from '../context/SafetyContext';
import { ConnectionState } from '../hooks/useSocket';
import { GeoStatus } from '../hooks/useGeoStream';
import { formatCoordinate, formatClock } from '../lib/format';
import { Badge } from './ui';

function Dot({ tone }) {
  const colour =
    tone === 'green' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <span className="relative flex h-2 w-2" aria-hidden="true">
      {tone === 'green' ? (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${colour} opacity-60`} />
      ) : null}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${colour}`} />
    </span>
  );
}

/**
 * Honest system status.
 *
 * Each pill answers one question the user would otherwise have to guess at:
 * is my alert going to reach anyone, does the app know where I am, and is the
 * shake trigger actually armed.
 */
export default function StatusStrip() {
  const { socket, geo, shake, activeSos, isSosActive } = useSafety();

  const connTone =
    socket.state === ConnectionState.CONNECTED
      ? 'green'
      : socket.state === ConnectionState.RECONNECTING
      ? 'amber'
      : 'red';

  const connLabel =
    socket.state === ConnectionState.CONNECTED
      ? 'Network live'
      : socket.state === ConnectionState.RECONNECTING
      ? 'Reconnecting…'
      : 'Offline';

  const geoTone =
    geo.status === GeoStatus.WATCHING ? 'green' : geo.status === GeoStatus.REQUESTING ? 'amber' : 'red';

  const geoLabel =
    geo.status === GeoStatus.WATCHING
      ? geo.position?.accuracy
        ? `GPS ±${Math.round(geo.position.accuracy)}m`
        : 'GPS locked'
      : geo.status === GeoStatus.REQUESTING
      ? 'Locating…'
      : geo.status === GeoStatus.DENIED
      ? 'GPS blocked'
      : 'GPS off';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
          <Dot tone={connTone} />
          {connLabel}
          {socket.latencyMs ? (
            <span className="tabular-nums text-slate-400">{socket.latencyMs}ms</span>
          ) : null}
        </span>

        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
          <Dot tone={geoTone} />
          {geoLabel}
        </span>

        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
          <Dot tone={shake.isListening ? 'green' : 'amber'} />
          {shake.isListening ? 'Shake armed' : 'Shake off'}
        </span>
      </div>

      {isSosActive ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-bold uppercase tracking-wide text-rose-700">
              Live location streaming
            </span>
            <Badge tone="red">every 3s</Badge>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-rose-900">
            <dt className="text-rose-600">Latitude</dt>
            <dd className="text-right tabular-nums">
              {formatCoordinate(activeSos?.latest?.lat)}
            </dd>
            <dt className="text-rose-600">Longitude</dt>
            <dd className="text-right tabular-nums">
              {formatCoordinate(activeSos?.latest?.lng)}
            </dd>
            <dt className="text-rose-600">Last fix</dt>
            <dd className="text-right tabular-nums">{formatClock(activeSos?.latest?.at)}</dd>
            <dt className="text-rose-600">Fixes sent</dt>
            <dd className="text-right tabular-nums">{geo.fixCount}</dd>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
