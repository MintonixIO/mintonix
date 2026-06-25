-- Make match-data private: no public (anon/authenticated) access.
-- Reverses the public-read policies from 20260623000100. RLS stays enabled with
-- no policies, and the read grants are revoked, so only service_role (which
-- bypasses RLS and keeps its DML grants) can read or write. The frontend must
-- read via a server-side context using the service role key, not the anon key.

drop policy if exists "public read" on nations;
drop policy if exists "public read" on players;
drop policy if exists "public read" on matches;
drop policy if exists "public read" on match_players;

revoke select on all tables in schema public from anon, authenticated;
