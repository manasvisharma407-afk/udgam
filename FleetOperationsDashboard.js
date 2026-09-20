import React, { useState } from 'react';
import FleetRouteOptimizer from './FleetRouteOptimizer';
import FleetSafetyHeatmap from './FleetSafetyHeatmap';
import SustainabilityLeaderboard from './SustainabilityLeaderboard';
import '../styles/fleet-route-optimizer.css';
import { BACKEND_URL as API } from '../lib/config';

function LocationSearch({ label, value, onSelect }) {
  const [query, setQuery] = useState(
    value?.name || value?.address || ''
  );
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function searchLocation() {
    const text = query.trim();

    if (!text) {
      setResults([]);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(
        `${API}/api/fleet/search-location?q=${encodeURIComponent(text)}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Location search failed');
      }

      setResults(data.results || []);
      if (!(data.results || []).length) setError('No matching places found.');
    } catch (err) {
      setResults([]);
      setError(
        err.message === 'Failed to fetch'
          ? `Cannot reach the backend at ${API}.`
          : err.message
      );
    } finally {
      setLoading(false);
    }
  }

  function handleSelect(result) {
    setQuery(result.name || result.address);
    setResults([]);

    onSelect({
      name: result.name,
      address: result.address,
      lat: Number(result.lat),
      lng: Number(result.lng),
    });
  }

  return (
    <div className="location-search">
      <label>{label}</label>

      <div className="location-input-row">
        <input
          type="text"
          value={query}
          placeholder={`Search ${label.toLowerCase()}...`}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              searchLocation();
            }
          }}
        />

        <button
          type="button"
          className="secondary-btn"
          onClick={searchLocation}
          disabled={loading}
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {results.length > 0 && (
        <div className="location-results">
          {results.map((result, index) => (
            <button
              type="button"
              className="location-result"
              key={`${result.lat}-${result.lng}-${index}`}
              onClick={() => handleSelect(result)}
            >
              <strong>{result.name}</strong>
              <span>{result.address}</span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <small className="location-error" role="alert">
          {error}
        </small>
      )}

      {value?.lat && value?.lng && (
        <small className="location-selected">
          ✓ Location selected
        </small>
      )}
    </div>
  );
}

export default function FleetOperationsDashboard({
  booking,
  heatmapBounds,
}) {
  const [origin, setOrigin] = useState(booking.origin);
  const [destination, setDestination] = useState(booking.destination);

  return (
    <div className="fleet-dashboard">

      <section className="route-planner-card">
        <div className="route-planner-header">
          <div>
            <div className="eyebrow">SMART COMMUTE</div>
            <h2>Plan Your Safe Route</h2>
            <p>
              Search your pickup and destination to get live route
              recommendations.
            </p>
          </div>
        </div>

        <div className="location-search-grid">

          <LocationSearch
            label="Pickup Location"
            value={origin}
            onSelect={setOrigin}
          />

          <LocationSearch
            label="Destination"
            value={destination}
            onSelect={setDestination}
          />

        </div>
      </section>

      {origin?.lat &&
        origin?.lng &&
        destination?.lat &&
        destination?.lng && (
          <FleetRouteOptimizer
            origin={origin}
            destination={destination}
            passengerId={booking.passengerId || booking.id}
            requestedAt={booking.requestedAt}
            onImpactChange={booking.onImpactChange}
          />
        )}

      <FleetSafetyHeatmap bounds={heatmapBounds} />

      <SustainabilityLeaderboard
        impact={booking.impact}
        userId={booking.passengerId || booking.id}
      />

    </div>
  );
}
