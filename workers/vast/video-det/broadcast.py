import time

import httpx

_INTERVAL = 2.0  # minimum seconds between progress broadcasts


class Broadcaster:
    def __init__(self, supabase_url: str, anon_key: str, channel: str) -> None:
        self._url = f"{supabase_url.rstrip('/')}/realtime/v1/api/broadcast"
        self._headers = {
            "Authorization": f"Bearer {anon_key}",
            "apikey": anon_key,
            "Content-Type": "application/json",
        }
        self._channel = channel
        self._last_sent = 0.0

    async def send_progress(
        self,
        progress: float,
        frames_done: int,
        frames_total: int,
        detections: list[dict],
    ) -> None:
        now = time.monotonic()
        if now - self._last_sent < _INTERVAL:
            return
        self._last_sent = now
        await self._post("progress", {
            "progress": round(progress, 4),
            "frames_done": frames_done,
            "frames_total": frames_total,
            "detections": detections,
        })

    async def send_final(
        self,
        status: str,
        output_b2_path: str | None = None,
        error: str | None = None,
    ) -> None:
        await self._post("complete", {
            "status": status,
            "output_b2_path": output_b2_path,
            "error": error,
        })

    async def _post(self, event: str, payload: dict) -> None:
        body = {"channel": self._channel, "event": event, "payload": payload}
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                await client.post(self._url, json=body, headers=self._headers)
        except Exception:
            pass  # broadcasts are best-effort; never block the main pipeline
