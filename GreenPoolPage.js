import React, { useEffect, useState } from 'react';
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

export default function GreenPoolPage() {
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
    <div className="space-y-6 p-4 max-w-4xl mx-auto">
      <SectionTitle
        title="Green Pool"
        subtitle="Shared eco-friendly rides tailored for women safety and carbon reduction."
      />

      {/* Impact Stats standard banner */}
      {impact && (
        <Card className="grid grid-cols-2 md:grid-cols-3 gap-4 bg-emerald-50/50 border-emerald-100">
          <Stat label="Community Carbon Saved" value={formatKg(impact.totalCo2SavedKg || 0)} />
          <Stat label="Shared Trips (30d)" value={impact.totalTrips || 0} />
          <Stat label="Total Distance" value={formatDistance(impact.totalKm || 0)} />
        </Card>
      )}

      {/* Trip Config form */}
      <Card className="space-y-4">
        <h3 className="font-semibold text-slate-800">Plan Your Shared Ride</h3>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Select Destination</label>
          <div className="flex flex-wrap gap-2">
            {QUICK_PLACES.map((place) => (
              <button
                key={place.label}
                onClick={() => setDestination(place)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  destination.label === place.label
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {place.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Departure</label>
            <select
              value={departInMinutes}
              onChange={(e) => setDepartInMinutes(Number(e.target.value))}
              className="w-full text-sm rounded-lg border-slate-200 p-2 border"
            >
              <option value={10}>In 10 minutes</option>
              <option value={15}>In 15 minutes</option>
              <option value={30}>In 30 minutes</option>
              <option value={60}>In 1 hour</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Baseline Vehicle</label>
            <select
              value={baseline}
              onChange={(e) => setBaseline(e.target.value)}
              className="w-full text-sm rounded-lg border-slate-200 p-2 border"
            >
              {BASELINES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Seats Offered/Needed</label>
            <input
              type="number"
              min="1"
              max="4"
              value={seats}
              onChange={(e) => setSeats(Number(e.target.value))}
              className="w-full text-sm rounded-lg border-slate-200 p-2 border"
            />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button onClick={findMatches} disabled={loading} className="flex-1">
            {loading ? <Spinner /> : 'Find Green Matches'}
          </Button>
          <Button onClick={publishTrip} variant="outline" className="flex-1">
            Publish Offer
          </Button>
        </div>
      </Card>

      {/* Matching Results */}
      {error && <p className="text-sm text-rose-600">{error}</p>}

      {matches && (
        <Card className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-semibold text-slate-800">Available Matches</h3>
            {soloInfo && (
              <Badge tone="emerald">
                Est. Solo Emission: {formatKg(soloInfo.carbon)}
              </Badge>
            )}
          </div>

          {matches.length === 0 ? (
            <EmptyState
              title="No rides found"
              description="No active pools match your exact route. Try publishing your trip to let others find you."
            />
          ) : (
            <div className="space-y-3">
              {matches.map((m, idx) => (
                <div
                  key={m.id || idx}
                  className="p-3 border rounded-lg flex items-center justify-between hover:bg-slate-50"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-slate-800">
                        {m.driverName || 'Community Member'}
                      </span>
                      {m.womenOnly && <Badge tone="teal">Women Only</Badge>}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {m.destinationLabel} · {m.seatsAvailable} seats left
                    </p>
                  </div>
                  <Button size="sm" onClick={() => setToast({ tone: 'info', message: 'Requested to join pool.' })}>
                    Join Pool
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}