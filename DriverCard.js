import React, { useState } from 'react';
import { Badge, Button, Card, ScoreRing } from './ui';
import { formatDistance, formatEta } from '../lib/format';

const BADGE_ICON = {
  govt_id: '🪪',
  background: '🛡️',
  police: '👮',
  training: '🎓',
  her_rides: '💗',
  gps: '📡',
};

/**
 * Driver profile.
 *
 * Verification is shown as discrete, named checks rather than a single "verified"
 * tick. A rider deciding whether to get into a stranger's car at 11pm deserves
 * to know exactly which checks were done and when — an opaque badge is worth
 * very little at that moment.
 */
export default function DriverCard({ driver, onBook }) {
  const [expanded, setExpanded] = useState(false);
  const v = driver.verification || {};

  const checkedAt = v.backgroundCheckedAt
    ? new Date(v.backgroundCheckedAt).toLocaleDateString(undefined, {
        month: 'short',
        year: 'numeric',
      })
    : null;

  return (
    <Card className="overflow-hidden">
      <div className="flex gap-3">
        <div className="relative shrink-0">
          {driver.photoUrl ? (
            <img
              src={driver.photoUrl}
              alt=""
              className="h-14 w-14 rounded-2xl object-cover ring-2 ring-brand-pink/20"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-pink/10 text-lg font-bold text-brand-pink">
              {(driver.displayName || '?').charAt(0)}
            </div>
          )}
          {v.eligible ? (
            <span
              className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white ring-2 ring-white"
              title="All verification checks passed"
            >
              ✓
            </span>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate font-bold text-slate-900">{driver.displayName}</h3>
              <p className="truncate text-xs text-slate-500">
                {driver.vehicle?.colour} {driver.vehicle?.make} {driver.vehicle?.model} ·{' '}
                <span className="font-mono">{driver.vehicle?.plateMasked}</span>
              </p>
            </div>
            <ScoreRing score={driver.safetyScore} size={48} label="safety" />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
            <span className="font-semibold tabular-nums">★ {driver.rating?.toFixed(2)}</span>
            <span className="text-slate-300">·</span>
            <span className="tabular-nums">{driver.completedTrips?.toLocaleString()} trips</span>
            {driver.distanceKm !== null ? (
              <>
                <span className="text-slate-300">·</span>
                <span className="tabular-nums">
                  {formatDistance(driver.distanceKm)} away · {formatEta(driver.etaMinutes)}
                </span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(v.badges || []).map((badge) => (
          <Badge key={badge.key} tone={badge.key === 'her_rides' ? 'pink' : 'green'}>
            <span aria-hidden="true">{BADGE_ICON[badge.key] || '✓'}</span>
            {badge.label}
          </Badge>
        ))}
        {driver.complaints12m > 0 ? (
          <Badge tone="amber">{driver.complaints12m} complaint(s) in 12 months</Badge>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="mt-3 text-xs font-semibold text-brand-teal hover:underline"
        aria-expanded={expanded}
      >
        {expanded ? 'Hide verification detail' : 'See verification detail'}
      </button>

      {expanded ? (
        <dl className="mt-2 space-y-1.5 rounded-xl bg-slate-50 p-3 text-xs">
          <Row label="Government ID" value={v.idVerified ? 'Verified' : 'Not on file'} ok={v.idVerified} />
          <Row
            label="Background check"
            value={
              v.backgroundCheck === 'cleared'
                ? `Cleared${checkedAt ? ` · ${checkedAt}` : ''}`
                : v.backgroundCheck || 'Pending'
            }
            ok={v.backgroundCheck === 'cleared'}
          />
          <Row
            label="Police verification"
            value={v.policeVerification ? 'On file' : 'Not submitted'}
            ok={v.policeVerification}
          />
          <Row
            label="Driving licence"
            value={v.licenceValid ? 'Valid' : 'Expired or missing'}
            ok={v.licenceValid}
          />
          <Row
            label="Safety training"
            value={v.safetyTraining ? 'Completed' : 'Not completed'}
            ok={v.safetyTraining}
          />
          <Row
            label="Languages"
            value={(driver.languages || []).join(', ') || '—'}
            ok={null}
          />
        </dl>
      ) : null}

      {onBook ? (
        <Button
          variant={v.eligible ? 'primary' : 'ghost'}
          size="md"
          className="mt-3 w-full"
          disabled={!v.eligible}
          onClick={() => onBook(driver)}
        >
          {v.eligible ? 'Request this ride' : 'Verification incomplete'}
        </Button>
      ) : null}
    </Card>
  );
}

function Row({ label, value, ok }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd
        className={`text-right font-medium ${
          ok === null ? 'text-slate-700' : ok ? 'text-emerald-700' : 'text-amber-700'
        }`}
      >
        {ok === null ? '' : ok ? '✓ ' : '○ '}
        {value}
      </dd>
    </div>
  );
}
