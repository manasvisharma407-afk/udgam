-- =====================================================================
-- RaahSaathi — demo seed data (Jaipur corridor)
-- Apply with:  psql "$DATABASE_URL" -f supabase/seed.sql
-- Safe to re-run: every insert is keyed on a deterministic name.
-- =====================================================================

insert into orgs (id, name, city, contact_email, plan) values
  ('11111111-1111-4111-8111-111111111111', 'Pink City Tech Park', 'Jaipur', 'ops@pinkcitytech.example', 'enterprise')
on conflict (id) do nothing;

-- ------------------------------------------------------- safety zones
-- lighting_index / cctv_coverage are illustrative placeholders. In a real
-- deployment these come from the municipal streetlight asset register and the
-- city surveillance inventory.

insert into safety_zones (city, name, lat, lng, radius_m, lighting_index, incident_index, cctv_coverage) values
  ('Jaipur', 'MI Road corridor',          26.9155, 75.8143, 700, 88, 12, 76),
  ('Jaipur', 'Hawa Mahal / Badi Chaupar', 26.9239, 75.8267, 600, 82, 18, 84),
  ('Jaipur', 'C-Scheme',                  26.9050, 75.7960, 800, 85, 10, 68),
  ('Jaipur', 'Malviya Nagar',             26.8505, 75.8050, 900, 74, 22, 51),
  ('Jaipur', 'Mansarovar',                26.8520, 75.7620, 1000, 69, 26, 44),
  ('Jaipur', 'Vaishali Nagar',            26.9120, 75.7380, 900, 72, 24, 47),
  ('Jaipur', 'Sitapura Industrial Area',  26.7820, 75.8430, 1200, 48, 41, 22),
  ('Jaipur', 'Jagatpura underpass',       26.8180, 75.8600, 500, 36, 55, 12),
  ('Jaipur', 'Delhi Road bypass stretch', 26.9600, 75.8600, 1500, 31, 58, 8),
  ('Jaipur', 'Jaipur Junction station',   26.9196, 75.7880, 500, 90, 20, 92)
on conflict do nothing;

-- ------------------------------------------------------------- notes
-- Driver and profile rows are intentionally NOT seeded here: `profiles.id`
-- references auth.users, so rows must be created through Supabase Auth. To
-- create demo drivers, sign up the accounts first, then run:
--
--   update profiles set gender='female', role='driver', verified=true
--   where id = '<auth-user-id>';
--
--   insert into drivers (
--     id, display_name, gender, vehicle_make, vehicle_model, vehicle_colour,
--     vehicle_plate, vehicle_type, vehicle_gps_enabled, licence_number,
--     licence_expiry, id_verified, background_check_status, background_checked_at,
--     police_verification, safety_training_completed, rating, completed_trips,
--     complaints_12m, languages
--   ) values (
--     '<auth-user-id>', 'Anjali S.', 'female', 'Maruti', 'Dzire', 'White',
--     'RJ14AB1234', 'sedan', true, 'RJ1420110012345', '2029-06-30', true,
--     'cleared', now(), true, true, 4.87, 1240, 0, array['Hindi','English']
--   );
--
-- Until then the backend runs against live presence only, which is enough for
-- a demo but will show an empty driver list.
