-- Match-data schema: BWF World Tour results scraped from Wikipedia + one
-- matched YouTube video per match. See workers/github/match-data/schema.md.
--
-- Four tables + one read-model view. All loads are idempotent upserts keyed on
-- a natural unique column, so re-running the loader never duplicates rows.

-- This is the init migration: it runs once on an empty schema and is the
-- authoritative definition. Plain CREATE (no IF NOT EXISTS) is intentional so a
-- re-apply or a pre-existing, drifted object fails loudly instead of silently
-- no-op'ing and leaving the DB out of sync with this file.

-- ============================================================ nations
-- Small lookup so flag URLs aren't repeated per player.
-- flag_url is backfilled out-of-band and never set by the scraper.
create table nations (
  code     text primary key,  -- country code from {{flagicon|XX}}
  name     text,
  flag_url text
);

-- ============================================================ players
-- Normalized so player-centric queries are clean indexed joins.
-- avatar_url is backfilled out-of-band and never set by the scraper.
create table players (
  id         bigint generated always as identity primary key,
  name       text unique not null,  -- wiki page title when available, else display text
  country    text references nations (code),
  avatar_url text
);

-- ============================================================ matches
-- Denormalized: tournament title, discipline, round, date, seeds, all set
-- scores, and the matched video live on the row. Most match-centric queries
-- touch only this table.
--
-- match_key = "{season}|{tournament}|{discipline}|{section}|{round}|{match_idx}"
-- section is required for uniqueness: split draws restart match_idx within each
-- section (Top half / Section 1, ...), so without it the key collides ~4x.
create table matches (
  id               bigint generated always as identity primary key,
  match_key        text unique not null,
  season           int,
  tournament       text,   -- e.g. "2026 All England Open"
  discipline       text,   -- MS / WS / MD / WD / XD
  section          text,   -- draw section path, e.g. "Men's singles/Top half/Section 1"
  round            text,   -- "Quarter-finals", "Final", ...
  match_idx        int,    -- ordinal within (discipline, section, round)
  match_date       date,
  team1_seed       text,
  team2_seed       text,
  winner           int,    -- 1 or 2 (nullable if undecided)
  games_won        text,   -- e.g. "2-1"
  g1_t1 int, g1_t2 int,    -- game 1 scores
  g2_t1 int, g2_t2 int,    -- game 2 scores
  g3_t1 int, g3_t2 int,    -- game 3 scores (best-of-3)
  video_id         text,        -- matched YouTube id; set by the matcher
  video_title      text,        -- set by the matcher
  video_confidence numeric,     -- set by the matcher
  scraped_at       timestamptz
);

-- ============================================================ match_players
-- Junction linking matches to players, with the side they played on.
-- Doubles (MD/WD/XD) are two rows sharing a team_side.
create table match_players (
  match_id  bigint references matches (id) on delete cascade,
  player_id bigint references players (id),
  team_side int,  -- 1 or 2
  unique (match_id, player_id)
);

create index match_players_player_id_idx on match_players (player_id);

-- ============================================================ match_full (view)
-- Match-centric read model: one row per match with team rosters folded back in,
-- so the frontend can render a match without manually joining the junction.
-- Player queries still use match_players / players directly.
create or replace view match_full as
select
  m.*,
  array_agg(p.name) filter (where mp.team_side = 1) as team1_players,
  array_agg(p.name) filter (where mp.team_side = 2) as team2_players
from matches m
left join match_players mp on mp.match_id = m.id
left join players p        on p.id = mp.player_id
group by m.id;
