"use client";

import { useEffect, useId, useRef, useState } from "react";

type BroadcastViewProps = {
  youtubeId: string | null;
  /** Absolute seconds into the broadcast */
  videoTime: number;
  playing: boolean;
  speed: number;
  /** When true, keep the player mounted but visually hidden (preserve position). */
  active?: boolean;
};

type YTPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  destroy: () => void;
};

type YTNamespace = {
  Player: new (
    el: string | HTMLElement,
    opts: {
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: number; target: YTPlayer }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const YT_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const YT_ID_RE = /^[\w-]{11}$/;

function nearestRate(speed: number) {
  let best: (typeof YT_RATES)[number] = 1;
  let bestD = Infinity;
  for (const r of YT_RATES) {
    const d = Math.abs(r - speed);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

/** Single shared loader — one script, one poll, one promise. */
let apiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("no window"));
  }
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (yt: YTNamespace) => {
      if (settled) return;
      settled = true;
      resolve(yt);
    };

    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT?.Player) finish(window.YT);
    };

    if (!document.getElementById("yt-iframe-api")) {
      const s = document.createElement("script");
      s.id = "yt-iframe-api";
      s.src = "https://www.youtube.com/iframe_api";
      s.onerror = () => {
        apiPromise = null;
        if (!settled) {
          settled = true;
          reject(new Error("YouTube API script failed"));
        }
      };
      document.head.appendChild(s);
    }

    const poll = window.setInterval(() => {
      if (window.YT?.Player) {
        window.clearInterval(poll);
        finish(window.YT);
      }
    }, 50);

    // Safety: stop polling after 30s if API never arrives
    window.setTimeout(() => {
      window.clearInterval(poll);
      if (!settled) {
        apiPromise = null;
        settled = true;
        reject(new Error("YouTube API timeout"));
      }
    }, 30_000);
  });

  return apiPromise;
}

/**
 * Clean YouTube broadcast — native controls hidden.
 * Play / pause / seek / rate driven by our transport.
 * Parent should keep this mounted when switching view modes.
 */
export function BroadcastView({
  youtubeId,
  videoTime,
  playing,
  speed,
  active = true,
}: BroadcastViewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const lastSeekRef = useRef(videoTime);
  const durationRef = useRef<number | null>(null);
  const propsRef = useRef({ videoTime, playing, speed, active });
  propsRef.current = { videoTime, playing, speed, active };

  const [error, setError] = useState<string | null>(null);

  const reactId = useId().replace(/:/g, "");
  const mountId = `yt-mount-${reactId}`;

  const validId = youtubeId && YT_ID_RE.test(youtubeId) ? youtubeId : null;

  useEffect(() => {
    if (!validId) {
      readyRef.current = false;
      playerRef.current = null;
      return;
    }

    let cancelled = false;
    const mount = mountRef.current;
    if (!mount) return;

    const target = document.createElement("div");
    target.id = mountId;
    target.style.width = "100%";
    target.style.height = "100%";
    mount.appendChild(target);

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;

        const player = new YT.Player(target, {
          videoId: validId,
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            cc_load_policy: 0,
            enablejsapi: 1,
            origin: typeof window !== "undefined" ? window.location.origin : "",
            start: Math.max(0, Math.floor(propsRef.current.videoTime)),
          },
          events: {
            onReady: (e) => {
              if (cancelled) return;
              readyRef.current = true;
              playerRef.current = e.target;
              try {
                durationRef.current = e.target.getDuration() || null;
              } catch {
                durationRef.current = null;
              }
              const { videoTime: vt, playing: pl, speed: sp, active: act } =
                propsRef.current;
              try {
                const dur = durationRef.current;
                const seekT =
                  dur != null && dur > 0 ? Math.min(Math.max(0, vt), dur - 0.05) : Math.max(0, vt);
                e.target.seekTo(seekT, true);
                e.target.setPlaybackRate(nearestRate(sp));
                if (pl && act) e.target.playVideo();
                else e.target.pauseVideo();
                lastSeekRef.current = seekT;
              } catch {
                /* ignore seek races */
              }
            },
            onError: () => {
              if (!cancelled) setError("Broadcast could not be loaded.");
            },
          },
        });
        playerRef.current = player;
      })
      .catch(() => {
        if (!cancelled) setError("Could not load YouTube player.");
      });

    return () => {
      cancelled = true;
      readyRef.current = false;
      try {
        playerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
      mount.innerHTML = "";
    };
  }, [validId, mountId]);

  useEffect(() => {
    const p = playerRef.current;
    if (!readyRef.current || !p) return;
    try {
      if (playing && active) p.playVideo();
      else p.pauseVideo();
    } catch {
      /* ignore */
    }
  }, [playing, active]);

  useEffect(() => {
    const p = playerRef.current;
    if (!readyRef.current || !p) return;
    try {
      p.setPlaybackRate(nearestRate(speed));
    } catch {
      /* ignore */
    }
  }, [speed]);

  useEffect(() => {
    const p = playerRef.current;
    if (!readyRef.current || !p) return;

    let targetT = Math.max(0, videoTime);
    const dur = durationRef.current;
    if (dur != null && dur > 0) {
      targetT = Math.min(targetT, Math.max(0, dur - 0.05));
    }

    let current = lastSeekRef.current;
    try {
      current = p.getCurrentTime();
    } catch {
      /* use last */
    }

    const delta = Math.abs(targetT - current);
    // When inactive, still seek so return to broadcast is correct, but keep paused
    const shouldSeek = playing && active ? delta > 1.25 : delta > 0.35;
    if (!shouldSeek) {
      // Parent clock frozen but YT still playing → force pause
      if (!playing || !active) {
        try {
          p.pauseVideo();
        } catch {
          /* ignore */
        }
      }
      return;
    }

    try {
      p.seekTo(targetT, true);
      lastSeekRef.current = targetT;
      if (playing && active) p.playVideo();
      else p.pauseVideo();
    } catch {
      /* ignore */
    }
  }, [videoTime, playing, active]);

  if (!validId) {
    return (
      <div className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-[var(--bg-sunken)] px-6 text-center">
        <div>
          <p className="font-display text-[15px] text-[var(--text-strong)]">
            No broadcast linked
          </p>
          <p className="mt-1.5 max-w-sm text-[12px] text-[var(--text-muted)]">
            This catalog match has no YouTube source. Switch to Corner or Player POV for demo 3D.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative h-full min-h-0 w-full overflow-hidden bg-black"
      hidden={!active}
      aria-hidden={!active}
    >
      <div
        ref={mountRef}
        className="absolute inset-0 h-full w-full [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:h-full [&_iframe]:w-full"
      />
      {/* Block native iframe clicks so transport stays source of truth */}
      <div className="absolute inset-0 z-[1]" aria-hidden />
      {error ? (
        <div className="absolute inset-0 z-[2] flex items-center justify-center bg-black/80 px-4 text-center text-[13px] text-[var(--text-secondary)]">
          {error}
        </div>
      ) : null}
    </div>
  );
}
