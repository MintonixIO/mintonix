-- Historical: optional anon SELECT on system/BWF matches (owner_id IS NULL).
--
-- **Superseded.** Product decision (2026-07): the web BWF catalog is
-- **server-private** — Next.js loaders use the service role + owner_id IS NULL
-- (`apps/web/lib/bwf/catalog.ts`). Public anon read is **not** the product path.
--
-- Revoked by `20260731000000_revoke_anon_bwf_catalog_read.sql` (drop policy +
-- revoke SELECT). Keep this file for migration history only; do not re-apply
-- the grants below on new environments without an intentional product change.
-- Safe / additive when first applied — no data mutation.

grant select on table public.matches to anon;

create policy "public read bwf catalog"
  on public.matches
  for select
  to anon
  using (owner_id is null);
