# video-preprocess

```text
User:  download → encode_full → upload normalized.mp4
BWF:   download → [CFR if VFR] → detect → encode_ranges → upload normalized.mp4
```

**BWF requires `annotation`** (raw `annotation.json`). Bare `valid_frames_config` is rejected.

| File | Role |
|---|---|
| `job.py` | Only pipeline (download → process → upload) |
| `io_util.py` | Download / upload |
| `normalize.py` | ffmpeg encode |
| `bwf/` | Detect + BWF metadata |
| `callback.py` | Result callback |
| `server.py` / `worker.py` / `entrypoint.sh` | Vast HTTP harness |
| `debug.py` | Local run of `job.py` + resource sampling |

## Debug

```bash
python debug.py /data/match.mp4
python debug.py 'https://youtu.be/…' --annotation ./annotation.json --out ./debug-bwf
# skip network baseline when offline:
python debug.py ./sample.mp4 --skip-speedtest
```

Order:

1. **speedtest** (`speedtest-cli` or Ookla `speedtest`) → `speedtest.json`
2. **full job** while sampling CPU/RSS/GPU every 0.5s → `resources.jsonl`
3. **efficiency** block in `result.json` (download Mbps vs speedtest, encode/detect realtime factor, GPU avg/peak)

Writes `normalized.mp4`, `result.json`, `resources.jsonl`, `speedtest.json` under `--out`.

## Metadata (success)

```json
{
  "request_id": "…",
  "status": "ok",
  "path": "user",
  "width": 1920, "height": 1080, "fps": 30.0, "duration": 123.4,
  "codec": "h264", "audio_codec": "aac", "pixel_fmt": "yuv420p", "file_size": 1,
  "source": { "width": 3840, "height": 2160, "fps": 59.94, "duration": 600.0,
              "codec": "hevc", "audio_codec": "aac", "pixel_fmt": "yuv420p",
              "file_size": 1, "is_vfr": false },
  "stage_timings": {
    "download_sec": 12.3, "probe_sec": 0.1, "encode_sec": 28.0,
    "upload_sec": 4.8, "total_sec": 45.2
  },
  "elapsed_sec": 45.2
}
```

BWF adds (court-visibility only; no OCR):

```json
"path": "bwf",
"bwf": {
  "mode": "court_only",
  "num_ranges": 12,
  "source_frame_count": 18000,
  "kept_frames": 9000,
  "frame_map": [{ "old_start": 0, "old_end": 99, "new_start": 0, "new_end": 49 }]
}
```

Optional stages in timings: `vfr_mezzanine_sec`, `detect_sec`, plus detect sub-stages
(`detect_reference_sec`, `detect_nvdec_trial_sec`, `detect_ncc_decode_sec`, …).

## Deploy

```bash
docker build -t video-preprocess .
docker run --gpus all -e CONTAINER_ID=0 -e USE_SSL=false -p 3000:3000 video-preprocess
```

Set `CALLBACK_URL_PREFIX` in production when using callbacks.
