# Workers

Runtime modules outside Supabase: storage edge, catalog scrape, and GPU stages.
Cross-cutting trust model and job contract live in root
[`ARCHITECTURE.md`](../ARCHITECTURE.md). Schema / RPCs:
[`supabase/README.md`](../supabase/README.md).

| Worker | Path | Role | Status |
|--------|------|------|--------|
| **CDN** | [cloudflare/cdn](cloudflare/cdn/README.md) | Sole B2 credential holder; delivery + `/presign` | ✅ |
| **match-data** | [github/match-data](github/match-data/README.md) | BWF scrape → `matches` catalog upsert | ✅ |
| **video-preprocess** | [vast/video-preprocess](vast/video-preprocess/README.md) | Stage `normalize` | ✅ |
| **video-det** | [vast/video-det](vast/video-det/README.md) | Stage `detect` | 🚧 |
| **analysis** | `vast/analysis` | Stage `analyze` | 📐 not present |

```
match-data ──▶ matches rows (no GPU)
cdn ◀──▶ clients + edge functions (bytes + presign)
jobs/dispatch ──▶ normalize ──▶ detect ──▶ (analyze)
                     vast           vast
```

Each subdirectory has its own README (and extra deep docs where needed). Prefer
editing the worker-local doc for implementation detail; keep envelope/callback
and stage basenames aligned with root `ARCHITECTURE.md` § One job contract.
