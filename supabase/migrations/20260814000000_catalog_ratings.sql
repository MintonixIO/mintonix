-- Stage 1 catalog ratings + player-country columns for homonym identity.
--
-- Country lives on the match roster (scraper already has flagicon). Ratings
-- key on normalized name + country so two "Chen Yu"s do not share a board.
-- Form ratings are a derived snapshot written by compute_ratings.py (GHA).
-- Service-role only — same trust model as the BWF catalog (no anon SELECT).

alter table public.matches
  add column if not exists team1_player1_country text,
  add column if not exists team1_player2_country text,
  add column if not exists team2_player1_country text,
  add column if not exists team2_player2_country text;

create table if not exists public.player_ratings (
  discipline   text not null,
  kind         text not null check (kind in ('player', 'pair')),
  entity_key   text not null,
  display_name text not null,
  country      text,
  mu           double precision not null,
  rd           double precision not null,
  sigma        double precision not null,
  peak_mu      double precision not null,
  peak_rd      double precision not null,
  rank_score   double precision not null,
  matches      int not null default 0,
  wins         int not null default 0,
  losses       int not null default 0,
  last_day     int,
  web_id       text not null,
  updated_at   timestamptz not null default now(),
  primary key (discipline, kind, entity_key)
);

create index if not exists player_ratings_web_id_idx
  on public.player_ratings (web_id);

create index if not exists player_ratings_rank_idx
  on public.player_ratings (discipline, kind, rank_score desc);

create table if not exists public.rating_individuals (
  discipline   text not null,
  entity_key   text not null,
  display_name text not null,
  country      text,
  mu           double precision not null,
  sigma        double precision not null,
  exposure     double precision not null,
  matches      int not null default 0,
  web_id       text not null,
  updated_at   timestamptz not null default now(),
  primary key (discipline, entity_key)
);

create index if not exists rating_individuals_web_id_idx
  on public.rating_individuals (web_id);

create table if not exists public.rating_runs (
  id           bigint generated always as identity primary key,
  computed_at  timestamptz not null default now(),
  match_count  int not null,
  clean_count  int not null,
  entity_count int not null,
  notes        text
);

comment on table public.player_ratings is
  'Glicko-2 form: singles players and doubles pairs. Derived; rewritten each ratings run. Keyed by normalized name + country so homonyms stay split.';
comment on table public.rating_individuals is
  'TrueSkill individuals for MD/WD/XD. Derived; rewritten each ratings run.';
comment on column public.matches.team1_player1_country is
  'ISO-ish association code from Wikipedia flagicon; used for player identity.';

-- Service-role only. Clients never read or write these tables.
revoke all on table public.player_ratings from public, anon, authenticated;
revoke all on table public.rating_individuals from public, anon, authenticated;
revoke all on table public.rating_runs from public, anon, authenticated;
grant all on table public.player_ratings to service_role;
grant all on table public.rating_individuals to service_role;
grant all on table public.rating_runs to service_role;

alter table public.player_ratings enable row level security;
alter table public.rating_individuals enable row level security;
alter table public.rating_runs enable row level security;
