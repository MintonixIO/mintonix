-- Video-pipeline schema: canonical videos (BWF broadcasts + user uploads),
-- their derived B2 assets, and the job chain (normalize → detect → analyze).
-- See ARCHITECTURE.md §4–5.
--
-- Court annotations and player labels are NOT tables: they live in B2 as
-- per-video JSON files (court_annotation.json, player_labels.json) under the
-- video's prefix, written by the client through cdn-access presigned PUTs.
-- The cdn-access `users/<uid>/` prefix rule is the write authorization —
-- owners can annotate their own videos, nobody can write into `matches/…`
-- (BWF annotations are instantiated from annotation_presets by service code).
-- The DB keeps only the video_assets registry row and the cross-video preset
-- table, which can't live under any single video's prefix.
--
-- Conventions follow the init match-data migration: plain CREATE (no IF NOT
-- EXISTS) so a re-apply or drifted object fails loudly; RLS enabled on every
-- table; writes go through edge functions / loaders running as service_role
-- (which bypasses RLS), reads are gated per-row for authenticated users.
--
-- All footage is single-camera (decided 2026-07): per-video artifacts have no
-- camera dimension — one annotation file per video, one asset per kind per
-- video, one detections file per detect job.

-- ============================================================ videos
-- The canonical video entity. Every video — BWF backlog, scraper-ingested
-- YouTube, or user upload — converges to one row here plus objects under
-- b2_prefix. Downstream stages never care about the origin.
--
-- status is a denormalized UI rollup maintained by the jobs-callback function;
-- per-stage truth lives in jobs.
create table videos (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references auth.users (id),  -- null ⇒ system-owned (BWF)
  source_kind text not null check (source_kind in ('upload', 'youtube', 'backlog')),
  source_url  text,           -- YouTube URL for scraper-ingested; null otherwise
  b2_prefix   text not null unique,  -- 'users/<uid>/videos/<id>/' | 'matches/<match_key>/'
  status      text not null default 'pending'
              check (status in ('pending', 'processing', 'ready', 'failed')),
  -- probe metadata recorded by the normalize callback
  duration_sec real,
  width        int,
  height       int,
  fps          real,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- uploads are user-owned; scraped/backlog footage is system-owned
  check ((source_kind = 'upload') = (owner_id is not null))
);

create index videos_owner_id_idx on videos (owner_id);

-- matches.video_id already holds the matched *YouTube* id (text, set by the
-- match-data pipeline), so the link to the pipeline's canonical video gets a
-- distinct name. Nullable until the footage is actually ingested.
alter table matches
  add column footage_id uuid references videos (id);

create index matches_footage_id_idx on matches (footage_id);

-- ============================================================ video_assets
-- Registry of every derived object in B2, so "what exists for this video" is
-- a DB query, not a bucket listing. One row per kind per video: regenerating
-- an asset overwrites the row and versions the B2 key (…/v2/…) so stale CDN
-- cache entries are never served.
--
-- sha256 comes from the worker callback (integrity/content-address metadata,
-- not authorization). meta holds kind-specific facts (thumbnail dimensions,
-- detection model versions, manifest row count, …).
--
-- Worker-produced kinds are registered by the jobs-callback function.
-- Client-authored kinds (original, court_annotation, player_labels) are
-- PUT directly to B2 via a cdn-access presigned URL, then registered by the
-- upload-confirm call (sha256/bytes optional there).
create table video_assets (
  video_id   uuid not null references videos (id) on delete cascade,
  kind       text not null check (kind in
               ('original', 'normalized', 'thumbnail', 'valid',
                'frame_manifest', 'scores', 'detections', 'analysis',
                'court_annotation', 'player_labels')),
  b2_key     text not null,
  sha256     text,
  bytes      bigint,
  meta       jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (video_id, kind)
);

