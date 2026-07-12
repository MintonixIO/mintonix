-- Match-centric pipeline schema (canonical: SUPABASE.md).
--
-- One product table `matches` (catalog + primary video identity + coarse
-- status) and one `jobs` table (pipeline run; stage advances in place).
-- No videos / video_assets / players graph. B2 paths are constructable:
--   owner_id IS NULL  →  bwf/<match_id>/
--   owner_id set      →  users/<owner_id>/<match_id>/
--
-- Single squashed init: tables + final RPC bodies (ownership checks, VT
-- reclaim under capacity, attempt/stage CAS on settle). Plain CREATE after
-- teardown so a drifted leftover fails loudly on re-apply of this file alone.
--
-- Requires Supabase Queues (pgmq) enabled on the project.
--
-- To re-apply on a linked project without wiping secrets: repair this version
-- as reverted, then `supabase db push` (drops pipeline tables only).

-- ============================================================ teardown (legacy)
-- Drop in dependency order. IF EXISTS so empty / already-new DBs still work.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'ingest_video', 'ingest_match', 'complete_job',
         'dispatch_next_job', 'match_b2_prefix'
       )
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;

drop view if exists match_full;
drop table if exists video_assets cascade;
drop table if exists jobs cascade;
drop table if exists annotation_presets cascade;
drop table if exists videos cascade;
drop table if exists match_players cascade;
drop table if exists players cascade;
drop table if exists nations cascade;
drop table if exists matches cascade;

-- pgmq queues from any prior pipeline (ignore if missing / extension absent).
do $$
begin
  perform pgmq.drop_queue('jobs_interactive');
exception when others then null;
end $$;
do $$
begin
  perform pgmq.drop_queue('jobs_bulk');
exception when others then null;
end $$;

-- ============================================================ matches
-- One row = one match (BWF or user) and its primary video identity.
create table matches (
  id              text primary key,
  owner_id        uuid references auth.users (id),  -- null ⇒ system/BWF
  source_url      text,           -- YouTube (or similar) for first fetch
  tournament      text,           -- e.g. "2026 All England Open-WS-Final"
  match_date      date,
  team1_player1   text,
  team1_player2   text,           -- null for singles
  team2_player1   text,
  team2_player2   text,
  g1_t1 int, g1_t2 int,
  g2_t1 int, g2_t2 int,
  g3_t1 int, g3_t2 int,
  status          text not null default 'pending'
                  check (status in ('pending', 'processing', 'ready', 'failed')),
  duration_sec    real,
  width           int,
  height          int,
  fps             real,
  created_at      timestamptz not null default now()
);

-- FK index (owner_id → auth.users) + RLS lookup. Partial composites match
-- real filters: BWF catalog (owner_id IS NULL) vs user library (owner set).
create index matches_bwf_created_at_idx
  on matches (created_at desc)
  where owner_id is null;
create index matches_user_created_at_idx
  on matches (owner_id, created_at desc)
  where owner_id is not null;
-- Non-terminal rows are the hot set for ops / UI “in flight”.
create index matches_active_status_idx
  on matches (status, created_at desc)
  where status in ('pending', 'processing');
create index matches_match_date_idx on matches (match_date);

