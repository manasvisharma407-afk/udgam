# RaahSaathi

Safe, smart, sustainable mobility for women. A PWA with shake-to-alert emergency
dispatch, verified women drivers, women-only carpooling, and a fleet operations
dashboard for enterprise customers.

```
raahsaathi/
├── frontend/          React 18 + Tailwind PWA        → Vercel
└── backend/           Express + Socket.io            → Render
    └── supabase/      Postgres schema + RLS          → Supabase
```

---

## Quick start

```bash
# 1. Backend
cd backend
cp .env.example .env          # fill in Supabase values, or leave blank for demo mode
npm install
npm run dev                   # http://localhost:5000

# 2. Database (optional — the app runs without it in demo mode)
npm run db:push               # applies supabase/schema.sql
npm run db:seed               # Jaipur safety zones

# 3. Frontend
cd ../frontend
cp .env.example .env.local    # set REACT_APP_BACKEND_URL=http://localhost:5000
npm install
npm start                     # http://localhost:3000
```

**Motion sensors need HTTPS.** `localhost` is exempt, but to test shake-to-alert
on a real phone you need a secure origin — use `ngrok http 3000` or deploy a
Vercel preview. Over plain HTTP on a LAN IP, `DeviceMotionEvent` never fires and
the app will correctly report "No motion sensor here".

---

## What was changed from the prototype

The original skeleton had four defects that mattered more than the missing
features:

| Issue | Why it mattered | Fix |
|---|---|---|
| `gender` read from the client payload | Anyone could declare themselves female and receive the precise location of women in distress | Gender and role now come from the verified Supabase profile; the client value is ignored except in demo mode |
| No radius filter on `SEND_SOS` | Every alert broadcast to every female user globally | 5 km geofence with a bounding-box prefilter, tiered ranking, and a responder cap |
| Gravity not removed from accelerometer readings | The ~9.8 m/s² baseline counted toward the threshold, so orientation alone could approach it | High-pass filter, or the platform's gravity-free `acceleration` where available |
| No refractory period between peaks | One 300 ms shake registers as ~15 peaks at 60 Hz and fires instantly | 120 ms refractory gap, direction-reversal requirement, and a 6 s post-trigger cooldown |

`if (!x || !y || !z) return` also silently discarded any sample where an axis
read exactly zero; that check is now an explicit null test.

---

## Core systems

### 1. Shake detection — `frontend/src/hooks/useShakeDetector.js`

A shake is only counted when it is a genuine back-and-forth:

- **Gravity removed.** Prefers `event.acceleration` (already gravity-free);
  falls back to a high-pass filter over `accelerationIncludingGravity`, with a
  12-sample settling period before any reading is trusted.
- **Direction must reverse.** The dominant axis's sign has to flip between
  peaks. A single hard jolt — a dropped phone, a pothole — never counts, and
  sustained vibration (a bus, a handbag) replaces the current peak instead of
  incrementing it.
- **Refractory period.** 120 ms minimum between counted peaks.
- **Window + cooldown.** All three peaks must land inside 1.6 s; after a
  trigger the detector sleeps 6 s.

**iOS 13+** requires `DeviceMotionEvent.requestPermission()` to be called from
inside a real user gesture. `PermissionGate` wires this to a button, and the
same gesture also unlocks the `AudioContext` and requests orientation access —
you only get one gesture, so all three requests share it.

**Fallback triggers** (`useFallbackTriggers.js`) are *always* armed, not just
when sensors are unavailable: press-and-hold 1.5 s, five rapid taps, triple
Escape, and volume keys where the browser exposes them. Motion access is absent
on desktop, in in-app webviews, and on any insecure origin.

### 2. Live GPS stream — `useGeoStream.js`

The 3-second broadcast cadence is **decoupled from the sensor**. GPS delivers
fixes anywhere from 1 Hz to 0.1 Hz depending on device and sky view, so the
newest fix is held in a ref and emitted on a fixed interval. Without this, the
responder's map stalls silently whenever the fix rate drops.

