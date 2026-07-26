-- Smoke checks for ops_set_stage (run against local Supabase after migrations).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/smoke_ops_set_stage.sql
--
-- Assumes:
--   - public.matches / public.jobs / ops_set_stage exist
--   - pgmq queues jobs_interactive / jobs_bulk exist
-- Cleanup at end deletes the smoke match (cascade jobs).
--
-- ---------------------------------------------------------------------------
-- unique_violation race (not automated in a single session)
-- ---------------------------------------------------------------------------
-- The INSERT path catches unique_violation when a concurrent ops_set_stage
-- (or ingest) already created a live job for the match. The handler re-LOCKs
-- that live row and applies the SAME contract as the main path:
--
--   * processing + cancel_live=false → reject live_processing (no mutate)
--   * processing + cancel_live=true  → cancel old, INSERT new job_id
--   * queued                         → archive pgmq + reuse row at stage
--
-- Multi-session recipe (two psql clients, same DATABASE_URL):
--
--   Session A:
--     begin;
--     insert into matches (id, status) values ('__race__', 'pending')
--       on conflict do nothing;
--     select * from matches where id = '__race__' for update;
--
--   Session B:
--     select ops_set_stage('__race__', 'normalize', true, true);
--
-- Practical single-session approximation of the reject branch:
--     1. Create match + live processing job (as step 3 in this file does).
--     2. Call ops_set_stage(..., p_cancel_live := false) → live_processing.

begin;

-- ---------------------------------------------------------------------------
-- 0) Grants: authenticated must not execute
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  select has_function_privilege('service_role', 'ops_set_stage(text,text,boolean,boolean)', 'execute') as ok
    into r;
  if not coalesce(r.ok, false) then
    raise exception 'service_role missing EXECUTE on ops_set_stage';
  end if;

  select has_function_privilege('authenticated', 'ops_set_stage(text,text,boolean,boolean)', 'execute') as ok
    into r;
  if coalesce(r.ok, false) then
    raise exception 'authenticated must NOT have EXECUTE on ops_set_stage';
  end if;

  select has_function_privilege('anon', 'ops_set_stage(text,text,boolean,boolean)', 'execute') as ok
    into r;
  if coalesce(r.ok, false) then
    raise exception 'anon must NOT have EXECUTE on ops_set_stage';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fixture match
-- ---------------------------------------------------------------------------
insert into matches (id, owner_id, status, source_url)
values ('__smoke_ops_set_stage__', null, 'ready', 'https://example.com/smoke')
on conflict (id) do update
  set status = 'ready', owner_id = null;

-- Ensure no leftover live jobs from a prior partial run
update jobs
   set status = 'canceled', finished_at = now(), msg_id = null, queue = null
 where match_id = '__smoke_ops_set_stage__'
   and status in ('queued', 'processing');

-- ---------------------------------------------------------------------------
-- 1) enqueue=false with no prior job → created_job, msg_id null, queue null
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  v_job jobs%rowtype;
begin
  v := ops_set_stage('__smoke_ops_set_stage__', 'detect', false, true);
  if (v->>'ok')::boolean is not true then
    raise exception 'enqueue=false create failed: %', v;
  end if;
  if (v->>'created_job')::boolean is not true then
    raise exception 'expected created_job: %', v;
  end if;
  if (v->>'enqueue')::boolean is not false then
    raise exception 'enqueue flag: %', v;
  end if;
  if v->>'queue' is not null and v->>'queue' <> 'null' then
    raise exception 'enqueue=false queue should be null: %', v;
  end if;

  select * into v_job from jobs where id = (v->>'job_id')::uuid;
  if v_job.status <> 'queued' or v_job.stage <> 'detect' then
    raise exception 'job state: % %', v_job.status, v_job.stage;
  end if;
  if v_job.msg_id is not null or v_job.queue is not null then
    raise exception 'enqueue=false must clear msg_id/queue: % %', v_job.msg_id, v_job.queue;
  end if;
  if (select status from matches where id = '__smoke_ops_set_stage__') <> 'pending' then
    raise exception 'match status should be pending after set-stage';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) enqueue=true on existing non-dispatchable live row → reuse, msg_id set
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  v_job jobs%rowtype;
  v_old uuid;
