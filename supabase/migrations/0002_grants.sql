-- Explicit table grants. Newer Supabase projects don't automatically grant
-- table privileges to the API roles, which surfaces as:
--   "permission denied for table games"  (edge function writes)
--   HTTP 403 on rest/v1/game_views       (players reading their view)
-- RLS still restricts WHICH rows the reader roles can see; these grants only
-- allow them to query the tables at all.

grant usage on schema public to service_role, authenticated, anon;

-- the edge function (service role) owns all writes
grant all privileges on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

-- players (anonymous auth => authenticated role) only ever read
grant select on public.games, public.players, public.game_views to authenticated, anon;
