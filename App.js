import React, { useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { SafetyProvider, useSafety } from './context/SafetyContext';
import AlertOverlay from './components/AlertOverlay';
import ChatLauncher from './components/ChatLauncher';
import SafetyPage from './pages/SafetyPage';
import HerRidesPage from './pages/HerRidesPage';
import GreenPoolPage from './pages/GreenPoolPage';
import AdminDashboard from './pages/AdminDashboard';
import FleetOperationsPage from './pages/FleetOperationsPage';

const TABS = [
  { to: '/', label: 'Safety', icon: '🛡️', end: true },
  { to: '/rides', label: 'HerRides', icon: '🚗' },
  { to: '/pool', label: 'Green Pool', icon: '🌿' },
  { to: '/admin', label: 'Fleet', icon: '📊' },
  { to: '/fleet-ops', label: 'Routes', icon: '🧭' },
];

/* ----------------------------------------------------------------- chrome */

function Header() {
  const { profile, isSosActive, socket } = useSafety();

  return (
    <header
      className={`sticky top-0 z-30 border-b backdrop-blur-lg transition-colors ${
        isSosActive
          ? 'border-rose-300 bg-rose-600/95 text-white'
          : 'border-slate-200/80 bg-white/85'
      }`}
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-xl text-lg font-black ${
              isSosActive
                ? 'bg-white/20 text-white'
                : 'bg-gradient-to-br from-brand-pink to-brand-teal text-white'
            }`}
            aria-hidden="true"
          >
            R
          </span>
          <div className="leading-tight">
            <h1 className="text-base font-black tracking-tight">RaahSaathi</h1>
            <p className={`text-[11px] ${isSosActive ? 'text-rose-100' : 'text-slate-500'}`}>
              {isSosActive ? 'Emergency alert active' : `Hi, ${profile.displayName}`}
            </p>
          </div>
        </div>

        {!socket.connected ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
            Reconnecting
          </span>
        ) : null}
      </div>
    </header>
  );
}

function TabBar() {
  const { hasIncoming } = useSafety();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg"
      aria-label="Primary"
    >
      <div className="mx-auto grid max-w-2xl grid-cols-5">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `relative flex flex-col items-center gap-0.5 whitespace-nowrap px-1 py-2.5 text-[10px] font-semibold transition min-[360px]:text-[11px] ${
                isActive ? 'text-brand-pink' : 'text-slate-400 hover:text-slate-600'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className="text-lg leading-none" aria-hidden="true">
                  {tab.icon}
                </span>
                <span>{tab.label}</span>
                {isActive ? (
                  <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-brand-pink" />
                ) : null}
                {tab.to === '/' && hasIncoming ? (
                  <span className="absolute right-[22%] top-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />
                ) : null}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function Toast() {
  const { toast, setToast } = useSafety();
  if (!toast) return null;

  const tone =
    toast.tone === 'success'
      ? 'bg-emerald-600'
      : toast.tone === 'error'
      ? 'bg-rose-600'
      : 'bg-slate-800';

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 bottom-20 z-40 mx-auto max-w-sm animate-slide-up"
    >
      <button
        type="button"
        onClick={() => setToast(null)}
        className={`w-full rounded-2xl ${tone} px-4 py-3 text-left text-sm font-medium text-white shadow-lg`}
      >
        {toast.message}
      </button>
    </div>
  );
}

/** PWA install prompt, shown once the browser says the app is installable. */
function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem('raahsaathi:installDismissed') === '1'
  );

  useEffect(() => {
    const handler = (event) => {
      event.preventDefault();
      setDeferred(event);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!deferred || dismissed) return null;

  const install = async () => {
    deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  };

  const dismiss = () => {
    localStorage.setItem('raahsaathi:installDismissed', '1');
    setDismissed(true);
  };

  return (
    <div className="mx-auto mb-4 flex max-w-2xl items-center gap-3 rounded-2xl bg-slate-900 p-3 text-white">
      <span className="text-xl" aria-hidden="true">
        📲
      </span>
      <p className="flex-1 text-xs leading-relaxed">
        Install RaahSaathi to your home screen — shake detection works far more reliably
        outside a browser tab.
      </p>
      <button onClick={install} className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-slate-900">
        Install
      </button>
      <button onClick={dismiss} aria-label="Dismiss" className="px-1 text-slate-400">
        ✕
      </button>
    </div>
  );
}

/**
 * New-build banner.
 *
 * A stale build of a safety app is a genuine risk — a fixed dispatch bug is no
 * use to someone running last month's bundle — so an available update is
 * surfaced immediately rather than waiting for every tab to close.
 */
function UpdateBanner() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const handler = () => setAvailable(true);
    window.addEventListener('raahsaathi:update-available', handler);
    return () => window.removeEventListener('raahsaathi:update-available', handler);
  }, []);

  if (!available) return null;

  const reload = async () => {
    const registration = await navigator.serviceWorker?.getRegistration();
    registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    window.location.reload();
  };

  return (
    <div className="flex items-center justify-between gap-3 bg-brand-teal px-4 py-2 text-white">
      <span className="text-xs font-semibold">A newer version of RaahSaathi is ready.</span>
      <button
        onClick={reload}
        className="shrink-0 rounded-lg bg-white px-3 py-1 text-xs font-bold text-brand-teal"
      >
        Update
      </button>
    </div>
  );
}

function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="bg-amber-500 px-4 py-2 text-center text-xs font-semibold text-white">
      You are offline. SOS alerts cannot be delivered — call 112 in an emergency.
    </div>
  );
}

/** Reset scroll on tab change; otherwise the new tab opens mid-page. */
function ScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function Shell() {
  const { isSosActive } = useSafety();

  return (
    <div className={`min-h-screen bg-slate-50 ${isSosActive ? 'sos-active' : ''}`}>
      <UpdateBanner />
      <OfflineBanner />
      <Header />
      <AlertOverlay />
      <ScrollReset />

      <main className="mx-auto max-w-2xl px-4 pb-24 pt-4">
        <InstallPrompt />
        <Routes>
          <Route path="/" element={<SafetyPage />} />
          <Route path="/rides" element={<HerRidesPage />} />
          <Route path="/pool" element={<GreenPoolPage />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/fleet-ops" element={<FleetOperationsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <Toast />
      <ChatLauncher />
      <TabBar />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SafetyProvider>
        <Shell />
      </SafetyProvider>
    </BrowserRouter>
  );
}
