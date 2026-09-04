-- Smoke checks for complete_job p_complete_stage (local Supabase after migrations).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/smoke_complete_job.sql
--
-- Assumes public.matches / public.jobs / complete_job / pgmq jobs_bulk exist.
-- Cleanup deletes the smoke match (cascade jobs).

begin;

-- ---------------------------------------------------------------------------
-- Grants: authenticated / anon must not execute
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  sig text := 'complete_job(uuid,text,text,jsonb,boolean,text,text,int,int,text,boolean,text)';
begin
  select has_function_privilege('service_role', sig, 'execute') as ok into r;
  if not coalesce(r.ok, false) then
    raise exception 'service_role missing EXECUTE on complete_job';
  end if;
  select has_function_privilege('authenticated', sig, 'execute') as ok into r;
  if coalesce(r.ok, false) then
    raise exception 'authenticated must NOT have EXECUTE on complete_job';
  end if;
  select has_function_privilege('anon', sig, 'execute') as ok into r;
  if coalesce(r.ok, false) then
    raise exception 'anon must NOT have EXECUTE on complete_job';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into matches (id, owner_id, status, source_url)
values ('__smoke_complete_job__', null, 'processing', 'https://example.com/smoke')
on conflict (id) do update
  set status = 'processing', owner_id = null,
      duration_sec = null, width = null, height = null, fps = null;

update jobs
   set status = 'canceled', finished_at = now(), msg_id = null, queue = null
 where match_id = '__smoke_complete_job__'
   and status in ('queued', 'processing');

-- ---------------------------------------------------------------------------
-- 1) p_next_stage + p_complete_stage together → raise
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    perform complete_job(
      p_job_id := gen_random_uuid(),
      p_status := 'complete',
      p_next_stage := 'detect',
      p_complete_stage := 'detect'
    );
    raise exception 'expected mutually exclusive raise';
  exception
    when others then
      if sqlerrm not like '%mutually exclusive%' then
        raise;
      end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 2) fused jump: normalize processing → detect complete, match ready, no pgmq
-- ---------------------------------------------------------------------------
do $$
declare
  v_job_id uuid;
  v_msg_id bigint;
  v_before int;
  v_after int;
  v_out jsonb;
  v_job jobs%rowtype;
  v_match matches%rowtype;
begin
  select count(*) into v_before from pgmq.q_jobs_bulk;

  insert into jobs (match_id, status, stage, attempt, queue, queued_at, started_at)
  values ('__smoke_complete_job__', 'processing', 'normalize', 1, 'jobs_bulk', now(), now())
  returning id into v_job_id;

  select pgmq.send('jobs_bulk', jsonb_build_object('job_id', v_job_id)) into v_msg_id;
  update jobs set msg_id = v_msg_id where id = v_job_id;

  v_out := complete_job(
    p_job_id := v_job_id,
    p_status := 'complete',
    p_match := jsonb_build_object(
      'status', 'ready',
      'duration_sec', 12.5,
      'width', 1920,
      'height', 1080,
      'fps', 30
    ),
    p_complete_stage := 'detect',
    p_expected_attempt := 1,
    p_expected_stage := 'normalize'
  );

  if v_out->>'status' is distinct from 'complete'
     or v_out->>'stage' is distinct from 'detect' then
    raise exception 'fused jump returned %', v_out;
  end if;

  select * into v_job from jobs where id = v_job_id;
  if v_job.status is distinct from 'complete' or v_job.stage is distinct from 'detect' then
    raise exception 'job not complete at detect: % %', v_job.status, v_job.stage;
  end if;

  select * into v_match from matches where id = '__smoke_complete_job__';
  if v_match.status is distinct from 'ready'
     or v_match.width is distinct from 1920
     or v_match.height is distinct from 1080 then
    raise exception 'match probes missing: %', v_match;
  end if;

  select count(*) into v_after from pgmq.q_jobs_bulk;
  if v_after > v_before then
    raise exception 'fused jump sent a pgmq message (% → %)', v_before, v_after;
  end if;

  -- CAS: stale attempt
  v_out := complete_job(
    p_job_id := v_job_id,
    p_status := 'complete',
    p_complete_stage := 'detect',
    p_expected_attempt := 1,
    p_expected_stage := 'normalize'
  );
  if v_out->>'already_terminal' is distinct from 'true' then
    raise exception 'expected already_terminal, got %', v_out;
  end if;

  -- CAS attempt mismatch on a live processing row
  insert into jobs (match_id, status, stage, attempt, started_at)
  values ('__smoke_complete_job__', 'processing', 'normalize', 2, now())
  returning id into v_job_id;
  v_out := complete_job(
    p_job_id := v_job_id,
    p_status := 'complete',
    p_complete_stage := 'detect',
    p_expected_attempt := 1,
    p_expected_stage := 'normalize'
  );
  if v_out->>'rejected' is distinct from 'true'
     or v_out->>'reason' is distinct from 'attempt_mismatch' then
    raise exception 'expected attempt_mismatch, got %', v_out;
  end if;
  update jobs set status = 'canceled', finished_at = now() where id = v_job_id;
end $$;

-- ---------------------------------------------------------------------------
-- 3) invalid complete_stage
-- ---------------------------------------------------------------------------
do $$
declare
  v_job_id uuid;
begin
  insert into jobs (match_id, status, stage, attempt, queue, started_at)
  values ('__smoke_complete_job__', 'processing', 'normalize', 1, 'jobs_bulk', now())
  returning id into v_job_id;
  -- unique live-job index: previous job is complete, this insert is ok
  begin
    perform complete_job(
      p_job_id := v_job_id,
      p_status := 'complete',
      p_complete_stage := 'not-a-stage',
      p_expected_attempt := 1,
      p_expected_stage := 'normalize'
    );
    raise exception 'expected invalid complete stage';
  exception
    when others then
      if sqlerrm not like '%invalid complete stage%' then
        raise;
      end if;
  end;
  update jobs set status = 'canceled', finished_at = now() where id = v_job_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4) detect-only success completes in place (no complete_stage)
-- ---------------------------------------------------------------------------
do $$
declare
  v_job_id uuid;
  v_out jsonb;
  v_job jobs%rowtype;
begin
  insert into jobs (match_id, status, stage, attempt, started_at)
  values ('__smoke_complete_job__', 'processing', 'detect', 1, now())
  returning id into v_job_id;

  v_out := complete_job(
    p_job_id := v_job_id,
    p_status := 'complete',
    p_match := jsonb_build_object('status', 'ready', 'width', 64, 'height', 64, 'fps', 30),
    p_expected_attempt := 1,
    p_expected_stage := 'detect'
  );
  if v_out->>'stage' is distinct from 'detect' or v_out->>'status' is distinct from 'complete' then
    raise exception 'detect-only settle %', v_out;
  end if;
  select * into v_job from jobs where id = v_job_id;
  if v_job.stage is distinct from 'detect' or v_job.status is distinct from 'complete' then
    raise exception 'detect-only job % %', v_job.stage, v_job.status;
  end if;
end $$;

-- Cleanup
delete from matches where id = '__smoke_complete_job__';

commit;
