import React, { useCallback, useEffect, useRef, useState } from 'react';
import '../styles/fleet-route-optimizer.css';
import GoogleRouteMap from './GoogleRouteMap';
import { BACKEND_URL as API } from '../lib/config';


function minutes(sec) { return Math.max(1, Math.ceil(Number(sec || 0) / 60)); }
function km(distance) { const n = Number(distance); return Number.isFinite(n) ? n.toFixed(1) : '—'; }
function scoreLabel(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'Indicator unavailable';
  if (n >= 80) return 'Higher indicator';
  if (n >= 60) return 'Moderate indicator';
  return 'Higher risk indicator';
}

function SafetyBreakdown({ safety }) {
  if (!safety) return null;
  return <div className="safety-grid">
    {['lighting', 'crowd', 'incidents', 'traffic'].map((key) => <div className="metric" key={key}><span>{key === 'incidents' ? 'Recent incidents' : key[0].toUpperCase() + key.slice(1)}</span><strong>{safety[key] ?? '—'}</strong></div>)}
  </div>;
}

export default function FleetRouteOptimizer({ origin, destination, passengerId, requestedAt, onImpactChange }) {
  const [data, setData] = useState(null);
  const [previous, setPrevious] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [carpoolState, setCarpoolState] = useState('');

  const mounted = useRef(true);
  // The 60s interval closes over the render that created it. Keeping the latest
  // payload and request body in refs is what makes the "route updated" banner
  // and the request body actually current on every refresh.
  const latestData = useRef(null);
  const requestBody = useRef({ origin, destination, passengerId, requestedAt });
  const impactHandler = useRef(onImpactChange);
  const inFlight = useRef(null);

  requestBody.current = { origin, destination, passengerId, requestedAt };
  impactHandler.current = onImpactChange;

  const loadImpact = useCallback(async (payload, signal) => {
    const routes = payload?.routes || [];
    const recommendedRoute = routes.find((r) => r.id === payload?.recommendedRouteId);
    if (!recommendedRoute || !impactHandler.current) return;
    const baseline = routes.reduce((max, route) => Math.max(max, Number(route.distanceKm) || 0), Number(recommendedRoute.distanceKm) || 0);
    const carpoolPassengers = payload?.carpoolSuggestion ? 2 : 1;
    try {
      const response = await fetch(`${API}/api/fleet/sustainability/impact`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedDistanceKm: recommendedRoute.distanceKm, baselineDistanceKm: baseline, carpoolPassengers }),
      });
      const result = await response.json();
      if (response.ok && mounted.current) impactHandler.current(result.impact);
    } catch { /* sustainability panel is non-blocking */ }
  }, []);

  const loadRoutes = useCallback(async () => {
    const body = requestBody.current;
    if (!body.origin || !body.destination) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API}/api/fleet/optimize-route`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || 'Route optimization failed');
      if (!mounted.current) return;
      setPrevious(latestData.current);
      latestData.current = payload;
      setData(payload);
      await loadImpact(payload, controller.signal);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (mounted.current) {
        setError(err.message === 'Failed to fetch'
          ? `Cannot reach the backend at ${API}. Start it with "npm run dev" in the backend folder.`
          : err.message);
      }
    } finally { if (mounted.current) setLoading(false); }
  }, [loadImpact]);

  useEffect(() => {
    mounted.current = true;
    loadRoutes();
    const timer = setInterval(loadRoutes, 60000);
    return () => { mounted.current = false; clearInterval(timer); inFlight.current?.abort(); };
  }, [loadRoutes, origin?.lat, origin?.lng, destination?.lat, destination?.lng, passengerId, requestedAt]);

  const recommended = data?.routes?.find((r) => r.id === data.recommendedRouteId);
  const oldRecommended = previous?.routes?.find((r) => r.id === previous.recommendedRouteId);
  const changed = Boolean(previous && recommended && oldRecommended && (recommended.id !== oldRecommended.id || Math.abs(minutes(recommended.durationSec) - minutes(oldRecommended.durationSec)) >= 3));

  async function acceptCarpool() {
    const suggestion = data?.carpoolSuggestion;
    if (!suggestion || !passengerId) return;
    setCarpoolState('Requesting confirmation…');
    try {
      const response = await fetch(`${API}/api/fleet/carpool/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: passengerId, matchedBookingId: suggestion.bookingId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || 'Unable to create carpool request');
      setCarpoolState('Request sent — both passengers must confirm.');
    } catch (err) { setCarpoolState(err.message); }
  }

  if (error && !data) return <div className="fleet-error" role="alert">{error}</div>;
  return <section className="fleet-card" aria-label="Fleet route optimization">
    <div className="fleet-header"><div><div className="eyebrow">FLEET OPERATIONS</div><h2>Intelligent Route Optimization</h2><p>Travel time, live traffic and available safety signals are evaluated together.</p></div><button className="secondary-btn" onClick={loadRoutes} disabled={loading}>{loading ? 'Updating…' : 'Refresh'}</button></div>

    {error && data && <div className="fleet-error" role="alert">{error}</div>}

    {changed && recommended && oldRecommended && <div className="route-alert"><strong>Route updated</strong><span>Live conditions changed. Previous ETA: {minutes(oldRecommended.durationSec)} min · New ETA: {minutes(recommended.durationSec)} min.</span><span>New recommendation: {String(recommended.provider || 'route').toUpperCase()} · safety indicator {recommended.safety?.overall ?? '—'}/100.</span></div>}

    {data?.demoMode && <div className="demo-banner">Demo mode: mapping providers are unavailable or not configured. No live route response is being presented as live data.</div>}

    {data && <GoogleRouteMap origin={origin} destination={destination} routes={data.routes || []} recommendedRouteId={data.recommendedRouteId} />}

    {data?.carpoolSuggestion && <div className="carpool-card"><div><strong>Carpool opportunity found</strong><p>Another booking is {data.carpoolSuggestion.pickupDistanceKm} km from the pickup, with a compatible destination and a {data.carpoolSuggestion.timeDifferenceMin}-minute request-time difference.</p></div><button className="primary-btn" onClick={acceptCarpool}>Ask to share</button>{carpoolState && <small>{carpoolState}</small>}</div>}

    {!loading && data && !data.routes?.length && <p className="muted">No route alternatives were returned for this origin and destination.</p>}

    <div className="route-list">{data?.routes?.map((route) => <article className={`route-item ${route.id === data.recommendedRouteId ? 'recommended' : ''}`} key={route.id}>
      <div className="route-top"><div><span className="provider-pill">{route.provider}</span>{route.id === data.recommendedRouteId && <span className="recommended-pill">Current recommendation</span>}<h3>{km(route.distanceKm)} km · {minutes(route.durationSec)} min</h3>{route.label && <p className="muted">{route.label}</p>}</div><div className="score"><strong>{route.safety?.overall ?? '—'}</strong><span>/100 indicator</span></div></div>
      <p className="muted">{scoreLabel(route.safety?.overall)} · optimization score {route.optimizationScore ?? '—'}/100</p><SafetyBreakdown safety={route.safety}/>
      <div className="traffic-row"><span>Traffic</span><strong>{route.traffic?.congestionRatio == null ? 'Unavailable' : `${Math.round(route.traffic.congestionRatio * 100)}% congestion`}</strong></div>
    </article>)}</div>

    {data && <div className="status-row"><span>Last refresh: {new Date(data.generatedAt).toLocaleTimeString()}</span><span>{data.providerStatus?.google === 'ok' || data.providerStatus?.tomtomRouting === 'ok' ? 'Live provider data available' : 'Provider data unavailable'}</span></div>}
  </section>;
}
