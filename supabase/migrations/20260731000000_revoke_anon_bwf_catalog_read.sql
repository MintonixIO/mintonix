-- Revoke public anon BWF catalog SELECT.
--
-- Product path (2026-07): web BWF catalog is **service-role only**
-- (`apps/web/lib/bwf/catalog.ts`). The earlier optional policy
-- (`20260729145118_public_bwf_catalog_read.sql`, applied via pipeline #9)
-- is not the product path and is dropped here so anon cannot read system
-- matches via RLS.
--
-- Safe / additive for applied history — do not rewrite the older migration.

drop policy if exists "public read bwf catalog" on public.matches;

revoke select on table public.matches from anon;