During an SOS the watch switches to `enableHighAccuracy` with `maximumAge: 0` —
a cached position is never acceptable in an emergency. Frames are sent
`volatile`: a dropped frame is superseded 3 seconds later, and buffering stale
positions through a reconnect would be worse than losing them.

### 3. Dispatch — `backend/src/services/dispatch.js`

Responders are ranked in tiers: verified female drivers, then verified female
commuters, then any female commuter, then org security staff. Non-female peers
never receive a woman's precise distress location — that is the entire point of
the geofence.

Three rules are non-negotiable in the code:

1. An SOS is never silently dropped. Zero matches still persists the event and
   returns `escalateToEmergencyServices: true`, and the UI surfaces the call-112
   path rather than implying help is coming.
2. The GPS trail is append-only. It is evidence, so nothing mutates a prior fix
   and `sos_locations` has no UPDATE policy for anyone but the service role.
3. If the socket fails, the client retries over plain HTTP before giving up.
   Corporate and campus networks frequently block WebSocket upgrades.

### 4. Safety scoring — `backend/src/services/safety.js`

Composite 0–100 from street lighting (municipal data in `safety_zones`), crowd
density (live presence headcount — we count heads in a cell, never identities),
incident history (SOS events within 1 km over 30 days), and driver vetting.
Lighting is weighted up to 0.40 after dark. The API returns the full component
breakdown, because an unexplained safety number is worth very little.

### 5. Green Pool — `backend/src/services/greenPool.js`

Route overlap requires both corridor proximity *and* bearing agreement within
55°, so two riders passing the same junction in opposite directions never match.
CO₂ savings use India-specific factors (CEA grid intensity, MoRTH fleet
averages) and include pickup detours, making the figure a floor rather than a
best case.

### 5b. Smart Route — `backend/src/routes/fleet.js`, `frontend/src/pages/FleetOperationsPage.js`

The **Routes** tab (`/fleet-ops`, API under `/api/fleet`). Route alternatives from
Google Routes and TomTom (with live traffic) are scored together with a safety
indicator built from `safety_zones` and recent `sos_events` (coordinates and
timestamps only; cancelled alerts ignored), then ranked. With neither key set
the API serves clearly labelled demo routes. The tab also has a grid-aggregated
safety heat map, carpool suggestions that need both riders to confirm, and an
estimated CO₂ / points leaderboard. Its scoring is deliberately separate from
`services/safety.js` and `services/greenPool.js`, so its numbers will not match
the Safety and Green Pool tabs. Code lives in `backend/src/services/fleet/`.

### 6. PWA

`public/service-worker.js` is hand-written rather than generated, because the
cache strategy has to be opinionated:

- **App shell → cache-first.** The SOS screen must open offline.
- **`/api/*` → never cached.** A stale driver list or a cached "no active
  alerts" is worse than an honest error.
- **Map tiles → stale-while-revalidate,** capped at 250 entries.
- **Navigations → network-first** with `offline.html`, which tells the user
  plainly that an SOS will *not* be delivered and shows the emergency numbers.

Push notification handlers are wired but need VAPID keys and a subscription
store to activate.

---

## Deployment

### Supabase

1. Create a project, then run `backend/supabase/schema.sql` in the SQL editor.
2. Optionally run `seed.sql` for Jaipur safety-zone data.
3. Copy the project URL, `service_role` key, JWT secret, and connection string.

The schema enables RLS on every table. A trigger blocks self-service edits to
`gender`, `role`, `verified`, and `org_id` — the fields dispatch depends on —
so a compromised anon key cannot escalate anyone into the female responder pool.

### Backend → Render

