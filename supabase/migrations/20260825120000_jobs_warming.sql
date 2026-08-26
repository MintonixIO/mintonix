-- Warming requeue: complete_job(..., p_warming) restores attempt so
-- MAX_ATTEMPTS counts real GPU starts, not /route/ cold-start waits.
-- dispatch_next_job still attempt++ on claim; it now returns the pre-claim
-- jobs.error so warming:<iso> survives the 20 min clock across ticks.

-- Adding a parameter requires DROP (CREATE OR REPLACE cannot change signature).
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'complete_job'
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

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
  p_expected_stage    text    default null,
  p_warming           boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job    jobs%rowtype;
  v_queue  text;
  v_msg_id bigint;
  v_attempt int;
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
    -- Warming: restore the attempt that dispatch_next_job just incremented
    -- so the next claim returns the same attempt number.
    v_attempt := case
      when p_warming then greatest(v_job.attempt - 1, 0)
      else v_job.attempt
    end;
    update jobs
       set status = 'queued', error = p_error, queued_at = now(),
           queue = v_queue, msg_id = v_msg_id, finished_at = null,
           started_at = null,
           attempt = v_attempt
     where id = p_job_id
       and attempt = v_job.attempt
       and status = 'processing';
    return jsonb_build_object('job_id', p_job_id, 'status', 'queued',
                              'attempt', v_attempt, 'stage', v_job.stage);
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

revoke execute on function complete_job(
  uuid, text, text, jsonb, boolean, text, text, int, int, text, boolean
) from public, anon, authenticated;
grant execute on function complete_job(
  uuid, text, text, jsonb, boolean, text, text, int, int, text, boolean
) to service_role;

-- Return pre-claim error (warming:<iso>) so invokeVast can keep the 20 min clock.
-- Claim still clears jobs.error; the ISO travels on the RPC payload.
create or replace function dispatch_next_job(
  p_vt          int default 10800,
  p_max_running int default 2
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue       text;
  v_msg         record;
  v_job         jobs%rowtype;
  v_tries       int;
  v_running     int;
  v_prior_error text;
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
        v_prior_error := v_job.error;
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
            'team2_player1', m.team2_player1, 'team2_player2', m.team2_player2,
            'error', v_prior_error
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

        v_prior_error := v_job.error;
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
            'team2_player1', m.team2_player1, 'team2_player2', m.team2_player2,
            'error', v_prior_error
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
