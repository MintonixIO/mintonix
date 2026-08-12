"use client";

import { useEffect, useId, useRef } from "react";

type BroadcastViewProps = {
  youtubeId: string;
  /** Absolute seconds into the broadcast */
  videoTime: number;
  playing: boolean;
  speed: number;
};

type YTPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  getCurrentTime: () => number;
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

function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);

  return new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
    };

    if (!document.getElementById("yt-iframe-api")) {
      const s = document.createElement("script");
      s.id = "yt-iframe-api";
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    }

    const poll = window.setInterval(() => {
      if (window.YT?.Player) {
        window.clearInterval(poll);
        resolve(window.YT);
      }
    }, 50);
  });
}

/**
 * Clean YouTube broadcast — native controls hidden.
 * Play / pause / seek / rate driven by our transport.
 */
export function BroadcastView({ youtubeId, videoTime, playing, speed }: BroadcastViewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const lastSeekRef = useRef(videoTime);
  const propsRef = useRef({ videoTime, playing, speed });
  propsRef.current = { videoTime, playing, speed };

  const reactId = useId().replace(/:/g, "");
  const mountId = `yt-mount-${reactId}`;

  useEffect(() => {
    let cancelled = false;
    const mount = mountRef.current;
    if (!mount) return;

    const target = document.createElement("div");
    target.id = mountId;
    target.style.width = "100%";
    target.style.height = "100%";
    mount.appendChild(target);

    loadYouTubeApi().then((YT) => {
      if (cancelled) return;

      const player = new YT.Player(target, {
        videoId: youtubeId,
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
            const { videoTime: vt, playing: pl, speed: sp } = propsRef.current;
            try {
              e.target.seekTo(Math.max(0, vt), true);
              e.target.setPlaybackRate(nearestRate(sp));
              if (pl) e.target.playVideo();
              else e.target.pauseVideo();
              lastSeekRef.current = vt;
            } catch {
              /* ignore */
            }
          },
        },
      });
      playerRef.current = player;
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
  }, [youtubeId, mountId]);

  useEffect(() => {
    const p = playerRef.current;
    if (!readyRef.current || !p) return;
    try {
      if (playing) p.playVideo();
      else p.pauseVideo();
    } catch {
      /* ignore */
    }
  }, [playing]);

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

    const targetT = Math.max(0, videoTime);
    let current = lastSeekRef.current;
    try {
      current = p.getCurrentTime();
    } catch {
      /* use last */
    }

    const delta = Math.abs(targetT - current);
    const shouldSeek = playing ? delta > 1.25 : delta > 0.35;
    if (!shouldSeek) return;

    try {
      p.seekTo(targetT, true);
      lastSeekRef.current = targetT;
      if (playing) p.playVideo();
      else p.pauseVideo();
    } catch {
      /* ignore */
    }
  }, [videoTime, playing]);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-black">
      <div
        ref={mountRef}
        className="absolute inset-0 h-full w-full [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:h-full [&_iframe]:w-full"
      />
      <div className="absolute inset-0 z-[1]" aria-hidden />
    </div>
  );
}
