import React, { useCallback, useEffect, useState } from 'react';
import { BACKEND_URL as API } from '../lib/config';

export default function SustainabilityLeaderboard({ impact, userId = 'demo-passenger-a' }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [recording, setRecording] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/fleet/sustainability/leaderboard?userId=${encodeURIComponent(userId)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || 'Unable to load leaderboard');
      setRows(payload.rows || []);
    } catch (error) {
      setStatus(error.message === 'Failed to fetch' ? `Cannot reach the backend at ${API}.` : error.message);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  async function recordTrip() {
    if (!impact || recording) return;
    setRecording(true); setStatus('Recording demo trip…');
    try {
      const response = await fetch(`${API}/api/fleet/sustainability/record`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // No display name is sent: the server labels riders "Saathi", and this
        // device's own row is marked "· You" client-side. Sending 'You' (as the
        // source did) made every rider appear as "You" to everyone else.
        body: JSON.stringify({ userId, impact }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || 'Unable to record trip');
      setRows(payload.rows || []);
      setStatus(`+${impact.total.points} points added to the demo leaderboard.`);
    } catch (error) { setStatus(error.message); }
    finally { setRecording(false); }
  }

  const current = rows.find((row) => row.isCurrentUser);
  return <section className="sustainability-card">
    <div className="fleet-header">
      <div><div className="eyebrow">SUSTAINABILITY & REWARDS</div><h2>Carbon Savings & Saathi Leaderboard</h2><p>Estimated CO₂ savings turn greener travel choices into points. Estimates are not measured emissions.</p></div>
      <div className="points-badge"><strong>{current?.points ?? 0}</strong><span>points</span></div>
    </div>

    {impact && <div className="impact-grid">
      <div className="impact-card"><span>Shorter route saved</span><strong>{impact.routeOptimization.co2SavedKg} kg CO₂</strong><small>{impact.routeOptimization.distanceSavedKm} km vs baseline</small></div>
      <div className="impact-card"><span>Carpool saved</span><strong>{impact.carpool.co2SavedKg} kg CO₂</strong><small>{impact.carpool.vehicleTripsAvoided} vehicle trip avoided</small></div>
      <div className="impact-card highlight"><span>Total estimated saving</span><strong>{impact.total.co2SavedKg} kg CO₂</strong><small>+{impact.total.points} points</small></div>
    </div>}

    <div className="leaderboard-head"><strong>Top Saathis</strong><span>{status || 'Demo leaderboard · points stored in memory'}</span></div>
    <div className="leaderboard-list">{rows.slice(0, 5).map((row) => <div className={`leaderboard-row ${row.isCurrentUser ? 'current-user' : ''}`} key={row.id}>
      <span className="rank">#{row.rank}</span><span className="rider-name">{row.name}{row.isCurrentUser ? ' · You' : ''}</span><span className="saved">{row.co2SavedKg} kg saved</span><strong>{row.points}</strong>
    </div>)}</div>

    <button className="primary-btn sustainability-btn" disabled={!impact || recording} onClick={recordTrip}>{recording ? 'Recording…' : 'Record this trip & earn points'}</button>
    <small className="sustainability-note">Demo action only. In production, points should be awarded after a completed/verified trip and stored in Supabase.</small>
  </section>;
}
