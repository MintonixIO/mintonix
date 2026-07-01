# rfdetr-infer — deploy & test

## Deployment (`.github/workflows/supabase-deploy.yml`)

One job, target chosen by trigger:

| Trigger | GitHub Environment | Supabase project |
| --- | --- | --- |
| `pull_request` (touching `supabase/**`) | `dev` | DEV `xaxyuytvgcdbdnndhgwj` |
| `push` to `master` | `prod` | PROD `grkaepnplgotsxdudlfn` |

Each run: `link` → `db push` (migrations) → `secrets set` (Roboflow config) →
`functions deploy --use-api` → smoke test.

### Required GitHub config

Create two **Environments** (Settings → Environments): `dev` and `prod`. Add
required reviewers on `prod` for a manual approval gate. Per environment set:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `SUPABASE_PROJECT_ID` | the project ref (`xaxyuytvgcdbdnndhgwj` / `grkaepnplgotsxdudlfn`) |
| Variable | `SUPABASE_ANON_KEY` | that project's legacy anon JWT (publishable, not secret) |
| Variable | `RF_DETR_MODEL_ID` | optional; defaults to `rfdetr-seg-preview` |
| Variable | `RF_DETR_FILTER_CLASSES` | optional, e.g. `person` |
| Secret | `SUPABASE_DB_PASSWORD` | that project's Postgres password |
| Secret | `ROBOFLOW_API_KEY` | Roboflow key |

Repo-level secret (shared, same org): `SUPABASE_ACCESS_TOKEN` (a Supabase PAT).

> Both projects already have all 4 migrations recorded and tables populated, so
> `db push` is a no-op until a new migration lands.

## Test architecture

The endpoint's output is the **model's prediction, not human ground truth**, so
"a known image with a known coordinate" can't be an exact-match assertion — the
right design is two tiers (`smoke-test.ts`, config in `expected.json`):

1. **Contract (hard gate)** — `200` + `success` + `≥ min_persons` + the
   dominant person carries `segmentation` points. This is what actually
   matters: it catches a broken `ROBOFLOW_API_KEY`, the **wrong alias** (a
   detection model returns no mask points → fails), or a function that never
   deployed.
2. **Regression (wide tolerance)** — the dominant person's bbox center sits
   within ±5% of the image dims of the recorded golden. Wide enough not to flake
   on a minor Roboflow model update; tight enough to catch the alias silently
   resolving to a different model.

Why this is stable: a Roboflow `project/version` is a fixed checkpoint and
inference is deterministic for a given input, so the golden doesn't drift on its
own. We assert on the single highest-confidence detection (the near on-court
player), which is robust to confidence-threshold changes.

- **Fixture:** `fixture.jpg` (the badminton frame, downscaled to 1280px).
- **Golden:** `expected.json`. Regenerate after an intentional model change with
  `ROBOFLOW_API_KEY=... ./regen-golden.sh`.
- **PROD gating:** the smoke test is a hard gate on DEV/PRs but non-blocking on
  PROD (`continue-on-error` on `push`), so a Roboflow outage can't turn an
  otherwise-successful production deploy red. The deploy has already happened by
  then; the test only colors the run.

### Run locally against any deployment

```bash
FUNCTION_URL=https://<ref>.supabase.co/functions/v1/rfdetr-infer \
SUPABASE_ANON_KEY=<anon key> \
deno run --allow-net --allow-read --allow-env smoke-test.ts
```

Each run calls the live Roboflow API and consumes inference credits. The test
also prints an estimated credit cost per image, derived from Roboflow's own
reported `inference_time` (billing formula: `credits = max(time_ms, 100) /
500_000`, ~$4–6/credit). Wall-clock round-trip is shown for context but is not
what Roboflow bills. Requires the function to be redeployed with the
`inference_time` passthrough; older deployments print "inference_time not
present".

## Possible next layer (not implemented)

A true accuracy test needs human-labeled ground truth: annotate the players'
boxes/masks once, then assert IoU ≥ threshold against the model output. That
measures the model; the tiers above measure the pipeline.
