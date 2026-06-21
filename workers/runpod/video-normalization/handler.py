import json
import os
import subprocess
import tempfile

import requests
import runpod


def download(url: str, dest: str) -> None:
    if url.startswith("file://"):
        import shutil
        shutil.copy(url[len("file://"):], dest)
        return
    with requests.get(url, stream=True, timeout=300) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=8 * 1024 * 1024):
                f.write(chunk)


def upload(local_path: str, url: str) -> None:
    if url.startswith("file://"):
        import shutil
        shutil.copy(local_path, url[len("file://"):])
        return
    with open(local_path, "rb") as f:
        resp = requests.put(url, data=f, timeout=600)
        resp.raise_for_status()


def _parse_fps(rate_str: str) -> float:
    num, den = rate_str.split("/")
    if float(den) == 0:
        return 0.0
    return float(num) / float(den)


def probe(path: str) -> dict:
    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_streams", "-show_format",
            path,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    data = json.loads(result.stdout)
    streams = data["streams"]
    fmt = data["format"]

    # Skip attached-picture streams (e.g. cover art embedded in audio files)
    video = next(
        (s for s in streams
         if s["codec_type"] == "video"
         and not s.get("disposition", {}).get("attached_pic", 0)),
        None,
    )
    if video is None:
        raise RuntimeError("no video stream found")

    audio = next((s for s in streams if s["codec_type"] == "audio"), None)

    # r_frame_rate can be "0/0" for VFR streams; fall back to avg_frame_rate
    fps = _parse_fps(video["r_frame_rate"])
    if fps == 0.0:
        fps = _parse_fps(video.get("avg_frame_rate", "0/1"))

    return {
        "width": int(video["width"]),
        "height": int(video["height"]),
        "fps": round(fps, 3),
        "audio_codec": audio["codec_name"] if audio else None,
        "duration": round(float(fmt["duration"]), 3),
        "codec": video["codec_name"],
        "pixel_fmt": video["pix_fmt"],
        "file_size": int(fmt["size"]),
    }


def build_ffmpeg_cmd(input_path: str, output_path: str, info: dict) -> list[str]:
    w, h, fps, audio_codec = info["width"], info["height"], info["fps"], info["audio_codec"]

    vf: list[str] = []

    # FPS before scale: lets ffmpeg skip frames before the expensive scale step
    if fps > 30:
        vf.append("fps=30")

    MAX_LONG, MAX_SHORT = 1920, 1080
    long_edge, short_edge = max(w, h), min(w, h)
    scale = min(MAX_LONG / long_edge, MAX_SHORT / short_edge)
    if scale < 1.0:
        new_w = (int(w * scale) // 2) * 2
        new_h = (int(h * scale) // 2) * 2
        vf.append(f"scale={new_w}:{new_h}")

    vf.append("format=yuv420p")

    if audio_codec is None:
        audio_args = ["-an"]
    elif audio_codec == "aac":
        audio_args = ["-c:a", "copy"]
    else:
        audio_args = ["-c:a", "aac", "-b:a", "128k"]

    cmd = [
        "ffmpeg", "-y",
        "-threads", "0",
        "-i", input_path,
        "-c:v", "libx264",
        "-crf", "23",
        "-preset", "fast",
        "-vf", ",".join(vf),
        *audio_args,
        "-movflags", "+faststart",
        output_path,
    ]

    return cmd


def handler(job: dict) -> dict:
    inp = job["input"]
    input_url = inp["input_url"]
    output_upload_url = inp["output_upload_url"]

    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "source")
        dst = os.path.join(tmp, "normalized.mp4")

        download(input_url, src)

        info = probe(src)
        cmd = build_ffmpeg_cmd(src, dst, info)

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg failed:\n{result.stderr}")

        upload(dst, output_upload_url)

        return probe(dst)


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        job = json.loads(sys.argv[1])
        result = handler({"input": job} if "input" not in job else job)
        print(json.dumps(result, indent=2))
    else:
        runpod.serverless.start({"handler": handler})
