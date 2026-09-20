import React, { useEffect, useState } from 'react';
import { useSafety } from '../context/SafetyContext';
import { Button } from './ui';
import { formatDistance, formatEta, formatRelativeTime, mapsLink } from '../lib/format';

/**
 * High-visibility inbound alert.
 *
 * Takes over the screen and flashes, because the design assumption is that the
 * phone is in a pocket or bag and the user needs to notice *now*. The flash is
 * suppressed for anyone who has asked for reduced motion; the alarm sound and
 * the vibration still fire, so the alert is never silently dropped for them.
 */
export default function AlertOverlay() {
  const { incomingAlerts, acknowledgeAlert, dismissAlert, alarm } = useSafety();
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(query.matches);
    const listener = (e) => setReduceMotion(e.matches);
    query.addEventListener?.('change', listener);
    return () => query.removeEventListener?.('change', listener);
  }, []);

  const alert = incomingAlerts.find((a) => a.status !== 'resolved' && !a.accepted);
  if (!alert) return null;

  const position = alert.latest || alert.origin;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Nearby emergency alert"
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${
        reduceMotion ? 'bg-rose-700/95' : 'animate-alert-flash'
      }`}
    >
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <span
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-rose-100 text-2xl ${
              reduceMotion ? '' : 'animate-pulse'
            }`}
            aria-hidden="true"
          >
            !
          </span>
          <div>
            <h2 className="text-lg font-black leading-tight text-rose-700">
              Emergency nearby
            </h2>
            <p className="text-xs text-slate-500">
              {formatRelativeTime(alert.createdAt)} · triggered by {alert.trigger}
            </p>
          </div>
        </div>

        <dl className="mb-4 space-y-2 rounded-2xl bg-slate-50 p-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Distance from you</dt>
            <dd className="font-semibold tabular-nums text-slate-900">
              {formatDistance(alert.yourDistanceKm)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Estimated arrival</dt>
            <dd className="font-semibold tabular-nums text-slate-900">
              {formatEta(alert.yourEtaMinutes)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Responders accepted</dt>
            <dd className="font-semibold tabular-nums text-slate-900">
              {alert.acknowledgedBy?.length || 0}
            </dd>
          </div>
        </dl>

        {alert.note ? (
          <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{alert.note}</p>
        ) : null}

        <div className="space-y-2">
          <Button
            variant="danger"
            size="lg"
            className="w-full"
            onClick={() => acknowledgeAlert(alert.id)}
          >
            I am responding
          </Button>

          {position ? (
            <a
              href={mapsLink(position)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center rounded-xl bg-brand-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-teal-dark"
            >
              Open live location in Maps
            </a>
          ) : null}

          <div className="flex gap-2">
            <Button variant="ghost" size="md" className="flex-1" onClick={alarm.stop}>
              Silence alarm
            </Button>
            <Button
              variant="ghost"
              size="md"
              className="flex-1"
              onClick={() => dismissAlert(alert.id)}
            >
              Can't help
            </Button>
          </div>
        </div>

        <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-400">
          Only verified female responders within 5 km receive this alert. If you cannot reach
          her safely, call 112 and dismiss.
        </p>
      </div>
    </div>
  );
}
