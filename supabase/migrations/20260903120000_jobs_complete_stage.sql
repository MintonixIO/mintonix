-- Fused preprocess+detect settle: complete_job(..., p_complete_stage)
-- jumps jobs.stage without pgmq requeue. Happy path: normalize callback
-- completes at detect and marks the match ready. p_next_stage requeue is
-- unchanged (unused by fused normalize). Detect-only retry still completes
-- in place (p_complete_stage null).
--
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
  p_warming           boolean default false,
  p_complete_stage    text    default null
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

  if p_next_stage is not null and p_complete_stage is not null then
    raise exception 'p_next_stage and p_complete_stage are mutually exclusive';
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

  -- Fused settle: jump stage and mark complete with no new queue message.
  if p_status = 'complete' and p_complete_stage is not null then
    if p_complete_stage not in ('normalize', 'detect', 'analyze') then
      raise exception 'invalid complete stage: %', p_complete_stage;
    end if;
    update jobs
       set stage = p_complete_stage,
           status = 'complete',
           error = p_error,
           finished_at = now()
     where id = p_job_id
       and attempt = v_job.attempt
       and status = 'processing';

    update matches
       set status       = coalesce(p_match ->> 'status', 'ready'),
           duration_sec = coalesce((p_match ->> 'duration_sec')::real, duration_sec),
           width        = coalesce((p_match ->> 'width')::int, width),
           height       = coalesce((p_match ->> 'height')::int, height),
           fps          = coalesce((p_match ->> 'fps')::real, fps)
     where id = v_job.match_id;

    return jsonb_build_object(
      'job_id', p_job_id, 'status', 'complete', 'stage', p_complete_stage);
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
  uuid, text, text, jsonb, boolean, text, text, int, int, text, boolean, text
) from public, anon, authenticated;
grant execute on function complete_job(
  uuid, text, text, jsonb, boolean, text, text, int, int, text, boolean, text
) to service_role;