-- ============================================================ jobs
-- One row = one pipeline run for a match. Stages (normalize → detect →
-- analyze) advance in place via `stage`; they are not separate job rows.
create table jobs (
  id          uuid primary key default gen_random_uuid(),
  match_id    text not null references matches (id) on delete cascade,
  status      text not null default 'queued'
              check (status in ('queued', 'processing', 'complete', 'failed', 'canceled')),
  stage       text not null default 'normalize'
              check (stage in ('normalize', 'detect', 'analyze')),
  priority    int not null default 100,  -- lower runs first: interactive ~10, bulk ~100
  attempt     int not null default 0,
  error       text,
  queue       text check (queue in ('jobs_interactive', 'jobs_bulk')),
  msg_id      bigint,
  queued_at   timestamptz,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- At most one live job per match; retries and stage advances reuse the row.
create unique index jobs_one_live_per_match_idx
  on jobs (match_id)
  where status in ('queued', 'processing');
-- FK index for joins / ON DELETE CASCADE (Postgres does not auto-index FKs).
create index jobs_match_id_idx on jobs (match_id);
-- Partial indexes for hot status filters (capacity count + SKIP LOCKED fallback).
create index jobs_processing_idx
  on jobs (started_at)
  where status = 'processing';
create index jobs_queued_dispatch_idx
  on jobs (priority, created_at)
  where status = 'queued';

-- ============================================================ updated_at
create or replace function set_updated_at() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists jobs_updated_at on jobs;
create trigger jobs_updated_at
  before update on jobs for each row execute function set_updated_at();

-- ============================================================ grants + RLS
-- Least privilege: revoke public defaults, then grant only what each role needs.
-- service_role: full DML (edge functions, BWF loader; bypasses RLS).
-- authenticated: SELECT only (policies below). anon: nothing.
-- Clients never write these tables — user files go through cdn-access;
-- DB writes are service_role RPCs / edge functions.

grant usage on schema public to anon, authenticated, service_role;

-- Revoke from public/anon/authenticated first: Supabase default privileges
-- grant authenticated TRUNCATE/REFERENCES/TRIGGER on new tables, and TRUNCATE
-- is not subject to RLS. Then re-grant only what each role needs.
revoke all on table matches, jobs from public;
revoke all on table matches, jobs from anon;
revoke all on table matches, jobs from authenticated;

grant select, insert, update, delete on table matches, jobs to service_role;
grant usage, select on all sequences in schema public to service_role;

grant select on table matches, jobs to authenticated;

alter table matches enable row level security;
alter table jobs    enable row level security;

-- Wrap auth.uid() in (select …) so Postgres evaluates once per statement
-- (initPlan cache) instead of per row — critical on large catalogs.
create policy "read own or system" on matches for select to authenticated
  using (
    owner_id = (select auth.uid())
    or owner_id is null
  );

create policy "read via match" on jobs for select to authenticated
  using (exists (
    select 1 from matches m
     where m.id = match_id
       and (
         m.owner_id = (select auth.uid())
         or m.owner_id is null
       )
  ));

-- ============================================================ queues (pgmq)
-- Message body is only { "job_id": "<uuid>" }; full payload is jobs ⨝ matches.
select pgmq.create('jobs_interactive');  -- user-initiated: uploads, re-runs
select pgmq.create('jobs_bulk');         -- BWF / scraper / backlog

-- ============================================================ pipeline RPCs
-- Write paths for matches-ingest and jobs (/dispatch + /callback). Each is
-- ONE transaction. Policy (stage routing, retry limits, envelopes) stays in
-- the edge functions; these only make the agreed writes atomic.
--
-- security definer (owner: postgres) because pgmq lives outside exposed
-- schemas; execute is revoked from everyone but service_role.

-- Constructable B2 prefix (not stored on the row).
create function match_b2_prefix(p_owner_id uuid, p_match_id text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_owner_id is null then 'bwf/' || p_match_id || '/'
    else 'users/' || p_owner_id::text || '/' || p_match_id || '/'
  end
$$;

-- matches-ingest: insert/upsert match + normalize job + queue message.
-- Ownership matrix, FOR UPDATE, user forced interactive/10, prefix from DB.
create function ingest_match(
  p_id              text,
  p_owner_id        uuid    default null,
  p_source_url      text    default null,
  p_tournament      text    default null,
  p_match_date      date    default null,
  p_team1_player1   text    default null,
  p_team1_player2   text    default null,
  p_team2_player1   text    default null,
  p_team2_player2   text    default null,
  p_g1_t1           int     default null,
  p_g1_t2           int     default null,
  p_g2_t1           int     default null,
  p_g2_t2           int     default null,
  p_g3_t1           int     default null,
  p_g3_t2           int     default null,
  p_queue           text    default 'jobs_bulk',
  p_priority        int     default 100,
  p_upsert          boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match  matches%rowtype;
  v_job_id uuid;
  v_msg_id bigint;
  v_queue  text := p_queue;
  v_prio   int  := p_priority;
  v_prefix text;
begin
  if p_id is null or length(trim(p_id)) = 0 then
    raise exception 'match id is required';
  end if;

  -- User-owned work always interactive; ignore caller queue/priority.
  if p_owner_id is not null then
    v_queue := 'jobs_interactive';
    v_prio  := 10;
  end if;

  if v_queue not in ('jobs_interactive', 'jobs_bulk') then
    raise exception 'unknown queue: %', v_queue;
  end if;

  if v_prio < 0 then v_prio := 0; end if;
  if v_prio > 1000 then v_prio := 1000; end if;

  insert into matches (
    id, owner_id, source_url, tournament, match_date,
    team1_player1, team1_player2, team2_player1, team2_player2,
    g1_t1, g1_t2, g2_t1, g2_t2, g3_t1, g3_t2
  ) values (
    p_id, p_owner_id, p_source_url, p_tournament, p_match_date,
    p_team1_player1, p_team1_player2, p_team2_player1, p_team2_player2,
    p_g1_t1, p_g1_t2, p_g2_t1, p_g2_t2, p_g3_t1, p_g3_t2
  )
  on conflict (id) do nothing;

  select * into v_match from matches where id = p_id for update;
  if not found then
    raise exception 'match % missing after insert', p_id;
  end if;

  -- System cannot reclaim user rows; user cannot touch system / other users.
  if p_owner_id is null then
    if v_match.owner_id is not null then
      raise exception 'match % is user-owned; system ingest refused', p_id
        using errcode = '42501';
    end if;
  else
    if v_match.owner_id is null then
      raise exception 'match % is system-owned; user ingest refused', p_id
        using errcode = '42501';
    end if;
    if v_match.owner_id is distinct from p_owner_id then
      raise exception 'match % owned by another user', p_id
        using errcode = '42501';
    end if;
  end if;

  -- Metadata only when caller opts in (BWF re-scrape). Never rewrite owner_id.
  if p_upsert then
    update matches set
      source_url    = coalesce(p_source_url, source_url),
      tournament    = coalesce(p_tournament, tournament),
      match_date    = coalesce(p_match_date, match_date),
      team1_player1 = coalesce(p_team1_player1, team1_player1),
      team1_player2 = coalesce(p_team1_player2, team1_player2),
      team2_player1 = coalesce(p_team2_player1, team2_player1),
      team2_player2 = coalesce(p_team2_player2, team2_player2),
      g1_t1 = coalesce(p_g1_t1, g1_t1),
      g1_t2 = coalesce(p_g1_t2, g1_t2),
      g2_t1 = coalesce(p_g2_t1, g2_t1),
      g2_t2 = coalesce(p_g2_t2, g2_t2),
      g3_t1 = coalesce(p_g3_t1, g3_t1),
      g3_t2 = coalesce(p_g3_t2, g3_t2)
     where id = p_id
     returning * into v_match;
  end if;

  v_prefix := match_b2_prefix(v_match.owner_id, v_match.id);

  select id into v_job_id from jobs
   where match_id = p_id and status in ('queued', 'processing')
   limit 1;
  if v_job_id is not null then
    return jsonb_build_object(
      'match_id', p_id, 'job_id', v_job_id, 'b2_prefix', v_prefix,
      'already_queued', true);
  end if;

  begin
    insert into jobs (match_id, stage, status, priority, queued_at, queue)
    values (p_id, 'normalize', 'queued', v_prio, now(), v_queue)
    returning id into v_job_id;
  exception when unique_violation then
    select id into v_job_id from jobs
     where match_id = p_id and status in ('queued', 'processing')
     limit 1;
    return jsonb_build_object(
      'match_id', p_id, 'job_id', v_job_id, 'b2_prefix', v_prefix,
      'already_queued', true);
  end;

  select pgmq.send(v_queue, jsonb_build_object('job_id', v_job_id)) into v_msg_id;
  update jobs set msg_id = v_msg_id where id = v_job_id;

  update matches set status = 'pending'
   where id = p_id and status in ('ready', 'failed');

  return jsonb_build_object(
    'match_id', p_id, 'job_id', v_job_id, 'b2_prefix', v_prefix);
end $$;

-- jobs /dispatch: pop interactive then bulk.
-- Capacity limits only new queued claims; VT redelivery of processing always
-- reclaims (attempt++), even when at max_running. jobs.priority is metadata /
-- future SKIP LOCKED fallback; live ordering is interactive before bulk.
create function dispatch_next_job(
  p_vt          int default 10800,  -- 3h: download + 4K normalize + OCR
  p_max_running int default 2
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue   text;
  v_msg     record;
  v_job     jobs%rowtype;
  v_tries   int;
  v_running int;
begin
  perform pg_advisory_xact_lock(hashtext('mintonix.dispatch_next_job'));

  foreach v_queue in array array['jobs_interactive', 'jobs_bulk'] loop
    v_tries := 0;
    loop
      v_tries := v_tries + 1;
      exit when v_tries > 8;

      select * into v_msg from pgmq.read(v_queue, p_vt, 1);
      exit when not found;

      select * into v_job from jobs
        where id = (v_msg.message ->> 'job_id')::uuid
        for update;
      if not found or v_job.status in ('complete', 'failed', 'canceled') then
        perform pgmq.archive(v_queue, v_msg.msg_id);
        continue;
      end if;

      -- Already processing: VT redelivery / worker gone → reclaim always.
      if v_job.status = 'processing' then
        update jobs
           set attempt = attempt + 1,
               started_at = now(),
               queue = v_queue,
               msg_id = v_msg.msg_id,
               error = null
         where id = v_job.id
         returning * into v_job;

        return (
          select jsonb_build_object(
            'job_id', j.id, 'stage', j.stage, 'attempt', j.attempt,
            'priority', j.priority, 'queue', j.queue,
            'match_id', m.id, 'owner_id', m.owner_id,
            'source_url', m.source_url,
            'b2_prefix', match_b2_prefix(m.owner_id, m.id),
            'tournament', m.tournament,
            'team1_player1', m.team1_player1, 'team1_player2', m.team1_player2,
            'team2_player1', m.team2_player1, 'team2_player2', m.team2_player2
          )
          from jobs j join matches m on m.id = j.match_id
          where j.id = v_job.id
        );
      end if;

      -- New claim (queued): enforce GPU spend ceiling.
      if v_job.status = 'queued' then
        select count(*) into v_running from jobs where status = 'processing';
        if v_running >= p_max_running then
          begin
            perform pgmq.set_vt(v_queue, v_msg.msg_id, 0);
          exception when others then
            perform pgmq.archive(v_queue, v_msg.msg_id);
            perform pgmq.send(v_queue, v_msg.message);
          end;
          continue;  -- keep scanning for reclaimable processing messages
        end if;

        update jobs
           set status = 'processing',
               attempt = attempt + 1,
               started_at = now(),
               queue = v_queue,
               msg_id = v_msg.msg_id,
               error = null
         where id = v_job.id
         returning * into v_job;

        update matches set status = 'processing'
         where id = v_job.match_id and status in ('pending', 'failed');

        return (
          select jsonb_build_object(
            'job_id', j.id, 'stage', j.stage, 'attempt', j.attempt,
            'priority', j.priority, 'queue', j.queue,
            'match_id', m.id, 'owner_id', m.owner_id,
            'source_url', m.source_url,
            'b2_prefix', match_b2_prefix(m.owner_id, m.id),
            'tournament', m.tournament,
            'team1_player1', m.team1_player1, 'team1_player2', m.team1_player2,
            'team2_player1', m.team2_player1, 'team2_player2', m.team2_player2
          )
          from jobs j join matches m on m.id = j.match_id
          where j.id = v_job.id
        );
      end if;

      perform pgmq.archive(v_queue, v_msg.msg_id);
    end loop;
  end loop;

  return null;
end $$;

-- jobs /callback: settle only when processing + optional attempt/stage CAS.
-- Stage advance resets attempt = 0 (per-stage MAX_ATTEMPTS). First terminal wins.
create function complete_job(
  p_job_id            uuid,
  p_status            text,                       -- 'complete' | 'failed'
  p_error             text    default null,
  p_match             jsonb   default '{}'::jsonb, -- {status?,duration_sec?,width?,height?,fps?}
  p_retry             boolean default false,
  p_next_stage        text    default null,
  p_next_queue        text    default null,
  p_next_priority     int     default null,
  p_expected_attempt  int     default null,
  p_expected_stage    text    default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job    jobs%rowtype;
  v_queue  text;
  v_msg_id bigint;
begin
  if p_status not in ('complete', 'failed') then
    raise exception 'status must be complete or failed, got %', p_status;
  end if;

  select * into v_job from jobs where id = p_job_id for update;
  if not found then
    raise exception 'job % not found', p_job_id;
  end if;

  if v_job.status in ('complete', 'failed', 'canceled') then
    return jsonb_build_object('job_id', p_job_id, 'already_terminal', true);
  end if;

  if v_job.status is distinct from 'processing' then
    return jsonb_build_object(
      'job_id', p_job_id,
      'rejected', true,
      'reason', 'not_processing',
      'status', v_job.status);
  end if;

  if p_expected_attempt is not null
     and v_job.attempt is distinct from p_expected_attempt then
    return jsonb_build_object(
      'job_id', p_job_id,
      'rejected', true,
      'reason', 'attempt_mismatch',
      'expected', p_expected_attempt,
      'actual', v_job.attempt);
  end if;

  if p_expected_stage is not null
     and v_job.stage is distinct from p_expected_stage then
    return jsonb_build_object(
      'job_id', p_job_id,
      'rejected', true,
      'reason', 'stage_mismatch',
      'expected', p_expected_stage,
      'actual', v_job.stage);
  end if;

  if v_job.queue is not null and v_job.msg_id is not null then
    perform pgmq.archive(v_job.queue, v_job.msg_id);
  end if;

  if p_status = 'failed' and p_retry then
    v_queue := coalesce(v_job.queue, 'jobs_bulk');
    select pgmq.send(v_queue, jsonb_build_object('job_id', p_job_id)) into v_msg_id;
    update jobs
       set status = 'queued', error = p_error, queued_at = now(),
           queue = v_queue, msg_id = v_msg_id, finished_at = null,
           started_at = null
     where id = p_job_id
       and attempt = v_job.attempt
       and status = 'processing';
    return jsonb_build_object('job_id', p_job_id, 'status', 'queued',
                              'attempt', v_job.attempt, 'stage', v_job.stage);
  end if;

  if p_status = 'complete' and p_next_stage is not null then
    if p_next_stage not in ('normalize', 'detect', 'analyze') then
      raise exception 'invalid next stage: %', p_next_stage;
    end if;
    v_queue := coalesce(p_next_queue, v_job.queue, 'jobs_bulk');
    select pgmq.send(v_queue, jsonb_build_object('job_id', p_job_id)) into v_msg_id;
    update jobs
       set stage = p_next_stage,
           status = 'queued',
           attempt = 0,
           priority = coalesce(p_next_priority, priority),
           error = null,
           queued_at = now(),
           started_at = null,
           finished_at = null,
           queue = v_queue,
           msg_id = v_msg_id
     where id = p_job_id
       and attempt = v_job.attempt
       and status = 'processing';

    update matches
       set status       = coalesce(p_match ->> 'status', 'processing'),
           duration_sec = coalesce((p_match ->> 'duration_sec')::real, duration_sec),
           width        = coalesce((p_match ->> 'width')::int, width),
           height       = coalesce((p_match ->> 'height')::int, height),
           fps          = coalesce((p_match ->> 'fps')::real, fps)
     where id = v_job.match_id;

    return jsonb_build_object(
      'job_id', p_job_id, 'status', 'queued', 'stage', p_next_stage,
      'attempt', 0);
  end if;

  update jobs
     set status = p_status, error = p_error, finished_at = now()
   where id = p_job_id
     and attempt = v_job.attempt
     and status = 'processing';

  update matches
     set status       = coalesce(p_match ->> 'status',
                          case when p_status = 'failed' then 'failed'
                               when p_status = 'complete' then 'ready' end,
                          status),
         duration_sec = coalesce((p_match ->> 'duration_sec')::real, duration_sec),
         width        = coalesce((p_match ->> 'width')::int, width),
         height       = coalesce((p_match ->> 'height')::int, height),
         fps          = coalesce((p_match ->> 'fps')::real, fps)
   where id = v_job.match_id;

  return jsonb_build_object('job_id', p_job_id, 'status', p_status,
                            'stage', v_job.stage);
end $$;

revoke execute on function ingest_match, dispatch_next_job, complete_job, match_b2_prefix
  from public, anon, authenticated;
grant execute on function ingest_match, dispatch_next_job, complete_job
  to service_role;
grant execute on function match_b2_prefix to service_role;

-- Platform event-trigger helper (auto-enable RLS on new public tables). Not
-- our API surface — strip PostgREST execute grants if the function exists.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- Cron sketch (left commented: URL + token are per-project Vault / secrets state —
-- re-applying this migration does not touch them):
-- select cron.schedule('jobs-dispatch', '* * * * *', $cron$
--   select net.http_post(
--     url     := (select decrypted_secret from vault.decrypted_secrets
--                 where name = 'jobs_dispatch_url'),
--     headers := jsonb_build_object('x-pipeline-token',
--                (select decrypted_secret from vault.decrypted_secrets
--                 where name = 'pipeline_service_token'),
--                'Content-Type', 'application/json'),
--     body    := '{}'::jsonb)
-- $cron$);
