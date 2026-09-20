import React, { useState, useEffect } from 'react';
import { useSafety } from '../context/SafetyContext';
import { Badge, Button, Card, EmptyState, SectionTitle, Spinner, Stat } from '../components/ui';
import api from '../lib/api';
import { DEFAULT_CENTER } from '../lib/config';
import { formatDistance, formatKg } from '../lib/format';

const BASELINES = [
  { value: 'petrol_car_solo', label: 'Petrol car (solo)' },
  { value: 'diesel_car_solo', label: 'Diesel car (solo)' },
  { value: 'auto_rickshaw', label: 'Auto rickshaw' },
  { value: 'two_wheeler', label: 'Two wheeler' },
  { value: 'ev_car_solo', label: 'Electric car (solo)' },
];

const QUICK_PLACES = [
  { label: 'World Trade Park', lat: 26.8535, lng: 75.8045 },
  { label: 'Jaipur Junction', lat: 26.9196, lng: 75.788 },
  { label: 'Mahindra SEZ', lat: 26.7745, lng: 75.8285 },
  { label: 'C-Scheme', lat: 26.905, lng: 75.796 },
  { label: 'Vaishali Nagar', lat: 26.912, lng: 75.738 },
];

function isoInMinutes(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export default function HerRidesPage() {
  const { geo, setToast } = useSafety();
  const origin = geo?.position || DEFAULT_CENTER || { lat: 26.9124, lng: 75.7873 };

  const [destination, setDestination] = useState(QUICK_PLACES[0]);
  const [departInMinutes, setDepartInMinutes] = useState(15);
  const [baseline, setBaseline] = useState('petrol_car_solo');
  const [seats, setSeats] = useState(2);

  const [matches, setMatches] = useState(null);
  const [soloInfo, setSoloInfo] = useState(null);
  const [impact, setImpact] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .poolImpact({ sinceDays: 30 })
      .then(setImpact)
      .catch(() => {});
  }, []);

  const getTripPayload = () => ({
    origin: { lat: origin.lat, lng: origin.lng },
    originLabel: 'Current location',
    destination: { lat: destination.lat, lng: destination.lng },
    destinationLabel: destination.label,
    departAt: isoInMinutes(departInMinutes),
    seatsAvailable: seats,
    womenOnly: true,
    city: 'Jaipur',
    baseline,
  });

  const findMatches = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = getTripPayload();
      const result = await api.matchPool(payload);
      setMatches(result.matches || []);
      setSoloInfo({ km: result.soloDistanceKm, carbon: result.soloCarbon });
    } catch (err) {
      setError(err.message || 'Matching failed.');
    } finally {
      setLoading(false);
    }
  };

  const publishTrip = async () => {
    try {
      const payload = getTripPayload();
      await api.createPoolTrip(payload);
      setToast({ tone: 'success', message: 'Your pool is listed. Nearby women can now join.' });
      findMatches();
    } catch (err) {
      setToast({ tone: 'error', message: err.message || 'Could not publish the trip.' });
    }
  };

  const bestMatch = matches?.[0];

  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-br from-brand-green/10 to-brand-teal/10">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-900">Green Pool</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
              Share a ride with women heading the same way. Fewer cars on the road, lower fares,
              and a verified travel companion.
            </p>
          </div>
          <Badge tone="green">Women only</Badge>
        </div>
      </Card>

      {/* --------------------------------------------------- city impact */}

      {impact ? (
        <div className="grid grid-cols-2 gap-2">
          <Stat
            label="CO₂ saved"
            value={formatKg(impact.savedKg)}
            sub={`last ${impact.sinceDays} days`}
            tone="green"
          />
          <Stat
            label="Cars off road"
            value={impact.vehiclesRemoved}
            sub={`${impact.rides} pooled rides`}
            tone="teal"
          />
        </div>
      ) : null}

      {/* -------------------------------------------------- trip builder */}

      <Card>
        <SectionTitle>Where are you headed?</SectionTitle>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {QUICK_PLACES.map((place) => (
            <button
              key={place.label}
              type="button"
              onClick={() => setDestination(place)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                destination.label === place.label
                  ? 'bg-brand-green text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {place.label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <label className="block text-sm">
            <span className="flex items-baseline justify-between font-medium text-slate-700">
              Leaving in
              <span className="tabular-nums text-xs text-slate-500">{departInMinutes} min</span>
            </span>
            <input
              type="range"
              min="0"
              max="120"
              step="5"
              value={departInMinutes}
              onChange={(e) => setDepartInMinutes(Number(e.target.value))}
              className="mt-2 w-full accent-brand-green"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Seats</span>
              <select
                value={seats}
                onChange={(e) => setSeats(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} seat{n > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-700">Compared to</span>
              <select
                value={baseline}
                onChange={(e) => setBaseline(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {BASELINES.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex gap-2">
            <Button variant="green" size="md" className="flex-1" onClick={findMatches} disabled={loading}>
              {loading ? <Spinner /> : 'Find matches'}
            </Button>
            <Button variant="ghost" size="md" onClick={publishTrip}>
              List my pool
            </Button>
          </div>
        </div>
      </Card>

      {error ? (
        <Card className="border-rose-200 bg-rose-50">
          <p className="text-sm text-rose-800">{error}</p>
        </Card>
      ) : null}

      {/* ----------------------------------------------- carbon headline */}

      {bestMatch?.carbon ? (
        <Card className="border-brand-green/40 bg-brand-green/5">
          <SectionTitle>If you take the best match</SectionTitle>
          <div className="flex items-end gap-3">
            <span className="text-4xl font-black tabular-nums text-brand-green-dark">
              {formatKg(bestMatch.carbon.savedKg)}
            </span>
            <span className="pb-1.5 text-xs text-slate-600">CO₂ avoided on this trip</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl bg-white p-2">
              <div className="font-bold tabular-nums text-slate-900">
                {bestMatch.carbon.vehiclesRemoved ?? 1}
              </div>
              <div className="text-slate-500">car off road</div>
            </div>
            <div className="rounded-xl bg-white p-2">
              <div className="font-bold tabular-nums text-slate-900">
                {formatDistance(bestMatch.pooledDistanceKm || 0)}
              </div>
              <div className="text-slate-500">pooled distance</div>
            </div>
            <div className="rounded-xl bg-white p-2">
              <div className="font-bold tabular-nums text-slate-900">
                {Math.round(bestMatch.carbon.treeDaysEquivalent || 0)}
              </div>
              <div className="text-slate-500">tree-days</div>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            Based on {bestMatch.carbon.factorGPerKm ?? 0} g CO₂e/km for a {baseline.replace(/_/g, ' ')},
            against {soloInfo ? formatDistance(soloInfo.km) : '—'} driven alone.
          </p>
        </Card>
      ) : null}

      {/* ------------------------------------------------------- matches */}

      {matches !== null ? (
        <div>
          <SectionTitle
            action={matches.length ? <Badge tone="green">{matches.length} found</Badge> : null}
          >
            Matching pools
          </SectionTitle>

          {matches.length === 0 ? (
            <EmptyState title="No overlapping routes right now" icon="🌱">
              List your pool instead — other women searching this corridor will see it and can
              join before you leave.
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {matches.map((match) => (
                <li key={match.trip?.id || match.id}>
                  <Card>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">{match.trip?.hostName || 'Rider'}</p>
                        <p className="truncate text-xs text-slate-500">
                          {match.trip?.originLabel || 'Nearby'} →{' '}
                          {match.trip?.destinationLabel || 'Destination'}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Departs{' '}
                          {match.trip?.departAt
                            ? new Date(match.trip.departAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : 'Soon'}{' '}
                          · {match.trip?.seatsAvailable || 1} seat
                          {(match.trip?.seatsAvailable || 1) > 1 ? 's' : ''} free
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-lg font-black tabular-nums text-brand-green-dark">
                          {Math.round((match.matchScore || 0) * 100)}%
                        </div>
                        <div className="text-[10px] uppercase text-slate-400">match</div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
                      <div className="rounded-lg bg-slate-50 p-1.5">
                        <div className="font-bold tabular-nums text-slate-800">
                          {Math.round((match.routeOverlap || 0) * 100)}%
                        </div>
                        <div className="text-slate-500">route overlap</div>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-1.5">
                        <div className="font-bold tabular-nums text-slate-800">
                          {Math.round((match.timeCompatibility || 0) * 100)}%
                        </div>
                        <div className="text-slate-500">timing</div>
                      </div>
                      <div className="rounded-lg bg-brand-green/10 p-1.5">
                        <div className="font-bold tabular-nums text-brand-green-dark">
                          {formatKg(match.carbon?.savedKg || 0)}
                        </div>
                        <div className="text-slate-500">CO₂ saved</div>
                      </div>
                    </div>

                    <Button
                      variant="green"
                      size="md"
                      className="mt-3 w-full"
                      onClick={() =>
                        setToast({
                          tone: 'success',
                          message: `Request sent to ${match.trip?.hostName || 'host'}.`,
                        })
                      }
                    >
                      Request to join
                    </Button>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <Card className="bg-slate-50">
        <p className="text-[11px] leading-relaxed text-slate-500">
          Emission factors follow CEA grid intensity and MoRTH fleet averages. A saving is the
          difference between everyone driving separately and one shared vehicle covering the
          pooled route — detours to collect each rider are included, so the number is a floor,
          not a best case.
        </p>
      </Card>
    </div>
  );
}