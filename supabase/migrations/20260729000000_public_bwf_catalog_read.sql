-- Optional: allow anon (publishable key) to SELECT system/BWF matches only.
-- User-owned rows stay private. Web BWF pages currently use service role
-- server-side; this policy enables a future anon-only catalog path.
-- Safe / additive — no data mutation.

grant select on table public.matches to anon;

create policy "public read bwf catalog"
  on public.matches
  for select
  to anon
  using (owner_id is null);
