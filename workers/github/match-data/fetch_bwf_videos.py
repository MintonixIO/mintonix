#!/usr/bin/env python3
"""
Fetch all YouTube video metadata from BWF channel using yt-dlp.

Usage:
  python3 fetch_bwf_videos.py flat [limit]
  python3 fetch_bwf_videos.py detailed [limit]
"""
import subprocess, json, csv, sys, os, time

CHANNEL_URL = "https://www.youtube.com/@BWF"
# The bare channel URL only returns the home-page shelves (~30 per tab). The
# full catalogue lives on the dedicated tabs, which we fetch and dedup by id.
# Shorts are excluded: they're highlight clips, not full-match videos, so they
# pollute match→video links.
CHANNEL_TABS = [
    "https://www.youtube.com/@BWF/videos",
    "https://www.youtube.com/@BWF/streams",
]
OUTPUT_CSV = "bwf_videos.csv"
OUTPUT_JSON = "bwf_videos.json"

def fetch_all_flat(limit=None):
    """Flat-list every video across the channel's tabs, deduped by video id."""
    videos = []
    seen = set()
    for tab in CHANNEL_TABS:
        cmd = [
            "yt-dlp",
            "--flat-playlist",
            "--dump-json",
            "--ignore-errors",
            "--no-warnings",
            tab,
        ]
        if limit:
            cmd += ["--playlist-end", str(limit)]
        print(f"Running: {' '.join(cmd)}")
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        for line in process.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            vid = data.get("id")
            if vid and vid in seen:
                continue
            if vid:
                seen.add(vid)
            videos.append(data)
            if len(videos) % 2000 == 0:
                print(f"  ... fetched {len(videos)} videos so far")
        process.wait()
        print(f"  tab done: {tab} (running total {len(videos)})")
    return videos

def fetch_detailed_batch(video_ids, batch_size=20):
    all_videos = []
    for i in range(0, len(video_ids), batch_size):
        batch = video_ids[i:i+batch_size]
        urls = [f"https://www.youtube.com/watch?v={vid}" for vid in batch]
        cmd = [
            "yt-dlp",
            "--dump-json",
            "--ignore-errors",
            "--no-warnings",
        ] + urls
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        for line in process.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                all_videos.append(data)
            except json.JSONDecodeError:
                pass
        process.wait()
        if (i // batch_size) % 50 == 0:
            print(f"  ... detailed: {min(i+batch_size, len(video_ids))}/{len(video_ids)}")
        time.sleep(0.3)
    return all_videos

def categorize(videos):
    cats = {"Videos": 0, "Live": 0, "Shorts": 0, "Unknown": 0}
    for v in videos:
        pl = v.get("playlist", "")
        if "Videos" in pl:
            cats["Videos"] += 1
        elif "Live" in pl:
            cats["Live"] += 1
        elif "Shorts" in pl:
            cats["Shorts"] += 1
        else:
            cats["Unknown"] += 1
    return cats

def best_thumbnail_url(v):
    thumbs = v.get("thumbnails", [])
    if not thumbs:
        return ""
    best = max(thumbs, key=lambda t: t.get("width", 0) * t.get("height", 0))
    return best["url"]

def save_csv(videos, filepath):
    if not videos:
        print("No videos to save")
        return
    keys = ["id", "title", "url", "playlist", "upload_date", "view_count", "like_count", "duration", "duration_string", "description", "thumbnail_url"]
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore", quoting=csv.QUOTE_ALL)
        writer.writeheader()
        for v in videos:
            row = {}
            for k in keys:
                val = v.get(k, "")
                if k == "thumbnail_url":
                    val = best_thumbnail_url(v)
                if isinstance(val, str):
                    val = val.replace("\n", "\\n")
                row[k] = val
            writer.writerow(row)
    print(f"Saved {len(videos)} videos to {filepath}")

def save_json(videos, filepath):
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(videos, f, ensure_ascii=False, indent=2)
    print(f"Saved {len(videos)} videos to {filepath}")

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "flat"
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else None

    if mode == "flat":
        print("Fetching all items from main channel page...")
        t0 = time.time()
        videos = fetch_all_flat(limit)
        elapsed = time.time() - t0
        print(f"Fetched {len(videos)} items in {elapsed:.1f}s")
        cats = categorize(videos)
        print(f"Categories: {cats}")
        if videos:
            save_csv(videos, OUTPUT_CSV)
            save_json(videos, OUTPUT_JSON)
            print(f"Sample: id={videos[0].get('id')} playlist={videos[0].get('playlist')} title={videos[0].get('title')}")

    elif mode == "detailed":
        print("Fetching detailed info for all videos...")
        with open(OUTPUT_JSON) as f:
            flat_videos = json.load(f)
        video_ids = [v["id"] for v in flat_videos]
        print(f"Total video IDs: {len(video_ids)}")
        t0 = time.time()
        detailed = fetch_detailed_batch(video_ids)
        elapsed = time.time() - t0
        print(f"Fetched {len(detailed)} detailed entries in {elapsed:.1f}s")
        if detailed:
            save_csv(detailed, "bwf_videos_detailed.csv")
            save_json(detailed, "bwf_videos_detailed.json")
