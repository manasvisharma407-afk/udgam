import React, { useMemo, useState } from 'react';

import { useSafety } from '../context/SafetyContext';
import { Card, SectionTitle } from '../components/ui';
import FleetOperationsDashboard from '../components/FleetOperationsDashboard';

/**
 * Smart Route tab: route optimisation with live traffic and safety indicators,
 * a privacy-preserving safety heat map, and carbon-savings rewards.
 *
 * Ported from RaahSaathi_FINAL, where this composition lived in main.jsx.
 * The sample trip and heat-map window are Jaipur (the pilot city) and line up
 * with the demo carpool bookings the backend seeds in demo mode.
 */

const SAMPLE_TRIP = {
  origin: { name: 'Sample pickup · Jaipur', lat: 26.9124, lng: 75.7873 },
  destination: { name: 'Sample destination · Jaipur', lat: 26.8467, lng: 75.8063 },
};

const HEATMAP_BOUNDS = { north: 26.94, south: 26.82, east: 75.86, west: 75.74 };

const PASSENGER_ID_KEY = 'raahsaathi:passengerId';

const randomId = () =>
  `rider-${(window.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).slice(0, 12)}`;

/**
 * Stable per-device rider id for the carpool pool and leaderboard.
 *
 * The app has no sign-in yet (see README "Known gaps"), so the profile carries
 * no user id; once Supabase Auth lands `profile.userId` takes over automatically.
 */
function usePassengerId(profile) {
  return useMemo(() => {
    if (profile?.userId) return String(profile.userId);
    try {
      let id = localStorage.getItem(PASSENGER_ID_KEY);
      if (!id) {
        id = randomId();
        localStorage.setItem(PASSENGER_ID_KEY, id);
      }
      return id;
    } catch {
      return randomId(); // private browsing: per-visit id
    }
  }, [profile?.userId]);
}

export default function FleetOperationsPage() {
  const { profile } = useSafety();
  const passengerId = usePassengerId(profile);
  const [impact, setImpact] = useState(null);
  // Fixed for the visit: it is a dependency of the optimiser's fetch effect.
  const [requestedAt] = useState(() => new Date().toISOString());

  const booking = useMemo(
    () => ({
      id: `trip-${passengerId}`,
      passengerId,
      origin: SAMPLE_TRIP.origin,
      destination: SAMPLE_TRIP.destination,
      requestedAt,
      impact,
      onImpactChange: setImpact,
    }),
    [passengerId, requestedAt, impact]
  );

  return (
    <div className="space-y-4">
      <SectionTitle>Smart Route</SectionTitle>

      <Card className="text-xs leading-relaxed text-slate-600">
        <strong className="text-slate-800">Sample trip loaded.</strong> Search a pickup and
        destination to plan your own. Carpooling always needs both passengers to confirm.
      </Card>

      <FleetOperationsDashboard booking={booking} heatmapBounds={HEATMAP_BOUNDS} />

      <p className="px-1 text-[11px] leading-relaxed text-slate-400">
        Safety values are indicators based on available project signals; they are not guarantees
        of safety. Provider responses are labelled live only when external credentials are
        configured.
      </p>
    </div>
  );
}
