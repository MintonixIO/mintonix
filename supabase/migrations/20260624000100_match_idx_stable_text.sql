-- Make match_idx content-derived and stable.
--
-- match_idx was a positional ordinal (int) within (discipline, section, round).
-- Because match_key embeds it, inserting/removing/reordering a match on
-- Wikipedia shifted every later match's key, which re-keyed the rows on the next
-- load — orphaning the old rows and breaking their video links. The scraper now
-- derives match_idx from the match roster (a short SHA1 hash like 'r1a2b3c4d5',
-- or 'p1' for bye/unparseable rosters), which stays pinned to the match. Those
-- values are text, so widen the column.
--
-- match_full does `select m.*`, so it must be dropped and recreated around the
-- column type change (Postgres can't alter a type a view depends on).

drop view if exists match_full;

alter table matches
  alter column match_idx type text using match_idx::text;

create or replace view match_full as
select
  m.*,
  array_agg(p.name) filter (where mp.team_side = 1) as team1_players,
  array_agg(p.name) filter (where mp.team_side = 2) as team2_players
from matches m
left join match_players mp on mp.match_id = m.id
left join players p        on p.id = mp.player_id
group by m.id;
