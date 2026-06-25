-- Access control for match-data.
-- The ETL loader authenticates as service_role and needs full DML; the frontend
-- uses anon/authenticated and should have read-only access. service_role bypasses
-- RLS, so writes are implicitly restricted to it while public read is explicit.

grant usage on schema public to anon, authenticated, service_role;

-- Loader (service_role) — full DML + sequence usage for identity columns.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Frontend (anon/authenticated) — read only (covers the match_full view too).
grant select on all tables in schema public to anon, authenticated;

-- Keep RLS on; expose public read, no public write.
alter table nations       enable row level security;
alter table players       enable row level security;
alter table matches       enable row level security;
alter table match_players enable row level security;

create policy "public read" on nations       for select using (true);
create policy "public read" on players       for select using (true);
create policy "public read" on matches       for select using (true);
create policy "public read" on match_players for select using (true);
