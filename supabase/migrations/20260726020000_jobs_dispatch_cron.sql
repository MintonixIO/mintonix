-- Automatic queue drain: pg_cron → pg_net → POST /jobs/dispatch every minute.
--
-- Enqueue stays intentional only (matches-ingest, ops set-stage enqueue=true,
-- complete_job stage advance / retry). This migration never invents jobs — it
-- only claims work already on pgmq.
--
-- Secrets are per-project Vault state (not committed):
--   jobs_dispatch_url       full URL …/functions/v1/jobs/dispatch
--   pipeline_service_token  same value as edge PIPELINE_SERVICE_TOKEN
-- Until both exist, the cron no-ops with a WARNING (safe after db push).
-- Setup: SUPABASE.md § Cron (dispatch drain).

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------------
-- invoke_jobs_dispatch — fire-and-forget HTTP to the edge dispatcher
-- ---------------------------------------------------------------------------
create or replace function public.invoke_jobs_dispatch()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url   text;
  v_token text;
  v_id    bigint;
begin
  select ds.decrypted_secret into v_url
    from vault.decrypted_secrets ds
   where ds.name = 'jobs_dispatch_url'
   limit 1;

  select ds.decrypted_secret into v_token
    from vault.decrypted_secrets ds
   where ds.name = 'pipeline_service_token'
   limit 1;

  if v_url is null or btrim(v_url) = ''
     or v_token is null or btrim(v_token) = '' then
    raise warning
      'jobs-dispatch cron skipped: set vault secrets jobs_dispatch_url and pipeline_service_token (see SUPABASE.md § Cron)';
    return null;
  end if;

  -- max=2 drains a little faster than one-per-minute without flooding GPU.
  -- max_running matches jobs edge default (spend ceiling while processing).
  select net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-pipeline-token', v_token
    ),
    body    := jsonb_build_object(
      'max', 2,
      'max_running', 2
    )
  ) into v_id;

  return v_id;
end;
$$;

comment on function public.invoke_jobs_dispatch() is
  'pg_cron target: POST /jobs/dispatch via pg_net using Vault secrets. Drain only — never enqueues.';

revoke all on function public.invoke_jobs_dispatch() from public;
revoke all on function public.invoke_jobs_dispatch() from anon, authenticated;
-- cron runs as the database owner / postgres; service_role does not need this.

-- ---------------------------------------------------------------------------
-- Schedule (idempotent): every minute
-- ---------------------------------------------------------------------------
do $$
begin
  -- jobname form (pg_cron ≥ 1.4); ignore if not yet registered
  perform cron.unschedule('jobs-dispatch');
exception
  when others then
    null;
end $$;

select cron.schedule(
  'jobs-dispatch',
  '* * * * *',
  $$select public.invoke_jobs_dispatch()$$
);
