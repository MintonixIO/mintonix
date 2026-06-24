# Match-data Supabase schema

Stores BWF World Tour results scraped from Wikipedia, plus one matched YouTube
video per match. Designed for both **match-centric** queries (one row per match,
mostly join-free) and **player-centric** queries (via the `match_players`
junction).

Four tables + one read-model view.

## Design notes

- **`matches` is denormalized** — tournament title, discipline, round, date,
  seeds, all set scores, and the matched video live on the row. Most
  match-centric queries touch only this table.
- **Players are normalized** (`players` + `match_players`) so player-centric
  queries ("all of a player's matches") are clean indexed joins, and doubles
  (MD/WD/XD) are two `match_players` rows sharing a `team_side`.
- **One video per match** — folded into `matches` as columns, no separate table.
- **`nations`** is a small lookup so flag URLs aren't repeated per player.
- **Idempotent loads** — every table upserts on a natural unique key, so
  re-running the loader never duplicates rows.
- **Backfilled columns are never overwritten** — the scraper-driven loader omits
  `players.avatar_url` and `nations.flag_url` from its payloads, so values added
  out-of-band survive re-loads.

---

## `nations`

| column   | type | notes                                              |
|----------|------|----------------------------------------------------|
| code     | text | **PK**. Country code from `{{flagicon\|XX}}`        |
| name     | text |                                                    |
| flag_url | text | nullable; **not** set by the scraper               |

```sql
CREATE TABLE nations (
  code     text PRIMARY KEY,
  name     text,
  flag_url text
);
```

## `players`

| column     | type   | notes                                  |
|------------|--------|----------------------------------------|
| id         | bigint | **PK**, identity                       |
| name       | text   | **UNIQUE** (upsert key). Wiki page title when available, else display text |
| country    | text   | FK → `nations(code)`                    |
| avatar_url | text   | nullable; **not** set by the scraper   |

```sql
CREATE TABLE players (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text UNIQUE NOT NULL,
  country    text REFERENCES nations(code),
  avatar_url text
);
```

## `matches`

| column           | type        | notes                                          |
|------------------|-------------|------------------------------------------------|
| id               | bigint      | **PK**, identity                               |
| match_key        | text        | **UNIQUE** (upsert key), see below             |
| season           | int         |                                                |
| tournament       | text        | title, e.g. "2026 All England Open"            |
| discipline       | text        | MS / WS / MD / WD / XD                          |
| section          | text        | draw section path, e.g. "Men's singles/Top half/Section 1" |
| round            | text        | "Quarter-finals", "Final", ...                 |
| match_idx        | int         | ordinal within (discipline, section, round)    |
| match_date       | date        | nullable                                       |
| team1_seed       | text        | nullable                                       |
| team2_seed       | text        | nullable                                       |
| winner           | int         | 1 or 2 (nullable if undecided)                 |
| games_won        | text        | e.g. "2–1"                                      |
| g1_t1, g1_t2     | int         | game 1 scores, nullable                        |
| g2_t1, g2_t2     | int         | game 2 scores, nullable                        |
| g3_t1, g3_t2     | int         | game 3 scores, nullable (best-of-3)            |
| video_id         | text        | matched YouTube id; set by the matcher         |
| video_title      | text        | set by the matcher                             |
| video_confidence | numeric     | set by the matcher                             |
| scraped_at       | timestamptz |                                                |

`match_key = "{season}|{tournament}|{discipline}|{section}|{round}|{match_idx}"`

`section` is required for uniqueness: split draws restart `match_idx` within each
section (Top half / Section 1, ...), so without it the key collides ~4×.

```sql
CREATE TABLE matches (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_key        text UNIQUE NOT NULL,
  season           int,
  tournament       text,
  discipline       text,
  section          text,
  round            text,
  match_idx        int,
  match_date       date,
  team1_seed       text,
  team2_seed       text,
  winner           int,
  games_won        text,
  g1_t1 int, g1_t2 int,
  g2_t1 int, g2_t2 int,
  g3_t1 int, g3_t2 int,
  video_id         text,
  video_title      text,
  video_confidence numeric,
  scraped_at       timestamptz
);
```

## `match_players`

Junction linking matches to players, with the side they played on.

| column    | type   | notes                              |
|-----------|--------|------------------------------------|
| match_id  | bigint | FK → `matches(id)` ON DELETE CASCADE |
| player_id | bigint | FK → `players(id)`                 |
| team_side | int    | 1 or 2                             |

`UNIQUE (match_id, player_id)` — the upsert key.

```sql
CREATE TABLE match_players (
  match_id  bigint REFERENCES matches(id) ON DELETE CASCADE,
  player_id bigint REFERENCES players(id),
  team_side int,
  UNIQUE (match_id, player_id)
);
CREATE INDEX ON match_players (player_id);
```

---

## `match_full` (view)

Match-centric read model: one row per match with team rosters folded back in,
so the frontend can render a match without manually joining the junction. Player
queries still use `match_players`/`players` directly.

```sql
CREATE VIEW match_full AS
SELECT
  m.*,
  array_agg(p.name) FILTER (WHERE mp.team_side = 1) AS team1_players,
  array_agg(p.name) FILTER (WHERE mp.team_side = 2) AS team2_players
FROM matches m
LEFT JOIN match_players mp ON mp.match_id = m.id
LEFT JOIN players p        ON p.id = mp.player_id
GROUP BY m.id;
```

---

## Populated by which job

| table / column                         | source                          |
|----------------------------------------|---------------------------------|
| `nations.code` / `name`                | scraper → loader                |
| `nations.flag_url`                     | manual / one-off backfill       |
| `players.name` / `country`             | scraper → loader                |
| `players.avatar_url`                   | manual / one-off backfill       |
| `matches.*` (results)                  | scraper → loader                |
| `matches.video_*`                      | YouTube matcher                 |
| `match_players.*`                      | scraper → loader                |
