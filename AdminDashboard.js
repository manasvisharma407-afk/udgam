import React, { useState, useEffect } from 'react';
import { Circle, Popup } from 'react-leaflet';
// Adjust relative paths to point inside src/ (e.g., ../context/ inside src/)
import { useSocket } from '../context/SocketContext';
import { formatRelativeTime } from '../utils/dateUtils';

const AdminIncidentsMap = ({ incidents: initialIncidents = [], onSelectIncident }) => {
  const [incidents, setIncidents] = useState(initialIncidents);
  const socket = useSocket();

  useEffect(() => {
    setIncidents(initialIncidents);
  }, [initialIncidents]);

  useEffect(() => {
    const activeSocket = socket?.socket || socket;
    if (!activeSocket || typeof activeSocket.on !== 'function') return;

    const handleOpened = (newIncident) => {
      setIncidents((prev) => [newIncident, ...prev]);
    };

    const handleUpdated = (updatedIncident) => {
      setIncidents((prev) =>
        prev.map((item) => (item.id === updatedIncident.id ? updatedIncident : item))
      );
    };

    const handleResolved = (resolvedIncident) => {
      setIncidents((prev) =>
        prev.map((item) =>
          item.id === resolvedIncident.id ? { ...item, status: 'RESOLVED' } : item
        )
      );
    };

    activeSocket.on('ADMIN_INCIDENT_OPENED', handleOpened);
    activeSocket.on('ADMIN_INCIDENT_UPDATED', handleUpdated);
    activeSocket.on('ADMIN_INCIDENT_RESOLVED', handleResolved);

    return () => {
      if (typeof activeSocket.off === 'function') {
        activeSocket.off('ADMIN_INCIDENT_OPENED', handleOpened);
        activeSocket.off('ADMIN_INCIDENT_UPDATED', handleUpdated);
        activeSocket.off('ADMIN_INCIDENT_RESOLVED', handleResolved);
      }
    };
  }, [socket]);

  return (
    <>
      {incidents.map((incident) => {
        const originPoint = incident.origin || incident.latest;
        if (!originPoint || originPoint.lat == null || originPoint.lng == null) {
          return null;
        }

        const isResolved = incident.status === 'RESOLVED';
        const color = isResolved ? '#10b981' : '#ef4444';

        return (
          <Circle
            key={incident.id}
            center={[originPoint.lat, originPoint.lng]}
            radius={200}
            pathOptions={{ color, fillColor: color, fillOpacity: 0.3 }}
          >
            <Popup>
              <div
                className="p-1 cursor-pointer"
                onClick={() => onSelectIncident && onSelectIncident(incident)}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-semibold text-sm text-slate-800">
                    Incident #{incident.id?.slice(0, 8)}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold ${
                      isResolved
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {incident.status}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {formatRelativeTime(incident.createdAt)} · {incident.trigger || 'Manual'} trigger ·{' '}
                  {incident.trail?.length || 0} fixes
                </p>
              </div>
            </Popup>
          </Circle>
        );
      })}
    </>
  );
};

export default AdminIncidentsMap;