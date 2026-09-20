import React, { useCallback, useEffect, useRef, useState } from 'react';
import '../styles/fleet-route-optimizer.css';
import { BACKEND_URL as API } from '../lib/config';


const LAYERS = [
  ['combined', 'Combined'],
  ['lighting', 'Lighting'],
  ['crowd', 'Crowd/activity'],
  ['incidents', 'Incident hotspots'],
  ['traffic', 'Traffic'],
];

export default function FleetSafetyHeatmap({ bounds, refreshMs = 60000 }) {
  const [cells, setCells] = useState([]);
  const [layer, setLayer] = useState('combined');
  const [status, setStatus] = useState('Loading…');
  const mounted = useRef(true);
  const boundsKey = JSON.stringify(bounds || null);

  const load = useCallback(async (signal) => {
    if (!bounds) { setStatus('No map bounds supplied'); return; }
    try {
      const params = new URLSearchParams({ ...bounds, precision: '3' });
      const response = await fetch(`${API}/api/fleet/heatmap?${params}`, { signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || 'Heatmap unavailable');
      if (!mounted.current) return;
      setCells(Array.isArray(payload.cells) ? payload.cells : []);
      setStatus(payload.dataMode === 'supabase'
        ? 'Aggregated project data'
        : 'Synthetic demo grid — not real-world data');
    } catch (e) {
      if (e.name === 'AbortError' || !mounted.current) return;
      setStatus(e.message === 'Failed to fetch' ? `Cannot reach the backend at ${API}.` : e.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    load(controller.signal);
    const timer = setInterval(() => load(controller.signal), refreshMs);
    return () => { mounted.current = false; clearInterval(timer); controller.abort(); };
  }, [load, refreshMs]);

  const value = (cell) => {
    if (layer !== 'combined') return Number(cell[layer]);
    const parts = [cell.lighting, cell.crowd, 100 - (cell.incidents || 0), 100 - (cell.traffic || 0)]
      .map(Number).filter(Number.isFinite);
    return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : NaN;
  };

  return <section className="heatmap-card">
    <div className="fleet-header">
      <div><div className="eyebrow">PRIVACY-PRESERVING HEAT MAP</div><h2>Safety &amp; Activity Layers</h2><p>Grid-aggregated signals only; no passenger identities or exact distress locations are rendered.</p></div>
      <select value={layer} onChange={(e) => setLayer(e.target.value)} aria-label="Heat-map layer">
        {LAYERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
    </div>
    <div className="heatmap-grid">{cells.map((cell) => {
      const v = value(cell);
      const shown = Number.isFinite(v) ? Math.round(v) : null;
      return <div key={cell.key} className="heat-cell"
        title={`${cell.key} · samples ${cell.sampleCount ?? 0}`}
        style={{ '--heat': shown === null ? 0.12 : 0.3 + Math.min(0.7, shown / 100) }}>
        <span>{shown === null ? '—' : shown}</span>
      </div>;
    })}</div>
    {cells.length === 0 && <p className="empty-note">No aggregated safety-zone data for this area yet.</p>}
    <div className="status-row"><span>{status}</span><span>{cells.length} aggregated cells</span></div>
  </section>;
}
