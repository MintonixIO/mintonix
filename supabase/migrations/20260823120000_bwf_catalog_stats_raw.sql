-- Headline catalog stats without a second tournament parser.
-- Facets (event / disc / round / year) are built in TS via parseTournament.
-- Service-role only — same trust model as lib/bwf/catalog.ts.

create or replace function public.bwf_catalog_stats()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with sys as (
    select
      tournament,
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
  roster as (
    select distinct
      trim(name) as name,
      nullif(trim(country), '') as country
    from sys
    cross join lateral (
      values
        (team1_player1, team1_player1_country),
        (team1_player2, team1_player2_country),
        (team2_player1, team2_player1_country),
        (team2_player2, team2_player2_country)
    ) as r(name, country)
    where name is not null and length(trim(name)) > 0
  )
  select jsonb_build_object(
    'matches', (select count(*)::int from sys),
    'players', (select count(*)::int from roster),
    'with_video', (
      select count(*)::int from sys
      where source_url ~* 'youtube\.com|youtu\.be'
    ),
    'tournament_strings', coalesce((
      select jsonb_agg(
        jsonb_build_object('tournament', tournament, 'count', count)
        order by count desc, tournament
      )
      from (
        select tournament, count(*)::int as count
        from sys
        where tournament is not null and length(trim(tournament)) > 0
        group by tournament
      ) t
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.bwf_catalog_stats() from public;
revoke all on function public.bwf_catalog_stats() from anon, authenticated;
grant execute on function public.bwf_catalog_stats() to service_role;

comment on function public.bwf_catalog_stats() is
  'BWF catalog headline counts + distinct raw tournament strings. Facets parsed in TS. Service-role only.';
