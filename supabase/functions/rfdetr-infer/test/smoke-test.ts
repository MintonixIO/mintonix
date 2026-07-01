// Smoke + regression test for the deployed rfdetr-infer edge function.
//
// Two assertion tiers (see expected.json):
//   1. CONTRACT (hard) — 200, success, >=min_persons, and the dominant person
//      carries segmentation points. This is what actually matters: it catches a
//      broken ROBOFLOW_API_KEY, the wrong alias (a detection model returns no
//      points -> fails), or a function that isn't deployed.
//   2. REGRESSION (wide tolerance) — the dominant person's bbox center sits near
//      the recorded golden. Wide enough not to flake on a minor Roboflow update,
//      tight enough to catch the alias resolving to a different model.
//
// Run:
//   FUNCTION_URL=https://<ref>.supabase.co/functions/v1/rfdetr-infer \
//   SUPABASE_ANON_KEY=<anon key> \
//   deno run --allow-net --allow-read --allow-env smoke-test.ts
//
// Note: each run calls the live Roboflow API and consumes inference credits.

import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts"

const here = new URL(".", import.meta.url).pathname
const expected = JSON.parse(await Deno.readTextFile(`${here}expected.json`))
const fixture = await Deno.readFile(`${here}fixture.jpg`)

const functionUrl = Deno.env.get("FUNCTION_URL")
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
if (!functionUrl || !anonKey) {
  console.error("FUNCTION_URL and SUPABASE_ANON_KEY must be set")
  Deno.exit(2)
}

const failures: string[] = []
const check = (cond: boolean, msg: string) => {
  console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`)
  if (!cond) failures.push(msg)
}

const t0 = performance.now()
const res = await fetch(functionUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${anonKey}`,
  },
  body: JSON.stringify({ image: encodeBase64(fixture), filterClasses: "person" }),
})
const wallMs = performance.now() - t0

check(res.ok, `HTTP 200 (got ${res.status})`)
const json = await res.json().catch(() => ({}))
if (!res.ok) {
  console.error("response:", JSON.stringify(json).slice(0, 400))
  Deno.exit(1)
}

// ---- contract ----
check(json.success === true, "response.success === true")
const people = (json.filtered ?? []) as Array<
  { confidence: number; bbox: { x: number; y: number }; segmentation?: unknown[] }
>
check(
  people.length >= expected.min_persons,
  `>= ${expected.min_persons} persons (got ${people.length})`,
)

if (people.length > 0) {
  const top = people.reduce((a, b) => (b.confidence > a.confidence ? b : a))
  const g = expected.dominant_person
  check(
    (top.segmentation?.length ?? 0) >= g.min_segmentation_points,
    `dominant person has >= ${g.min_segmentation_points} mask points (got ${top.segmentation?.length ?? 0})`,
  )
  check(
    top.confidence >= g.min_confidence,
    `dominant person confidence >= ${g.min_confidence} (got ${top.confidence.toFixed(3)})`,
  )
  // ---- regression ----
  const dx = Math.abs(top.bbox.x - g.center.x)
  const dy = Math.abs(top.bbox.y - g.center.y)
  check(
    dx <= g.tolerance_px.x && dy <= g.tolerance_px.y,
    `dominant person near golden center (dx=${dx.toFixed(0)}<=${g.tolerance_px.x}, dy=${dy.toFixed(0)}<=${g.tolerance_px.y})`,
  )
}

// ---- cost estimate ----
// Roboflow bills serverless credits on server-side inference time:
//   credits = max(inference_ms, 100) / 500_000     (1 credit = 500s of GPU time)
// A credit runs ~$4 (prepaid) to ~$6 (flex). We report from Roboflow's own
// reported time when present; wall-clock (incl. Supabase + network) is shown as
// context but is NOT what you're billed on.
const CREDIT_USD = 4
const inferenceMs = typeof json.inference_time === "number" ? json.inference_time * 1000 : null
if (inferenceMs !== null) {
  const credits = Math.max(inferenceMs, 100) / 500_000
  console.log(
    `\ncost: inference ${inferenceMs.toFixed(0)}ms -> ${credits.toFixed(6)} credits/image ` +
      `(~$${(credits * CREDIT_USD).toFixed(5)}/image, ~$${(credits * CREDIT_USD * 1000).toFixed(2)}/1k @ $${CREDIT_USD}/credit)`,
  )
} else {
  console.log("\ncost: Roboflow inference_time not present in response")
}
console.log(`      wall-clock round-trip ${wallMs.toFixed(0)}ms (not billed)`)

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`)
  Deno.exit(1)
}
console.log("\nall checks passed")
