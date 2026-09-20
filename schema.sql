-- =====================================================================
-- RaahSaathi — Supabase / Postgres schema
-- Apply with:  psql "$DATABASE_URL" -f supabase/schema.sql
-- Idempotent: safe to re-run.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "cube";
create extension if not exists "earthdistance";

-- ---------------------------------------------------------------- enums

do $$ begin
  create type gender_t as enum ('female', 'male', 'non_binary', 'undisclosed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app_role_t as enum ('commuter', 'driver', 'responder', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type check_status_t as enum ('pending', 'cleared', 'failed', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sos_status_t as enum ('active', 'resolved', 'cancelled');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------ organisations

create table if not exists orgs (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  city         text,
  contact_email text,
  plan         text default 'pilot',
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------------ profiles
-- One row per auth.users row. `gender` drives female-only dispatch, so it is
-- server-owned: a user can read it but only an admin function may change it
-- after onboarding.

create table if not exists profiles (
  id                     uuid primary key references auth.users(id) on delete cascade,
  display_name           text not null default 'RaahSaathi user',
  phone                  text,
  gender                 gender_t not null default 'undisclosed',
  role                   app_role_t not null default 'commuter',
  org_id                 uuid references orgs(id) on delete set null,
  verified               boolean not null default false,
  available_as_responder boolean not null default true,
  emergency_contacts     jsonb not null default '[]'::jsonb,
  home_city              text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists profiles_org_idx    on profiles (org_id);
create index if not exists profiles_role_idx   on profiles (role);
create index if not exists profiles_gender_idx on profiles (gender);

-- ------------------------------------------------------------------- drivers

create table if not exists drivers (
  id                        uuid primary key references profiles(id) on delete cascade,
  display_name              text not null,
  gender                    gender_t not null default 'female',
  photo_url                 text,
  languages                 text[] default '{}',

  vehicle_make              text,
  vehicle_model             text,
  vehicle_colour            text,
  vehicle_plate             text,
  vehicle_type              text default 'hatchback',
  vehicle_gps_enabled       boolean not null default false,

  licence_number            text,
  licence_expiry            date,
  id_verified               boolean not null default false,
  background_check_status   check_status_t not null default 'pending',
  background_checked_at     timestamptz,
  police_verification       boolean not null default false,
  safety_training_completed boolean not null default false,

  rating                    numeric(3,2) default 4.50 check (rating between 0 and 5),
  completed_trips           integer not null default 0,
  complaints_12m            integer not null default 0,

  org_id                    uuid references orgs(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists drivers_eligible_idx
  on drivers (background_check_status, id_verified)
  where background_check_status = 'cleared';

-- ---------------------------------------------------------------- sos events

create table if not exists sos_events (
  id                uuid primary key default gen_random_uuid(),
  reporter_id       uuid references profiles(id) on delete set null,
  reporter_label    text,
  org_id            uuid references orgs(id) on delete set null,
  trigger           text not null default 'manual',
  status            sos_status_t not null default 'active',
  resolution        text,
  lat               double precision not null,
  lng               double precision not null,
  accuracy_m        double precision,
  radius_km         numeric(5,2) not null default 5,
  resolved_at       timestamptz,
  resolved_by_label text,
  created_at        timestamptz not null default now()
);

create index if not exists sos_events_created_idx on sos_events (created_at desc);
create index if not exists sos_events_status_idx  on sos_events (status) where status = 'active';
-- Geo index for the "incidents near here in the last 30 days" lookup.
create index if not exists sos_events_geo_idx
  on sos_events using gist (ll_to_earth(lat, lng));

-- ---------------------------------------------------------- sos gps trail
-- Append-only. The trail is evidence, so there is deliberately no UPDATE
-- policy on this table for anyone but the service role.

create table if not exists sos_locations (
  id          bigserial primary key,
  sos_id      uuid not null references sos_events(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  accuracy_m  double precision,
  speed_mps   double precision,
  heading_deg double precision,
  recorded_at timestamptz not null default now()
);

create index if not exists sos_locations_sos_idx on sos_locations (sos_id, recorded_at);

-- ------------------------------------------------------------ sos responders

create table if not exists sos_responders (
  id              bigserial primary key,
  sos_id          uuid not null references sos_events(id) on delete cascade,
  responder_id    uuid references profiles(id) on delete set null,
  responder_label text,
  distance_km     numeric(6,2),
  accepted_at     timestamptz not null default now(),
  unique (sos_id, responder_id)
);

-- ------------------------------------------------------------- safety zones
-- Loaded per city from municipal streetlight / CCTV open data.

create table if not exists safety_zones (
  id             uuid primary key default gen_random_uuid(),
  city           text,
  name           text not null,
  lat            double precision not null,
  lng            double precision not null,
  radius_m       integer not null default 500,
  lighting_index integer not null default 55 check (lighting_index between 0 and 100),
  incident_index integer not null default 20 check (incident_index between 0 and 100),
  cctv_coverage  integer not null default 0 check (cctv_coverage between 0 and 100),
  updated_at     timestamptz not null default now()
);

create index if not exists safety_zones_geo_idx
  on safety_zones using gist (ll_to_earth(lat, lng));

-- ----------------------------------------------------------- green pool

create table if not exists pool_trips (
  id              uuid primary key default gen_random_uuid(),
  host_id         uuid references profiles(id) on delete cascade,
  host_name       text,
  origin_lat      double precision not null,
  origin_lng      double precision not null,
  origin_label    text,
  dest_lat        double precision not null,
  dest_lng        double precision not null,
  dest_label      text,
  depart_at       timestamptz not null,
  seats_available integer not null default 3 check (seats_available between 0 and 6),
  women_only      boolean not null default true,
  city            text,
  baseline_mode   text not null default 'petrol_car_solo',
  status          text not null default 'open',
  org_id          uuid references orgs(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists pool_trips_open_idx on pool_trips (status, depart_at)
  where status = 'open';
create index if not exists pool_trips_geo_idx
  on pool_trips using gist (ll_to_earth(origin_lat, origin_lng));

create table if not exists pool_matches (
  id                 uuid primary key default gen_random_uuid(),
  trip_id            uuid references pool_trips(id) on delete cascade,
  rider_id           uuid references profiles(id) on delete set null,
  riders             integer not null default 2,
  pooled_distance_km numeric(8,2) not null default 0,
  co2_saved_kg       numeric(8,3) not null default 0,
  match_score        numeric(5,4),
  org_id             uuid references orgs(id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists pool_matches_created_idx on pool_matches (created_at desc);
create index if not exists pool_matches_org_idx     on pool_matches (org_id);

-- =====================================================================
-- Row Level Security
-- The backend uses the service role and bypasses these. They exist so the
-- frontend can safely talk to Supabase directly for reads, and so a leaked
-- anon key cannot enumerate anybody's location history.
-- =====================================================================

alter table profiles       enable row level security;
alter table drivers        enable row level security;
alter table orgs           enable row level security;
alter table sos_events     enable row level security;
alter table sos_locations  enable row level security;
alter table sos_responders enable row level security;
alter table safety_zones   enable row level security;
alter table pool_trips     enable row level security;
alter table pool_matches   enable row level security;

-- Helper: is the caller an admin of the given org?
create or replace function is_org_admin(target_org uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.org_id is not distinct from target_org
  );
$$;

-- profiles: read your own row; admins read their org.
drop policy if exists profiles_self_read on profiles;
create policy profiles_self_read on profiles
  for select using (id = auth.uid() or is_org_admin(org_id));

drop policy if exists profiles_self_update on profiles;
create policy profiles_self_update on profiles
  for update using (id = auth.uid())
  -- Note: `gender` and `role` are protected by the trigger below, not here.
  with check (id = auth.uid());

-- Block self-service escalation of the two fields dispatch depends on.
create or replace function protect_identity_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  new.gender := old.gender;
  new.role   := old.role;
  new.verified := old.verified;
  new.org_id := old.org_id;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_protect_identity on profiles;
create trigger profiles_protect_identity
  before update on profiles
  for each row execute function protect_identity_fields();

-- drivers: any signed-in user may read *cleared* drivers (that is the point of
-- the verification badge); drivers read their own full row.
drop policy if exists drivers_public_read on drivers;
create policy drivers_public_read on drivers
  for select using (
    (background_check_status = 'cleared' and id_verified)
    or id = auth.uid()
    or is_org_admin(org_id)
  );

-- orgs: members only.
drop policy if exists orgs_member_read on orgs;
create policy orgs_member_read on orgs
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.org_id = orgs.id)
  );

-- sos_events: the reporter, an accepted responder, or an org admin.
drop policy if exists sos_events_scoped_read on sos_events;
create policy sos_events_scoped_read on sos_events
  for select using (
    reporter_id = auth.uid()
    or is_org_admin(org_id)
    or exists (
      select 1 from sos_responders r
      where r.sos_id = sos_events.id and r.responder_id = auth.uid()
    )
  );

drop policy if exists sos_events_self_insert on sos_events;
create policy sos_events_self_insert on sos_events
  for insert with check (reporter_id = auth.uid());

-- sos_locations: same audience as the parent event. No update policy at all.
drop policy if exists sos_locations_scoped_read on sos_locations;
create policy sos_locations_scoped_read on sos_locations
  for select using (
    exists (
      select 1 from sos_events e
      where e.id = sos_locations.sos_id
        and (
          e.reporter_id = auth.uid()
          or is_org_admin(e.org_id)
          or exists (
            select 1 from sos_responders r
            where r.sos_id = e.id and r.responder_id = auth.uid()
          )
        )
    )
  );

drop policy if exists sos_responders_scoped_read on sos_responders;
create policy sos_responders_scoped_read on sos_responders
  for select using (
    responder_id = auth.uid()
    or exists (select 1 from sos_events e where e.id = sos_id and e.reporter_id = auth.uid())
  );

-- safety_zones: public reference data for any signed-in user.
drop policy if exists safety_zones_read on safety_zones;
create policy safety_zones_read on safety_zones
  for select using (auth.role() = 'authenticated');

-- pool_trips: women-only trips are visible only to female profiles.
drop policy if exists pool_trips_read on pool_trips;
create policy pool_trips_read on pool_trips
  for select using (
    host_id = auth.uid()
    or (
      status = 'open'
      and (
        women_only = false
        or exists (select 1 from profiles p where p.id = auth.uid() and p.gender = 'female')
      )
    )
  );

drop policy if exists pool_trips_host_write on pool_trips;
create policy pool_trips_host_write on pool_trips
  for insert with check (host_id = auth.uid());

drop policy if exists pool_trips_host_update on pool_trips;
create policy pool_trips_host_update on pool_trips
  for update using (host_id = auth.uid());

drop policy if exists pool_matches_scoped_read on pool_matches;
create policy pool_matches_scoped_read on pool_matches
  for select using (
    rider_id = auth.uid()
    or is_org_admin(org_id)
    or exists (select 1 from pool_trips t where t.id = trip_id and t.host_id = auth.uid())
  );

-- ------------------------------------------------- auto-provision profile

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.phone
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
