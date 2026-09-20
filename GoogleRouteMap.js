/*
 * Route map (Leaflet + the app's shared basemap).
 *
 * Despite the file name (kept from the source project so imports stay the same)
 * this does not use Google Maps and needs no browser key. Leaflet's own
 * stylesheet is imported once in src/index.js, before index.css, so the
 * .leaflet-* overrides in index.css keep winning.
 */
import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { MAP_ATTRIBUTION, MAP_TILE_URL } from '../lib/config';

function routePath(route) {
  if (Array.isArray(route?.points)) {
    return route.points
      .map((point) => ({
        lat: Number(point.lat),
        lng: Number(point.lng),
      }))
      .filter(
        (point) =>
          Number.isFinite(point.lat) &&
          Number.isFinite(point.lng)
      );
  }

  return [];
}

export default function GoogleRouteMap({
  origin,
  destination,
  routes = [],
  recommendedRouteId,
}) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const layersRef = useRef([]);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const center = origin ||
      destination || {
        lat: 26.9124,
        lng: 75.7873,
      };

    const map = L.map(mapRef.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView([center.lat, center.lng], 12);

    // Same basemap as the rest of the app (lib/config.js), not a hard-coded
    // tile server: the public OSM tile servers are not meant for app traffic.
    L.tileLayer(MAP_TILE_URL, {
      maxZoom: 19,
      attribution: MAP_ATTRIBUTION,
    }).addTo(map);

    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
    };
    // Initial centre only; later origin/destination changes are handled by the
    // drawing effect below (fitBounds), so this must run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapInstance.current;

    if (!map) return;

    layersRef.current.forEach((layer) => {
      map.removeLayer(layer);
    });

    layersRef.current = [];

    const bounds = [];

    // Draw routes
    routes.forEach((route) => {
      const path = routePath(route);

      if (path.length < 2) return;

      const latLngs = path.map((point) => [
        point.lat,
        point.lng,
      ]);

      latLngs.forEach((point) => bounds.push(point));

      const isRecommended =
        route.id === recommendedRouteId;

      const line = L.polyline(latLngs, {
        color: isRecommended ? '#1f7a5a' : '#8d98a7',
        weight: isRecommended ? 6 : 3,
        opacity: isRecommended ? 0.95 : 0.45,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);

      line.bindTooltip(
        route.label ||
          (isRecommended
            ? 'Recommended route'
            : 'Alternative route')
      );

      layersRef.current.push(line);
    });

    // Pickup marker
    if (origin) {
      const marker = L.circleMarker(
        [origin.lat, origin.lng],
        {
          radius: 8,
          color: '#ffffff',
          weight: 3,
          fillColor: '#1f7a5a',
          fillOpacity: 1,
        }
      )
        .addTo(map)
        .bindTooltip('Pickup');

      layersRef.current.push(marker);

      bounds.push([origin.lat, origin.lng]);
    }

    // Destination marker
    if (destination) {
      const marker = L.circleMarker(
        [destination.lat, destination.lng],
        {
          radius: 8,
          color: '#ffffff',
          weight: 3,
          fillColor: '#d97706',
          fillOpacity: 1,
        }
      )
        .addTo(map)
        .bindTooltip('Destination');

      layersRef.current.push(marker);

      bounds.push([
        destination.lat,
        destination.lng,
      ]);
    }

    if (bounds.length > 1) {
      map.fitBounds(bounds, {
        padding: [40, 40],
      });
    }
  }, [
    origin,
    destination,
    routes,
    recommendedRouteId,
  ]);

  return (
    <div className="route-map-wrap">
      <div
        ref={mapRef}
        className="route-map"
        aria-label="Interactive route map"
      />

      <div className="route-map-legend">
        <span>
          <i className="legend-dot recommended-dot" />
          Recommended
        </span>

        <span>
          <i className="legend-dot alternate-dot" />
          Alternatives
        </span>
      </div>
    </div>
  );
}