begin
  select id into v_old from jobs
   where match_id = '__smoke_ops_set_stage__' and status in ('queued', 'processing')
   limit 1;

  v := ops_set_stage('__smoke_ops_set_stage__', 'analyze', true, true);
  if (v->>'ok')::boolean is not true then
    raise exception 'enqueue reuse failed: %', v;
  end if;
  if (v->>'had_live')::boolean is not true then
    raise exception 'expected had_live: %', v;
  end if;
  if (v->>'job_id')::uuid is distinct from v_old then
    raise exception 'queued live should reuse job_id old=% new=%', v_old, v->>'job_id';
  end if;
  if v->>'queue' is distinct from 'jobs_interactive' then
    raise exception 'queue name: %', v;
  end if;
  if (v->>'enqueue')::boolean is not true then
    raise exception 'enqueue flag: %', v;
  end if;

  select * into v_job from jobs where id = (v->>'job_id')::uuid;
  if v_job.stage <> 'analyze' or v_job.status <> 'queued' then
    raise exception 'queue job state bad: %', v_job;
  end if;
  if v_job.msg_id is null then
    raise exception 'enqueue=true requires msg_id';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) processing + cancel_live=false → reject live_processing (no mutate)
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  v_id uuid;
  v_msg bigint;
  v_q text;
begin
  select id, msg_id, queue into v_id, v_msg, v_q from jobs
   where match_id = '__smoke_ops_set_stage__' and status = 'queued'
   limit 1;
  update jobs set status = 'processing', attempt = 1, started_at = now()
   where id = v_id;

  v := ops_set_stage('__smoke_ops_set_stage__', 'normalize', true, false);
  if (v->>'rejected')::boolean is not true then
    raise exception 'expected reject: %', v;
  end if;
  if v->>'reason' is distinct from 'live_processing' then
    raise exception 'reason: %', v;
  end if;

  -- still processing; msg/queue untouched
  if (select status from jobs where id = v_id) <> 'processing' then
    raise exception 'reject must not mutate processing job';
  end if;
  if (select msg_id from jobs where id = v_id) is distinct from v_msg then
    raise exception 'reject must not touch msg_id';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) processing + cancel_live=true + enqueue=false → cancel old, new job_id,
--    queue cleared on canceled row
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  v_old uuid;
  v_new uuid;
begin
  select id into v_old from jobs
   where match_id = '__smoke_ops_set_stage__' and status = 'processing'
   limit 1;

  v := ops_set_stage('__smoke_ops_set_stage__', 'normalize', false, true);
  if (v->>'ok')::boolean is not true then
    raise exception 'cancel processing failed: %', v;
  end if;
  if (v->>'canceled_processing')::boolean is not true then
    raise exception 'expected canceled_processing: %', v;
  end if;
  if (v->>'canceled_job_id')::uuid is distinct from v_old then
    raise exception 'canceled_job_id: %', v;
  end if;
  v_new := (v->>'job_id')::uuid;
  if v_new is not distinct from v_old then
    raise exception 'must create new job_id after cancel processing';
  end if;
  if (select status from jobs where id = v_old) <> 'canceled' then
    raise exception 'old job should be canceled';
  end if;
  if (select queue from jobs where id = v_old) is not null then
    raise exception 'canceled job must clear queue';
  end if;
  if (select msg_id from jobs where id = v_old) is not null then
    raise exception 'canceled job must clear msg_id';
  end if;
  if (select status from jobs where id = v_new) <> 'queued' then
    raise exception 'new job should be queued';
  end if;
  if (select stage from jobs where id = v_new) <> 'normalize' then
    raise exception 'new job stage';
  end if;
  if (select msg_id from jobs where id = v_new) is not null then
    raise exception 'enqueue=false new job must have null msg_id';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5) cancel processing + enqueue=true → new job_id with msg_id on interactive
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  v_old uuid;
  v_new uuid;
  v_job jobs%rowtype;