Connect the repo; `render.yaml` is picked up automatically. Set the `sync: false`
secrets in the dashboard: `CORS_ORIGINS`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL`.

**Do not use Render's free tier.** It sleeps after 15 minutes of inactivity, and
a cold start of 30+ seconds on an SOS is unacceptable. The blueprint specifies
`starter`, region `singapore` for Indian latency.

`DEMO_MODE` is force-disabled whenever `NODE_ENV=production`, regardless of the
env var, so unsigned identities can never be accepted in production.

### Frontend → Vercel

Set root directory to `frontend`. Add `REACT_APP_BACKEND_URL` pointing at the
Render URL, then redeploy — CRA inlines `REACT_APP_*` at **build** time, so
changing it does not take effect until a rebuild.

`vercel.json` sets `Permissions-Policy: accelerometer=(self), gyroscope=(self),
geolocation=(self)`. Without those, motion and location are blocked regardless
of what the user grants.

Backend CORS auto-allows `*.vercel.app` so preview deployments work without
per-URL configuration.

---

## Environment variables

**Backend** (`backend/.env`)

| Variable | Required | Notes |
|---|---|---|
| `PORT` | no | Render sets this |
| `CORS_ORIGINS` | yes | Comma-separated; `*.vercel.app` auto-allowed |
| `SUPABASE_URL` | for persistence | Without it, in-memory only |
| `SUPABASE_SERVICE_ROLE_KEY` | for persistence | Server-only, never in the client bundle |
| `SUPABASE_JWT_SECRET` | recommended | Enables local JWT verification, no network hop per frame |
| `DATABASE_URL` | for migrations | Used by `db:push` / `db:seed` |
| `SOS_RADIUS_KM` | no | Default 5 |
| `ADMIN_API_KEY` | for `/admin` | Shared secret for machine clients |
| `DEMO_MODE` | no | Forced off in production |
| `GOOGLE_MAPS_API_KEY` | no | Routes API, server-side. Blank = demo routes |
| `TOMTOM_API_KEY` | no | Routing, traffic and location search, server-side |
| `SOS_LOOKBACK_HOURS`, `CARPOOL_MAX_*` | no | Smart Route tuning; defaults in `.env.example` |

**Frontend** (`frontend/.env.local`)

| Variable | Required | Notes |
|---|---|---|
| `REACT_APP_BACKEND_URL` | yes | No trailing slash |
| `REACT_APP_SUPABASE_ANON_KEY` | no | Publishable; safe in the bundle |
| `REACT_APP_MAP_TILE_URL` | no | Defaults to CARTO OSM, no token needed |

---

## Known gaps

These are deliberate scope boundaries, not oversights:

- **Auth UI is not built.** The backend verifies Supabase JWTs and the client
  passes a token, but there is no sign-up/sign-in screen. Demo mode covers the
  gap locally; production needs Supabase Auth mounted in front of the app.
- **Presence is in-memory.** Fine for a single Render instance. Horizontal
  scaling needs Redis behind `services/presence.js` (the module only exposes
  upsert/remove/query, so it is a drop-in swap) plus a Socket.io Redis adapter.
- **Driver rows must be created through Supabase Auth**, since `profiles.id`
  references `auth.users`. `seed.sql` documents the SQL for this.
- **Route overlap uses straight-line corridors,** not road geometry. Good enough
  for matching; a real deployment would call a routing API.
- **Smart Route is unauthenticated and in-memory.** `/api/fleet` is rate limited
  but has no `requireAuth` (the client sends no token yet). Bookings, carpool
  requests and leaderboard points live in process memory and reset on restart;
  nothing in the client creates real bookings, so carpool matches only appear in
  demo mode against seeded riders. `supabase/001_fleet_operations.sql` is
  optional and not read by the current code.
- **Push notifications need VAPID keys.** The service worker handlers exist but
  are inert until a subscription store is added.
- **Nothing here has been run.** The environment this was built in had no
  network access, so `npm install` never ran and no build was executed. The
  backend passes `node --check` on every file and all frontend imports resolve
  statically, but the JSX has not been compiled. Expect to fix small things on
  first build.