-- ============================================================ jobs
-- State of every pipeline stage run. Queueing itself is pgmq (see bottom);
-- a queue message carries just the job id, this row is the payload and the
-- record. jobs-callback flips status and enqueues the next stage.
create table jobs (
  id          uuid primary key default gen_random_uuid(),
  video_id    uuid not null references videos (id) on delete cascade,
  stage       text not null check (stage in ('normalize', 'detect', 'analyze')),
  status      text not null default 'pending' check (status in
                ('pending', 'queued', 'processing', 'complete', 'failed', 'canceled')),
  priority    int not null default 100,  -- lower runs sooner: interactive=10, bulk=100
  attempt     int not null default 0,
  params      jsonb not null default '{}',  -- stage-specific, e.g. valid_frames_config
  -- where the in-flight pgmq message lives, so complete_job can settle it
  -- (archive on terminal, re-send on retry) without a bucket-wide scan
  queue       text check (queue in ('jobs_interactive', 'jobs_bulk')),
  msg_id      bigint,
  error       text,
  queued_at   timestamptz,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- At most one live run per stage per video; retries reuse the row (attempt++).
create unique index jobs_one_active_per_stage_idx on jobs (video_id, stage)
  where status in ('pending', 'queued', 'processing');
create index jobs_dispatch_idx on jobs (status, priority, created_at);
create index jobs_video_id_idx on jobs (video_id);

-- ============================================================ annotation_presets
-- BWF broadcast geometry repeats across a tournament's videos, so one manual
-- annotation covers the whole event. This stays a table (not a B2 file)
-- because it's cross-video system data the dispatcher joins by tournament;
-- ingesting a BWF video materializes the matching preset into that video's
-- court_annotation.json. tournament matches matches.tournament (already
-- season-qualified, e.g. "2026 All England Open"). If a broadcaster changes
-- layout mid-event, add a second preset row and pick per video.
create table annotation_presets (
  id              bigint generated always as identity primary key,
  tournament      text not null,
  label           text,               -- disambiguator when one event needs >1 preset
  corners         jsonb not null,     -- [[x,y] × 4], TL → TR → BR → BL
  scoreboard_crop jsonb not null,     -- {x, y, w, h}
  score_sub_crop  jsonb not null,     -- {x, y, w, h} within scoreboard_crop
  row_split_y     int not null,
  notes           text,
  created_at      timestamptz not null default now(),
  unique (tournament, label)
);

-- court_annotation.json and player_labels.json live in B2, not here — see the
-- header comment. Their shapes are documented in ARCHITECTURE.md §3. Notably
-- player_labels.json stores only the click *evidence* (frame_idx + anchor
-- from the labeling click); resolution to pose track ids happens in the
-- analyze stage and lands in analysis.json, so re-running detect never
-- orphans a label.

-- ============================================================ updated_at
create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger videos_updated_at before update on videos for each row execute function set_updated_at();
create trigger jobs_updated_at   before update on jobs   for each row execute function set_updated_at();

-- ============================================================ grants + RLS
-- The earlier match-data grants ran "on all tables" before these existed, so
-- each grant is explicit here. anon gets nothing: all reads require a session.
-- Clients never write these tables at all — user-authored data (annotations,
-- labels) goes to B2 via cdn-access presigned PUTs; every DB write happens in
-- edge functions / loaders as service_role.

grant select, insert, update, delete
  on videos, video_assets, jobs, annotation_presets
  to service_role;
grant usage, select on all sequences in schema public to service_role;

grant select on videos, video_assets, jobs, annotation_presets to authenticated;

alter table videos             enable row level security;
alter table video_assets       enable row level security;
alter table jobs               enable row level security;
alter table annotation_presets enable row level security;

-- Read: your own videos, plus system-owned (BWF) footage. Note this makes BWF
-- *pipeline artifacts* readable to any signed-in user even though the raw
-- match-data tables are private; tighten to `owner_id = auth.uid()` if BWF
-- content should stay service-only until launch.
create policy "read own or system" on videos for select to authenticated
  using (owner_id = auth.uid() or owner_id is null);

create policy "read via video" on video_assets for select to authenticated
  using (exists (select 1 from videos v
                 where v.id = video_id
                   and (v.owner_id = auth.uid() or v.owner_id is null)));

create policy "read via video" on jobs for select to authenticated
  using (exists (select 1 from videos v
                 where v.id = video_id
                   and (v.owner_id = auth.uid() or v.owner_id is null)));

create policy "read presets" on annotation_presets for select to authenticated
  using (true);

-- ============================================================ queues (pgmq)
-- Supabase Queues must be enabled on the project first (Dashboard →
-- Integrations → Queues); this fails loudly if it isn't — intentional.
-- Producers pgmq.send() a {job_id} message; the dispatcher edge function pops
-- interactive before bulk, marks the job 'queued', presigns URLs, and POSTs
-- the envelope to the stage's vast endpoint.
select pgmq.create('jobs_interactive');  -- user-initiated: uploads, re-runs
select pgmq.create('jobs_bulk');         -- backlog + scraper ingestion

-- ============================================================ pipeline RPCs
-- The write paths of the three edge-function entry points (videos-ingest and
-- the jobs function's /dispatch + /callback routes). Each is ONE transaction:
-- a videos row can never exist without its queue message, a completed job can
-- never miss its next-stage message. Policy (stage routing, retry limits,
-- envelope shapes) stays in the edge functions; these only make the agreed
-- writes atomic.
--
-- security definer (owner: postgres) because pgmq lives outside the exposed
-- schemas; execute is revoked from everyone but service_role, so only edge
-- functions / loaders can call them.

-- videos-ingest: insert video + normalize job + queue message, atomically.
create function ingest_video(
  p_source_kind text,
  p_source_url  text  default null,
  p_owner_id    uuid  default null,
  p_b2_prefix   text  default null,       -- required unless source_kind='upload'
  p_params      jsonb default '{}'::jsonb, -- normalize params (valid_frames_config…)
  p_queue       text  default 'jobs_bulk',
  p_priority    int   default 100
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_video_id uuid := gen_random_uuid();
  v_prefix   text;
  v_job_id   uuid;
  v_msg_id   bigint;
begin
  if p_queue not in ('jobs_interactive', 'jobs_bulk') then
    raise exception 'unknown queue: %', p_queue;
  end if;

  v_prefix := coalesce(
    p_b2_prefix,
    case when p_source_kind = 'upload'
         then format('users/%s/videos/%s/', p_owner_id, v_video_id) end);
  if v_prefix is null then
    raise exception 'b2_prefix is required for source_kind %', p_source_kind;
  end if;

  insert into videos (id, owner_id, source_kind, source_url, b2_prefix)
  values (v_video_id, p_owner_id, p_source_kind, p_source_url, v_prefix);

  insert into jobs (video_id, stage, status, priority, params, queued_at, queue)
  values (v_video_id, 'normalize', 'queued', p_priority, p_params, now(), p_queue)
  returning id into v_job_id;

  select pgmq.send(p_queue, jsonb_build_object('job_id', v_job_id)) into v_msg_id;
  update jobs set msg_id = v_msg_id where id = v_job_id;

  return jsonb_build_object('video_id', v_video_id, 'job_id', v_job_id);
end $$;

-- jobs /dispatch: pop the next runnable job (interactive before bulk), flip it
-- to processing, and hand the edge function everything it needs to build the
-- worker envelope. Returns null when there is nothing to do (queues empty or
-- p_max_running already in flight).
--
-- pgmq.read hides the message for p_vt seconds instead of deleting it: if the
-- worker dies without ever calling back, the message reappears and the job is
-- re-dispatched — that IS the retry system, so p_vt must exceed the worst-case
-- job walltime. Messages whose job is already terminal (e.g. a canceled job)
-- are archived and skipped.
create function dispatch_next_job(
  p_vt          int default 10800,  -- 3h: covers download + 4K transcode + OCR
  p_max_running int default 2       -- soft GPU-spend cap
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue text;
  v_msg   record;
  v_job   jobs%rowtype;
  v_tries int;
begin
  if (select count(*) from jobs where status = 'processing') >= p_max_running then
    return null;
  end if;

  foreach v_queue in array array['jobs_interactive', 'jobs_bulk'] loop
    v_tries := 0;
    loop
      v_tries := v_tries + 1;
      exit when v_tries > 5;  -- bound stale-message skipping per call

      select * into v_msg from pgmq.read(v_queue, p_vt, 1);
      exit when not found;

      select * into v_job from jobs
        where id = (v_msg.message ->> 'job_id')::uuid
        for update;
      if not found or v_job.status in ('complete', 'failed', 'canceled') then
        perform pgmq.archive(v_queue, v_msg.msg_id);
        continue;
      end if;

      update jobs
         set status = 'processing', attempt = attempt + 1, started_at = now(),
             queue = v_queue, msg_id = v_msg.msg_id, error = null
       where id = v_job.id;
      update videos set status = 'processing'
       where id = v_job.video_id and status = 'pending';

      return (
        select jsonb_build_object(
          'job_id', j.id, 'stage', j.stage, 'attempt', j.attempt,
          'params', j.params, 'priority', j.priority, 'queue', j.queue,
          'video_id', v.id, 'source_kind', v.source_kind,
          'source_url', v.source_url, 'b2_prefix', v.b2_prefix,
          'assets', coalesce(
            (select jsonb_object_agg(a.kind, a.b2_key)
               from video_assets a where a.video_id = v.id), '{}'::jsonb))
          from jobs j join videos v on v.id = j.video_id
         where j.id = v_job.id);
    end loop;
  end loop;

  return null;
end $$;

-- jobs /callback: settle a stage. Marks the job terminal (or re-queues it on
-- a retryable failure), registers the produced assets, rolls up the videos
-- row, and — the pipeline-advancing move — enqueues the next stage the edge
-- function's routing table chose. First-terminal-wins: a job that is already
-- terminal returns {already_terminal: true} and changes nothing, which is
-- what makes the worker's callback token effectively single-use.
create function complete_job(
  p_job_id        uuid,
  p_status        text,                       -- 'complete' | 'failed'
  p_error         text    default null,
  p_assets        jsonb   default '[]'::jsonb, -- [{kind,b2_key,sha256,bytes,meta}]
  p_video         jsonb   default '{}'::jsonb, -- {status?,duration_sec?,width?,height?,fps?}
  p_retry         boolean default false,       -- failed only: re-queue this job
  p_next_stage    text    default null,        -- complete only: stage to enqueue
  p_next_params   jsonb   default '{}'::jsonb,
  p_next_queue    text    default null,        -- defaults to this job's queue
  p_next_priority int     default null         -- defaults to this job's priority
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job     jobs%rowtype;
  v_asset   jsonb;
  v_queue   text;
  v_msg_id  bigint;
  v_next_id uuid;
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

  -- The in-flight message is settled either way; a retry gets a fresh send so
  -- it is visible immediately instead of after the visibility timeout.
  if v_job.queue is not null and v_job.msg_id is not null then
    perform pgmq.archive(v_job.queue, v_job.msg_id);
  end if;

  -- Whatever the worker delivered before failing (e.g. the original archive)
  -- is real and already in B2 — register it even on failure so the retry
  -- dispatch sources from B2 instead of YouTube.
  for v_asset in select * from jsonb_array_elements(p_assets) loop
    insert into video_assets (video_id, kind, b2_key, sha256, bytes, meta)
    values (v_job.video_id, v_asset ->> 'kind', v_asset ->> 'b2_key',
            v_asset ->> 'sha256', (v_asset ->> 'bytes')::bigint,
            coalesce(v_asset -> 'meta', '{}'::jsonb))
    on conflict (video_id, kind) do update
      set b2_key = excluded.b2_key, sha256 = excluded.sha256,
          bytes = excluded.bytes, meta = excluded.meta, created_at = now();
  end loop;

  if p_status = 'failed' and p_retry then
    v_queue := coalesce(v_job.queue, 'jobs_bulk');
    select pgmq.send(v_queue, jsonb_build_object('job_id', p_job_id)) into v_msg_id;
    update jobs
       set status = 'queued', error = p_error, queued_at = now(),
           queue = v_queue, msg_id = v_msg_id
     where id = p_job_id;
    return jsonb_build_object('job_id', p_job_id, 'status', 'queued',
                              'attempt', v_job.attempt);
  end if;

  update jobs set status = p_status, error = p_error, finished_at = now()
   where id = p_job_id;

  update videos
     set status       = coalesce(p_video ->> 'status',
                          case when p_status = 'failed' then 'failed' end,
                          status),
         duration_sec = coalesce((p_video ->> 'duration_sec')::real, duration_sec),
         width        = coalesce((p_video ->> 'width')::int, width),
         height       = coalesce((p_video ->> 'height')::int, height),
         fps          = coalesce((p_video ->> 'fps')::real, fps)
   where id = v_job.video_id;

  if p_status = 'complete' and p_next_stage is not null then
    v_queue := coalesce(p_next_queue, v_job.queue, 'jobs_bulk');
    insert into jobs (video_id, stage, status, priority, params, queued_at, queue)
    values (v_job.video_id, p_next_stage, 'queued',
            coalesce(p_next_priority, v_job.priority), p_next_params, now(), v_queue)
    returning id into v_next_id;
    select pgmq.send(v_queue, jsonb_build_object('job_id', v_next_id)) into v_msg_id;
    update jobs set msg_id = v_msg_id where id = v_next_id;
  end if;

  return jsonb_build_object('job_id', p_job_id, 'status', p_status,
                            'next_job_id', v_next_id);
end $$;

-- Functions get EXECUTE granted to PUBLIC by default — take it back so only
-- service_role (edge functions / loaders) can drive the pipeline.
revoke execute on function ingest_video, dispatch_next_job, complete_job
  from public, anon, authenticated;
grant execute on function ingest_video, dispatch_next_job, complete_job
  to service_role;

-- The dispatcher is cron-driven. Enable pg_cron + pg_net on the project, put
-- the function URL + PIPELINE_SERVICE_TOKEN in Vault, then schedule something
-- like the below (left commented: the URL and token are per-project state,
-- not migration content). Until then, POST /functions/v1/jobs/dispatch by
-- hand or from CI to pump the queue.
--
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

-- ============================================================ seed: presets
-- BWF broadcast geometry for the first cloud-test tournament. Coordinates are
-- in the 1920x1080 *normalized* output (detection runs post-normalize),
-- verified end-to-end against the WS final CHEN vs LIN (nUKzwRPI68A) in the
-- local pipeline simulation (2026-07-09): 102 rally ranges, 42,348/143,881
-- frames kept, 100% sampled-OCR agreement inside kept ranges.
insert into annotation_presets
  (tournament, label, corners, scoreboard_crop, score_sub_crop, row_split_y, notes)
values
  ('2019 Malaysia Open', null,
   '[[560,445],[1360,445],[1620,995],[300,995]]',
   '{"x":280,"y":40,"w":560,"h":110}',
   '{"x":0,"y":0,"w":560,"h":110}',
   56,
   'Astro Arena broadcast layout. player_names are per-match (from match_players), not part of the preset.');
