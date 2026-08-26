-- Read-side catalog stats for the web BWF UI (one round trip, no 1k paging).
-- Service-role only — same trust model as lib/bwf/catalog.ts.
-- Tournament string format: "{title} · {discipline} · {round}".

create or replace function public.bwf_catalog_stats()
returns jsonb
language sql
stable
set search_path = public
as $$
  with sys as (
    select
      tournament,
      match_date,
      source_url,
      team1_player1,
      team1_player1_country,
      team1_player2,
      team1_player2_country,
      team2_player1,
      team2_player1_country,
      team2_player2,
      team2_player2_country
    from public.matches
    where owner_id is null
  ),
  parsed as (
    select
      nullif(
        trim(
          regexp_replace(
            split_part(coalesce(tournament, ''), ' · ', 1),
            '\s*\(badminton\)\s*',
            ' ',
            'gi'
          )
        ),
        ''
      ) as event,
      upper(nullif(trim(split_part(coalesce(tournament, ''), ' · ', 2)), '')) as disc,
      nullif(trim(split_part(coalesce(tournament, ''), ' · ', 3)), '') as round,
      match_date,
      source_url,
      team1_player1,
      team1_player1_country,
      team1_player2,
      team1_player2_country,
      team2_player1,
      team2_player1_country,
      team2_player2,
      team2_player2_country
    from sys
  ),
  roster as (
    select distinct
      trim(name) as name,
      nullif(trim(country), '') as country
    from parsed
    cross join lateral (
      values
        (team1_player1, team1_player1_country),
        (team1_player2, team1_player2_country),
        (team2_player1, team2_player1_country),
        (team2_player2, team2_player2_country)
    ) as r(name, country)
    where name is not null and length(trim(name)) > 0
  ),
  event_rows as (
    select
      event,
      coalesce(
        (substring(event from '(20[0-9]{2}|19[0-9]{2})'))::int,
        extract(year from match_date)::int
      ) as year,
      count(*)::int as count
    from parsed
    where event is not null
    group by 1, 2
  )
  select jsonb_build_object(
    'matches', (select count(*)::int from parsed),
    'players', (select count(*)::int from roster),
    'tournaments', (
      select count(distinct event)::int from parsed where event is not null
    ),
    'with_video', (
      select count(*)::int from parsed
      where source_url ~* 'youtube\.com|youtu\.be'
    ),
    'by_disc', jsonb_build_object(
      'MS', (select count(*)::int from parsed where disc = 'MS'),
      'WS', (select count(*)::int from parsed where disc = 'WS'),
      'MD', (select count(*)::int from parsed where disc = 'MD'),
      'WD', (select count(*)::int from parsed where disc = 'WD'),
      'XD', (select count(*)::int from parsed where disc = 'XD')
    ),
    'events', coalesce((
      select jsonb_agg(
        jsonb_build_object('event', event, 'year', year, 'count', count)
        order by count desc
      )
      from event_rows
    ), '[]'::jsonb),
    'rounds', coalesce((
      select jsonb_agg(round order by round)
      from (select distinct round from parsed where round is not null) r
    ), '[]'::jsonb),
    'years', coalesce((
      select jsonb_agg(year order by year desc)
      from (select distinct year from event_rows where year is not null) y
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.bwf_catalog_stats() from public;
revoke all on function public.bwf_catalog_stats() from anon, authenticated;
grant execute on function public.bwf_catalog_stats() to service_role;

comment on function public.bwf_catalog_stats() is
  'BWF catalog headline stats + match-list facets. Service-role only.';

-- This-week / recent match lists filter owner_id IS NULL + match_date.
create index if not exists matches_bwf_match_date_idx
  on public.matches (match_date desc nulls last)
  where owner_id is null;
