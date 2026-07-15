"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  AUTO_IDS,
  C_DEFAULT,
  LANDMARKS,
  bilinear,
  computeQuality,
  lmById,
  nextUnplaced,
  truthOf,
  type Marks,
  type PlayerState,
  type StepKey,
} from "@/lib/calibration/geometry";
import { DIR, STEPS } from "@/lib/calibration/constants";

function readStoredFrame(fallback = 29): number {
  try {
    const f = parseInt(sessionStorage.getItem("mx_calib_frame") || "", 10);
    return Number.isNaN(f) ? fallback : f;
  } catch {
    return fallback;
  }
}

function readStoredFilename(
  fallback = "singles-drills-session-14.mp4",
): string {
  try {
    return sessionStorage.getItem("mx_calib_file") || fallback;
  } catch {
    return fallback;
  }
}

export function useCalibrationState() {
  const router = useRouter();
  const [step, setStep] = useState<StepKey>("points");
  const [maxStep, setMaxStep] = useState(0);
  const [marks, setMarks] = useState<Marks>({});
  const [selectedLm, setSelectedLm] = useState<string | null>("c-fl");
  const [linesDetected, setLinesDetected] = useState<false | "scanning" | true>(
    false,
  );
  const [players, setPlayers] = useState<Record<"a" | "b", PlayerState>>({
    a: "idle",
    b: "idle",
  });
  const [identify, setIdentify] = useState<
    Record<"a" | "b", { q: string; id: string | null }>
  >({ a: { q: "", id: null }, b: { q: "", id: null } });
  const [frame, setFrame] = useState(readStoredFrame);
  const [calibFrame, setCalibFrame] = useState(frame);
  const [starting, setStarting] = useState(false);
  const [vidReady, setVidReady] = useState(false);
  const [vidErr, setVidErr] = useState(false);
  const [cursor, setCursor] = useState<{
    nx: number;
    ny: number;
    x: number;
    y: number;
  } | null>(null);
  const [canvasRect, setCanvasRect] = useState({
    w: 0,
    h: 0,
    left: 0,
    top: 0,
  });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [filename] = useState(() => readStoredFilename());

  const canvasRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const loupeVidRef = useRef<HTMLVideoElement>(null);
  const reviewVidRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [skipClick, setSkipClick] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stepIdx = STEPS.findIndex((s) => s.key === step);
  const Q = useMemo(() => computeQuality(marks), [marks]);

  const activeCorners = useMemo((): [number, number][] => {
    const ids = ["c-fl", "c-fr", "c-nr", "c-nl"] as const;
    if (ids.every((id) => marks[id])) return ids.map((id) => marks[id]);
    return C_DEFAULT;
  }, [marks]);

  const B = useCallback(
    (u: number, v: number) => bilinear(activeCorners, u, v),
    [activeCorners],
  );

  const pointsPhase = useMemo(() => {
    const corners = ["c-fl", "c-fr", "c-nr", "c-nl"].filter((id) => marks[id])
      .length;
    const net = (marks["net-l"] ? 1 : 0) + (marks["net-r"] ? 1 : 0);
    const phase = corners < 4 ? "corners" : net < 2 ? "net" : "done";
    return { corners, net, phase };
  }, [marks]);

  const pointsDone = Q.ready;
  const playersDone = players.a === "detected" && players.b === "detected";
  const stepComplete =
    step === "points" ? pointsDone : step === "players" ? playersDone : true;

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setCanvasRect({ w: r.width, h: r.height, left: r.left, top: r.top });
    };
    measure();
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    const vids = [videoRef.current, loupeVidRef.current].filter(
      Boolean,
    ) as HTMLVideoElement[];
    const t = (frame / 99) * (videoRef.current?.duration || 24);
    vids.forEach((v) => {
      try {
        v.currentTime = t;
      } catch {
        /* ignore */
      }
    });
  }, [frame, vidReady]);

  useEffect(() => {
    const v = reviewVidRef.current;
    if (!v) return;
    try {
      v.currentTime = (calibFrame / 99) * (v.duration || 24);
    } catch {
      /* ignore */
    }
  }, [calibFrame, step]);

  useEffect(() => {
    const bag = timers;
    return () => {
      bag.current.forEach(clearTimeout);
    };
  }, []);

  const evtClient = useCallback(
    (cx: number, cy: number) => {
      const { w, h, left, top } = canvasRect;
      if (!w || !h) return { x: 0, y: 0, nx: 0, ny: 0 };
      const nx = Math.max(0, Math.min(1, (cx - left) / w));
      const ny = Math.max(0, Math.min(1, (cy - top) / h));
      return { x: nx * 1600, y: ny * 900, nx, ny };
    },
    [canvasRect],
  );

  const placeMark = useCallback((id: string, pt: [number, number]) => {
    setMarks((prev) => {
      const next = { ...prev, [id]: pt };
      setSelectedLm(nextUnplaced(next, id));
      return next;
    });
  }, []);

  const removeMark = useCallback((id: string) => {
    setMarks((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSelectedLm((s) => s || id);
  }, []);

  const detectPlayer = useCallback((k: "a" | "b") => {
    setPlayers((s) => ({ ...s, [k]: "detecting" }));
    const t = setTimeout(() => {
      setPlayers((s) => ({ ...s, [k]: "detected" }));
    }, 820);
    timers.current.push(t);
  }, []);

  const detectLines = useCallback(() => {
    if (linesDetected === "scanning") return;
    setLinesDetected("scanning");
    const t = setTimeout(() => {
      const next: Marks = {};
      AUTO_IDS.forEach((id) => {
        next[id] = truthOf(lmById(id), C_DEFAULT);
      });
      setMarks(next);
      setSelectedLm(null);
      setLinesDetected(true);
    }, 1000);
    timers.current.push(t);
  }, [linesDetected]);

  const onCanvasPointerMove = (e: ReactPointerEvent) => {
    const p = evtClient(e.clientX, e.clientY);
    setCursor(p);
  };

  const onMarkerPointerDown = (id: string, e: ReactPointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingId(id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onMarkerPointerMove = (id: string, e: ReactPointerEvent) => {
    if (draggingId !== id) return;
    const p = evtClient(e.clientX, e.clientY);
    setMarks((s) => ({ ...s, [id]: [p.x, p.y] }));
    setCursor(p);
  };

  const onMarkerPointerUp = (id: string) => {
    if (draggingId !== id) return;
    setSkipClick(true);
    setDraggingId(null);
    setTimeout(() => setSkipClick(false), 0);
  };

  const onCanvasClick = (e: ReactMouseEvent) => {
    if (skipClick || draggingId) return;
    const p = evtClient(e.clientX, e.clientY);
    if (step === "points") {
      if (!selectedLm) return;
      placeMark(selectedLm, [p.x, p.y]);
    } else if (step === "players") {
      const k =
        players.a !== "detected" ? "a" : players.b !== "detected" ? "b" : null;
      if (!k || players[k] === "detecting") return;
      detectPlayer(k);
    }
  };

  const scrubAt = (cx: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r?.width) return;
    const f = Math.max(
      0,
      Math.min(99, Math.round(((cx - r.left) / r.width) * 100)),
    );
    setFrame(f);
  };

  const onScrubDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrubAt(e.clientX);
  };

  const goTo = (key: StepKey) => {
    const idx = STEPS.findIndex((s) => s.key === key);
    if (idx <= maxStep) setStep(key);
  };

  const onBack = () => {
    if (stepIdx > 0) setStep(STEPS[stepIdx - 1].key);
  };

  const onPrimary = () => {
    if (step === "review") {
      setStarting(true);
      const t = setTimeout(() => {
        router.push("/video-analysis");
      }, 1100);
      timers.current.push(t);
      return;
    }
    if (!stepComplete) return;
    const ni = Math.min(STEPS.length - 1, stepIdx + 1);
    const nextKey = STEPS[ni].key;
    setStep(nextKey);
    setMaxStep((m) => Math.max(m, ni));
    if (nextKey !== "points") setFrame(calibFrame);
  };

  const resetStep = () => {
    if (step === "points") {
      setMarks({});
      setSelectedLm("c-fl");
      setLinesDetected(false);
    } else if (step === "players") {
      setPlayers({ a: "idle", b: "idle" });
      setIdentify({ a: { q: "", id: null }, b: { q: "", id: null } });
    }
  };

  const useThisFrame = () => {
    setCalibFrame(frame);
    try {
      sessionStorage.setItem("mx_calib_frame", String(frame));
    } catch {
      /* ignore */
    }
  };

  const results = (k: "a" | "b") => {
    const q = (identify[k].q || "").trim().toLowerCase();
    const otherId = identify[k === "a" ? "b" : "a"].id;
    const pool = DIR.filter((u) => u.id !== otherId);
    if (!q) return pool.slice(0, 4);
    return pool
      .filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.handle.toLowerCase().includes(q),
      )
      .slice(0, 5);
  };

  const titleMap = {
    points: [
      "Mark court reference points",
      "Pick a point on the diagram, then click it in the frame. The more points, the tighter the fit.",
    ],
    players: [
      "Segment & identify players",
      "Click each player on the court to mask them with SAM, then link a Mintonix profile. Naming is optional.",
    ],
    review: [
      "Review calibration",
      "Confirm the fit, players, and frame look right, then start the analysis.",
    ],
  } as const;

  const isCal = frame === calibFrame;
  const armedLm = selectedLm ? lmById(selectedLm) : null;
  const placedIds = LANDMARKS.filter((l) => marks[l.id]).map((l) => l.id);

  let hintText: string;
  if (step === "points") {
    if (selectedLm) hintText = `Click ${lmById(selectedLm).label}`;
    else
      hintText = Q.ready
        ? "Court fit · drag any point to refine, or pick more on the diagram"
        : "Pick a point on the court diagram to mark";
  } else if (step === "players") {
    hintText = playersDone
      ? "Both players segmented · link profiles in the panel →"
      : "Click a player — SAM segments them automatically";
  } else {
    hintText = "Calibration complete";
  }

  const gridPaths = useMemo(() => {
    const gl: string[] = [];
    for (let i = 1; i < 6; i++) {
      const a = B(0, i / 6);
      const b = B(1, i / 6);
      gl.push(`M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`);
    }
    for (let i = 1; i < 4; i++) {
      const a = B(i / 4, 0);
      const b = B(i / 4, 1);
      gl.push(`M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`);
    }
    return gl.join(" ");
  }, [B]);

  const showFit =
    (step === "points" && Q.n >= 4) || step === "players" || step === "review";

  const loupe = useMemo(() => {
    if (!cursor || step !== "points" || !canvasRect.w) return null;
    const Z = 2.5;
    const S = 154;
    const rw = canvasRect.w;
    const rh = canvasRect.h;
    let lx = cursor.nx * rw + 22;
    let ly = cursor.ny * rh - S - 18;
    if (ly < 8) ly = cursor.ny * rh + 22;
    if (lx + S > rw - 8) lx = cursor.nx * rw - S - 22;
    lx = Math.max(8, Math.min(rw - S - 8, lx));
    ly = Math.max(8, Math.min(rh - S - 8, ly));
    const innerW = rw * Z;
    const innerH = rh * Z;
    const ox = S / 2 - cursor.nx * rw * Z;
    const oy = S / 2 - cursor.ny * rh * Z;
    return { lx, ly, S, ox, oy, innerW, innerH };
  }, [cursor, step, canvasRect]);

  return {
    step,
    maxStep,
    marks,
    selectedLm,
    setSelectedLm,
    linesDetected,
    players,
    setPlayers,
    identify,
    setIdentify,
    frame,
    setFrame,
    calibFrame,
    starting,
    vidReady,
    setVidReady,
    vidErr,
    setVidErr,
    cursor,
    setCursor,
    draggingId,
    filename,
    canvasRef,
    videoRef,
    loupeVidRef,
    reviewVidRef,
    trackRef,
    stepIdx,
    Q,
    activeCorners,
    pointsPhase,
    stepComplete,
    placeMark,
    removeMark,
    detectPlayer,
    detectLines,
    onCanvasPointerMove,
    onMarkerPointerDown,
    onMarkerPointerMove,
    onMarkerPointerUp,
    onCanvasClick,
    scrubAt,
    onScrubDown,
    goTo,
    onBack,
    onPrimary,
    resetStep,
    useThisFrame,
    results,
    titleMap,
    isCal,
    armedLm,
    placedIds,
    hintText,
    gridPaths,
    showFit,
    loupe,
    playersDone,
  };
}

export type CalibrationState = ReturnType<typeof useCalibrationState>;
