import React from 'react';
import { useSafety } from '../context/SafetyContext';
import { MotionPermission } from '../hooks/useShakeDetector';
import { GeoStatus } from '../hooks/useGeoStream';
import { Button, Card } from './ui';

/**
 * Permission prompts.
 *
 * iOS 13+ will only grant motion access from inside a user gesture, which is
 * why this is a button rather than an automatic request on mount. Each state
 * explains what stops working and what still works — a user who declines
 * should understand she still has the button, not think the app is broken.
 */
export default function PermissionGate() {
  const { shake, geo, alarm, motionPermission } = useSafety();

  const needsMotion = motionPermission === MotionPermission.PROMPT_REQUIRED;
  const motionDenied = motionPermission === MotionPermission.DENIED;
  const motionUnsupported = motionPermission === MotionPermission.UNSUPPORTED;
  const geoDenied = geo.status === GeoStatus.DENIED;
  const geoUnavailable = geo.status === GeoStatus.UNAVAILABLE;

  const enableAll = async () => {
    // Both requests must fire inside this single gesture.
    await alarm.arm();
    await shake.requestPermission();
    geo.getCurrentFix().catch(() => {});
  };

  if (geoDenied) {
    return (
      <Card className="border-rose-200 bg-rose-50/80">
        <h3 className="text-sm font-bold text-rose-800">Location access is blocked</h3>
        <p className="mt-1 text-xs leading-relaxed text-rose-700">
          Without location, an SOS cannot tell anyone where you are. Enable location for this
          site in your browser settings, then reload. Until then, use the emergency numbers
          below.
        </p>
      </Card>
    );
  }

  if (needsMotion) {
    return (
      <Card className="border-brand-pink/30 bg-brand-pink/5">
        <h3 className="text-sm font-bold text-slate-800">Turn on shake-to-alert</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          iOS needs your permission before RaahSaathi can read the motion sensor. This also
          unlocks the alarm sound so it can play instantly during an emergency.
        </p>
        <Button size="md" className="mt-3 w-full" onClick={enableAll}>
          Enable motion & alarm
        </Button>
      </Card>
    );
  }

  if (motionDenied || motionUnsupported) {
    return (
      <Card className="border-amber-200 bg-amber-50/70">
        <h3 className="text-sm font-bold text-amber-900">
          {motionDenied ? 'Shake detection is off' : 'No motion sensor here'}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-amber-800">
          {motionDenied
            ? 'You declined motion access, so shaking will not raise an alert.'
            : 'This device or browser does not expose a motion sensor (common on desktop and inside in-app browsers).'}{' '}
          Every other trigger still works: hold the SOS button for 1.5 seconds, tap it five
          times quickly, or press Escape three times.
        </p>
        {motionDenied ? (
          <Button variant="ghost" size="sm" className="mt-3" onClick={enableAll}>
            Try again
          </Button>
        ) : null}
      </Card>
    );
  }

  if (geoUnavailable) {
    return (
      <Card className="border-amber-200 bg-amber-50/70">
        <h3 className="text-sm font-bold text-amber-900">Waiting for a GPS fix</h3>
        <p className="mt-1 text-xs leading-relaxed text-amber-800">
          Your location has not resolved yet. Indoors this can take a moment. The SOS button
          still works and will send your last known position.
        </p>
      </Card>
    );
  }

  if (!alarm.isArmed) {
    return (
      <Card className="border-brand-teal/30 bg-brand-teal/5">
        <h3 className="text-sm font-bold text-slate-800">Unlock the alarm sound</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          Browsers block audio until you interact with the page. One tap now means the siren
          plays the instant an alert arrives.
        </p>
        <Button variant="teal" size="md" className="mt-3 w-full" onClick={enableAll}>
          Arm alarm
        </Button>
      </Card>
    );
  }

  return null;
}
