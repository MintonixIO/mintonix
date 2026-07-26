-- Ops manual stage control: set a match's next stage, optionally enqueue.
-- Additive only — does not rewrite the squashed init migration.
--
-- Dual truth: jobs.stage/status = what runs next; B2 objects = stage evidence.
-- B2 purge of stage outputs is client-side (ops edge / manage.py); this RPC
-- only rewrites jobs + matches + pgmq.
--
-- p_enqueue:
--   true  — status=queued, pgmq.send(jobs_interactive), store msg_id
--   false — status=queued, msg_id=null, queue=null (dispatch never sees it).
--           Still holds jobs one-live-per-match — blocks ingest until
--           enqueue=true via set-stage or the job becomes terminal.
--
-- Live jobs:
--   queued     → archive pgmq (must succeed or fail), reuse the same row
--   processing → cancel_live must be true; archive pgmq, mark row canceled,
--                INSERT a new job_id (stale worker tokens cannot CAS-settle)
--
-- One apply path: after cancel/reuse/insert, stage + enqueue fields are set
-- in a single block (unique_violation retries the whole live-job resolve).
-- Bookkeeping flags reset each loop attempt; reject before any mutate.

drop function if exists ops_set_stage(text, text, text, boolean, boolean);

create or replace function ops_set_stage(
  p_match_id    text,
  p_stage       text,
  p_enqueue     boolean default true,
  p_cancel_live boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match        matches%rowtype;
  v_job          jobs%rowtype;
  v_job_id       uuid;
  v_msg_id       bigint;
  v_queue        text;
  v_had_live     boolean;
  v_was_proc     boolean;
  v_created      boolean;
  v_canceled_id  uuid;
  v_prefix       text;
  v_prio         int := 10;  -- ops is interactive priority
  v_archived     boolean;
  v_attempt      int;
begin
  if p_match_id is null or length(trim(p_match_id)) = 0 then
    raise exception 'match id is required';
  end if;

  if p_stage is null or p_stage not in ('normalize', 'detect', 'analyze') then
    raise exception 'invalid stage: % (want normalize|detect|analyze)', p_stage;
  end if;

  if p_enqueue is null then
    raise exception 'p_enqueue is required';
  end if;

  select * into v_match from matches where id = p_match_id for update;
  if not found then
    raise exception 'match % not found', p_match_id;
  end if;

  v_prefix := match_b2_prefix(v_match.owner_id, v_match.id);

  -- Up to 2 attempts: second path recovers unique_violation races on INSERT.
  for v_attempt in 1..2 loop
    -- Reset bookkeeping every attempt so sticky flags cannot leak across retries.
    v_job_id      := null;
    v_msg_id      := null;
    v_queue       := null;
    v_had_live    := false;
    v_was_proc    := false;
    v_created     := false;
    v_canceled_id := null;

    -- Lock any live job for this match (one-live unique index).
    select * into v_job from jobs
     where match_id = p_match_id and status in ('queued', 'processing')
     order by created_at desc
     limit 1
     for update;

    if found then
      v_had_live := true;
      v_was_proc := (v_job.status = 'processing');

      -- Reject before any archive/cancel/update.
      if v_was_proc and not p_cancel_live then
        return jsonb_build_object(
          'ok', false,
          'rejected', true,
          'reason', 'live_processing',
          'match_id', p_match_id,
          'job_id', v_job.id,
          'stage', v_job.stage,
          'status', v_job.status
        );
      end if;

      -- Archive in-flight message. Exception = hard fail (avoid leftover pgmq
      -- or double-send). archive()=false means already absent — OK.
      if v_job.queue is not null and v_job.msg_id is not null then
        begin
          select pgmq.archive(v_job.queue, v_job.msg_id) into v_archived;
        exception when others then
          raise exception
            'ops_set_stage: pgmq.archive failed (queue=%, msg_id=%): %',
            v_job.queue, v_job.msg_id, sqlerrm;
        end;
      end if;

      if v_was_proc then
        -- New job_id so stale worker tokens (bound to old job_id/attempt) cannot
        -- settle complete_job. Old row becomes terminal canceled.
        update jobs
           set status = 'canceled',
               error = coalesce(error, 'ops_set_stage: canceled for stage reset'),
               finished_at = now(),
               msg_id = null,
               queue = null
         where id = v_job.id;
        v_canceled_id := v_job.id;
        -- fall through to INSERT
      else
        -- Live queued: reuse the same row (no in-flight worker token).
        v_job_id := v_job.id;
      end if;
    end if;

    if v_job_id is null then
      begin
        insert into jobs (match_id, stage, status, priority, queued_at, queue, msg_id)
        values (p_match_id, p_stage, 'queued', v_prio, now(), null, null)
        returning id into v_job_id;
        v_created := true;
      exception when unique_violation then
        if v_attempt = 2 then
          raise exception 'ops_set_stage race: live job for %', p_match_id;
        end if;
        continue;  -- re-lock concurrent live row and apply same contract
      end;
    end if;

    -- Single apply path: stage fields + optional enqueue (reuse or fresh insert).
    if p_enqueue then
      v_queue := 'jobs_interactive';
      select pgmq.send(v_queue, jsonb_build_object('job_id', v_job_id)) into v_msg_id;
      update jobs
         set stage       = p_stage,
             status      = 'queued',
             attempt     = 0,
             priority    = v_prio,
             error       = null,
             queue        = v_queue,
             msg_id      = v_msg_id,
             queued_at   = now(),
             started_at  = null,
             finished_at = null
       where id = v_job_id;
    else
      update jobs
         set stage       = p_stage,
             status      = 'queued',
             attempt     = 0,
             priority    = v_prio,
             error       = null,
             queue        = null,
             msg_id      = null,
             queued_at   = now(),
             started_at  = null,
             finished_at = null
       where id = v_job_id;
      v_msg_id := null;
      v_queue  := null;
    end if;

    exit;  -- success
  end loop;

  update matches set status = 'pending' where id = p_match_id;

  return jsonb_build_object(
    'ok', true,
    'match_id', p_match_id,
    'job_id', v_job_id,
    'stage', p_stage,
    'enqueue', p_enqueue,
    'queue', v_queue,
    'msg_id', v_msg_id,
    'b2_prefix', v_prefix,
    'had_live', v_had_live,
    'canceled_processing', (v_canceled_id is not null),
    'canceled_job_id', v_canceled_id,
    'created_job', v_created
  );
end $$;

revoke execute on function ops_set_stage(text, text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function ops_set_stage(text, text, boolean, boolean)
  to service_role;
