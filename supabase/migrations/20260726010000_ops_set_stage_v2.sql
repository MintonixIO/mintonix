-- Re-apply simplified ops_set_stage for envs that already applied an earlier
-- 20260726000000 revision (park/queue 5-arg, or 4-arg without flag resets).
-- Fresh installs already get this body from 20260726000000; CREATE OR REPLACE
-- is idempotent.
--
-- Changes vs first 4-arg revision:
--   * reset bookkeeping flags each unique_violation retry iteration
--   * reject live_processing before any mutate
--   * clear queue=null on canceled processing rows
--   * document enqueue=false one-live-per-match footgun (comment only)

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
  v_prio         int := 10;
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

  for v_attempt in 1..2 loop
    v_job_id      := null;
    v_msg_id      := null;
    v_queue       := null;
    v_had_live    := false;
    v_was_proc    := false;
    v_created     := false;
    v_canceled_id := null;

    select * into v_job from jobs
     where match_id = p_match_id and status in ('queued', 'processing')
     order by created_at desc
     limit 1
     for update;

    if found then
      v_had_live := true;
      v_was_proc := (v_job.status = 'processing');

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
        update jobs
           set status = 'canceled',
               error = coalesce(error, 'ops_set_stage: canceled for stage reset'),
               finished_at = now(),
               msg_id = null,
               queue = null
         where id = v_job.id;
        v_canceled_id := v_job.id;
      else
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
        continue;
      end;
    end if;

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

    exit;
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
