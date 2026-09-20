import React from 'react';
import { useSafety } from '../context/SafetyContext';
import SosButton from '../components/SosButton';
import StatusStrip from '../components/StatusStrip';
import PermissionGate from '../components/PermissionGate';
import { Badge, Button, Card, EmptyState, MeterBar, SectionTitle, ScoreRing } from '../components/ui';
import { EMERGENCY_NUMBERS } from '../lib/config';
import { formatDistance, formatRelativeTime, mapsLink, shareText } from '../lib/format';

export default function SafetyPage() {
  const {
    profile,
    activeSos,
    isSosActive,
    incomingAlerts,
    dispatchInfo,
    safetyScore,
    sosError,
    geo,
    acknowledgeAlert,
  } = useSafety();

  const liveAlerts = incomingAlerts.filter((a) => a.status !== 'resolved');

  const share = async () => {
    const position = activeSos?.latest || geo.position;
    if (!position) return;
    const text = shareText({ ...position, displayName: profile.displayName });
    if (navigator.share) {
      navigator.share({ title: 'RaahSaathi emergency', text }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(text);
    }
  };

  return (
    <div className="space-y-5">
      <StatusStrip />

      {sosError ? (
        <Card className="border-rose-300 bg-rose-50">
          <p className="text-sm font-semibold text-rose-800">{sosError}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {EMERGENCY_NUMBERS.map((n) => (
              <a
                key={n.number}
                href={`tel:${n.number}`}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white"
              >
                Call {n.label} {n.number}
              </a>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="py-2">
        <SosButton />
      </div>

      {isSosActive ? (
        <Card className="border-rose-200">
          <SectionTitle>Dispatch status</SectionTitle>
          {dispatchInfo?.undelivered ? (
            <p className="text-sm font-semibold text-rose-700">
              Your alert has not reached the network. Call 112 now.
            </p>
          ) : dispatchInfo ? (
            <p className="text-sm text-slate-700">
              Alerted{' '}
              <strong className="tabular-nums">{dispatchInfo.responderCount}</strong> verified
              female responder{dispatchInfo.responderCount === 1 ? '' : 's'} within{' '}
              {dispatchInfo.radiusKm} km.
            </p>
          ) : (
            <p className="text-sm text-slate-500">Contacting nearby responders…</p>
          )}

          {dispatchInfo?.escalate ? (
            <div className="mt-3 rounded-xl bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-900">
                No responders are in range right now. Do not wait — call emergency services.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {EMERGENCY_NUMBERS.map((n) => (
                  <a
                    key={n.number}
                    href={`tel:${n.number}`}
                    className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white"
                  >
                    {n.label} · {n.number}
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          {activeSos?.acknowledgedBy?.length ? (
            <ul className="mt-3 space-y-1.5">
              {activeSos.acknowledgedBy.map((r, i) => (
                <li
                  key={`${r.userId}-${i}`}
                  className="flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2 text-sm"
                >
                  <span className="font-semibold text-emerald-900">{r.displayName}</span>
                  <span className="tabular-nums text-xs text-emerald-700">
                    {formatDistance(r.distanceKm)} · {r.etaMinutes} min
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <Button variant="teal" size="md" className="mt-3 w-full" onClick={share}>
            Share my live location
          </Button>
        </Card>
      ) : (
        <PermissionGate />
      )}

      {/* ------------------------------------------------ area safety score */}

      {safetyScore ? (
        <Card>
          <div className="flex items-start gap-4">
            <ScoreRing score={safetyScore.score} size={64} label="now" />
            <div className="min-w-0 flex-1">
              <SectionTitle
                action={
                  <Badge
                    tone={
                      safetyScore.band === 'safe'
                        ? 'green'
                        : safetyScore.band === 'caution'
                        ? 'amber'
                        : 'red'
                    }
                  >
                    {safetyScore.band.replace('_', ' ')}
                  </Badge>
                }
              >
                Area safety
              </SectionTitle>
              <p className="text-xs leading-relaxed text-slate-500">
                {safetyScore.isNight
                  ? 'After dark, street lighting is weighted most heavily.'
                  : 'Daytime scoring weights recent incidents and crowd presence.'}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <MeterBar
              label="Street lighting"
              value={safetyScore.components?.lighting?.value}
              tone="teal"
              hint={
                safetyScore.components?.lighting?.zones?.length
                  ? safetyScore.components.lighting.zones.join(', ')
                  : 'No mapped lighting data for this area'
              }
            />
            <MeterBar
              label="Crowd density"
              value={safetyScore.components?.crowd?.value}
              tone="green"
              hint={`${safetyScore.components?.crowd?.headcount ?? 0} people nearby · ${
                safetyScore.components?.crowd?.label ?? '—'
              }`}
            />
            <MeterBar
              label="Incident-free score"
              value={100 - (safetyScore.components?.incidents?.value ?? 0)}
              tone="pink"
              hint={`${
                safetyScore.components?.incidents?.recentEvents ?? 0
              } alerts within 1 km in the last 30 days`}
            />
          </div>
        </Card>
      ) : null}

      {/* -------------------------------------------------- nearby alerts */}

      <div>
        <SectionTitle
          action={liveAlerts.length ? <Badge tone="red">{liveAlerts.length} live</Badge> : null}
        >
          Nearby alerts
        </SectionTitle>

        {liveAlerts.length === 0 ? (
          <EmptyState title="No active alerts nearby" icon="✓">
            You will be notified if a verified woman within 5 km triggers an SOS.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {liveAlerts.map((alert) => (
              <li key={alert.id}>
                <Card className="border-l-4 border-l-rose-500">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">
                        SOS · {formatDistance(alert.yourDistanceKm)} away
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatRelativeTime(alert.createdAt)} · {alert.trigger} trigger ·{' '}
                        {alert.acknowledgedBy?.length || 0} responding
                      </p>
                    </div>
                    {alert.accepted ? (
                      <Badge tone="green">Responding</Badge>
                    ) : (
                      <Button size="sm" variant="danger" onClick={() => acknowledgeAlert(alert.id)}>
                        Respond
                      </Button>
                    )}
                  </div>
                  {alert.latest ? (
                    <a
                      href={mapsLink(alert.latest)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-xs font-semibold text-brand-teal hover:underline"
                    >
                      Open live location →
                    </a>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ----------------------------------------------- emergency numbers */}

      <Card className="bg-slate-50">
        <SectionTitle>Emergency numbers</SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          {EMERGENCY_NUMBERS.map((n) => (
            <a
              key={n.number}
              href={`tel:${n.number}`}
              className="rounded-xl bg-white px-2 py-3 text-center ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50"
            >
              <span className="block text-lg font-black tabular-nums text-slate-900">
                {n.number}
              </span>
              <span className="block text-[11px] text-slate-500">{n.label}</span>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