begin
  -- Force current live job into processing with a fake queue name (msg may be null).
  select id into v_old from jobs
   where match_id = '__smoke_ops_set_stage__' and status = 'queued'
   limit 1;
  update jobs
     set status = 'processing', attempt = 1, started_at = now(),
         queue = 'jobs_interactive'
   where id = v_old;

  v := ops_set_stage('__smoke_ops_set_stage__', 'detect', true, true);
  if (v->>'ok')::boolean is not true then
    raise exception 'cancel+enqueue failed: %', v;
  end if;
  if (v->>'canceled_processing')::boolean is not true then
    raise exception 'expected canceled_processing: %', v;
  end if;
  if (v->>'enqueue')::boolean is not true then
    raise exception 'enqueue true: %', v;
  end if;
  v_new := (v->>'job_id')::uuid;
  if v_new is not distinct from v_old then
    raise exception 'cancel+enqueue must mint new job_id';
  end if;
  if (select status from jobs where id = v_old) <> 'canceled' then
    raise exception 'old not canceled';
  end if;
  if (select queue from jobs where id = v_old) is not null then
    raise exception 'old queue not cleared';
  end if;

  select * into v_job from jobs where id = v_new;
  if v_job.stage <> 'detect' or v_job.status <> 'queued' then
    raise exception 'new job state: %', v_job;
  end if;
  if v_job.queue is distinct from 'jobs_interactive' or v_job.msg_id is null then
    raise exception 'cancel+enqueue needs interactive msg_id: % %', v_job.queue, v_job.msg_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6) enqueue=true create after canceling live (no prior live) path:
--    terminal-ize live, then enqueue=true create from empty
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  v_job jobs%rowtype;
begin
  update jobs
     set status = 'canceled', finished_at = now(), msg_id = null, queue = null
   where match_id = '__smoke_ops_set_stage__'
     and status in ('queued', 'processing');

  v := ops_set_stage('__smoke_ops_set_stage__', 'analyze', true, true);
  if (v->>'ok')::boolean is not true then
    raise exception 'enqueue=true create failed: %', v;
  end if;
  if (v->>'created_job')::boolean is not true then
    raise exception 'expected created_job: %', v;
  end if;
  if (v->>'enqueue')::boolean is not true then
    raise exception 'enqueue: %', v;
  end if;
  if v->>'queue' is distinct from 'jobs_interactive' then
    raise exception 'queue: %', v;
  end if;

  select * into v_job from jobs where id = (v->>'job_id')::uuid;
  if v_job.msg_id is null or v_job.stage <> 'analyze' then
    raise exception 'create enqueue job: %', v_job;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7) archive live msg then enqueue=false (park-with-live-msg): reuse row
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  v_old uuid;
  v_job jobs%rowtype;
begin
  select id into v_old from jobs
   where match_id = '__smoke_ops_set_stage__' and status = 'queued'
   limit 1;

  v := ops_set_stage('__smoke_ops_set_stage__', 'detect', false, true);
  if (v->>'ok')::boolean is not true then
    raise exception 'archive then enqueue=false failed: %', v;
  end if;
  if (v->>'job_id')::uuid is distinct from v_old then
    raise exception 'should reuse live queued job';
  end if;
  if (v->>'had_live')::boolean is not true then
    raise exception 'had_live expected';
  end if;

  select * into v_job from jobs where id = v_old;
  if v_job.stage <> 'detect' or v_job.msg_id is not null or v_job.queue is not null then
    raise exception 'after archive+enqueue=false: %', v_job;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8) validation failures
-- ---------------------------------------------------------------------------
do $$
declare
  ok boolean;
begin
  begin
    perform ops_set_stage('__smoke_ops_set_stage__', 'nope', true, true);
    raise exception 'invalid stage should error';
  exception when others then
    if sqlerrm not like '%invalid stage%' then
      raise exception 'unexpected: %', sqlerrm;
    end if;
  end;

  begin
    perform ops_set_stage('', 'normalize', true, true);
    raise exception 'empty match id should error';
  exception when others then
    if sqlerrm not like '%match id%' then
      raise exception 'unexpected: %', sqlerrm;
    end if;
  end;

  begin
    perform ops_set_stage('__no_such_match__', 'normalize', true, true);
    raise exception 'missing match should error';
  exception when others then
    if sqlerrm not like '%not found%' then
      raise exception 'unexpected: %', sqlerrm;
    end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Cleanup
-- ---------------------------------------------------------------------------
delete from matches where id = '__smoke_ops_set_stage__';

commit;

\echo 'smoke_ops_set_stage: OK'
