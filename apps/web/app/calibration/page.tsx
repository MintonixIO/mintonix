"use client";

import Link from "next/link";
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Film,
  Gauge,
  Image as ImageIcon,
  Minus,
  MousePointerClick,
  RotateCcw,
  ScanLine,
  ScanSearch,
  Scissors,
  Sparkles,
  User,
  UserMinus,
  UserRound,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/* ---------- geometry (1600×900 overlay space) ---------- */
const C_DEFAULT: [number, number][] = [
  [384, 459],
  [1216, 459],
  [1392, 819],
  [208, 819],
];
const POLE: [number, number][] = [
  [288, 477],
  [1312, 477],
];
const PBOX = {
  a: { x: 720, y: 540, w: 224, h: 234 },
  b: { x: 624, y: 405, w: 144, h: 171 },
} as const;
const PA = "#3693ff";
const PB = "#fbbf24";

type Landmark = {
  id: string;
  label: string;
  short: string;
  uv?: [number, number];
  img?: [number, number];
  zone: "corner" | "net" | "singles" | "service";
};

const LANDMARKS: Landmark[] = [
  { id: "c-fl", label: "Far baseline · left", short: "1", uv: [0, 0], zone: "corner" },
  { id: "c-fr", label: "Far baseline · right", short: "2", uv: [1, 0], zone: "corner" },
  { id: "c-nr", label: "Near baseline · right", short: "3", uv: [1, 1], zone: "corner" },
  { id: "c-nl", label: "Near baseline · left", short: "4", uv: [0, 1], zone: "corner" },
  { id: "net-l", label: "Net pole top · left", short: "L", img: [288, 477], zone: "net" },
  { id: "net-r", label: "Net pole top · right", short: "R", img: [1312, 477], zone: "net" },
  { id: "s-fl", label: "Far singles · left", short: "a", uv: [0.08, 0], zone: "singles" },
  { id: "s-fr", label: "Far singles · right", short: "b", uv: [0.92, 0], zone: "singles" },
  { id: "s-nr", label: "Near singles · right", short: "c", uv: [0.92, 1], zone: "singles" },
  { id: "s-nl", label: "Near singles · left", short: "d", uv: [0.08, 1], zone: "singles" },
  { id: "t-f", label: "Far service T", short: "T", uv: [0.5, 0.36], zone: "service" },
  { id: "t-n", label: "Near service T", short: "T", uv: [0.5, 0.64], zone: "service" },
  { id: "sv-fl", label: "Far service · left", short: "·", uv: [0.08, 0.36], zone: "service" },
  { id: "sv-fr", label: "Far service · right", short: "·", uv: [0.92, 0.36], zone: "service" },
  { id: "sv-nl", label: "Near service · left", short: "·", uv: [0.08, 0.64], zone: "service" },
  { id: "sv-nr", label: "Near service · right", short: "·", uv: [0.92, 0.64], zone: "service" },
];

const AUTO_IDS = ["c-fl", "c-fr", "c-nr", "c-nl", "t-f", "t-n", "net-l", "net-r"];

const STEPS = [
  { key: "points" as const, label: "Court" },
  { key: "players" as const, label: "Players" },
  { key: "review" as const, label: "Review" },
];

const DIR = [
  { id: "axelsen", name: "Viktor Axelsen", handle: "@axelsen", meta: "WR 1 · DEN" },
  { id: "momota", name: "Kento Momota", handle: "@momota", meta: "WR 4 · JPN" },
  { id: "ginting", name: "Anthony Ginting", handle: "@ginting", meta: "WR 6 · INA" },
  { id: "antonsen", name: "Anders Antonsen", handle: "@antonsen", meta: "WR 3 · DEN" },
  { id: "lee", name: "Lee Zii Jia", handle: "@ziijia", meta: "WR 9 · MAS" },
  { id: "naraoka", name: "Kodai Naraoka", handle: "@naraoka", meta: "WR 7 · JPN" },
  { id: "popov", name: "Christo Popov", handle: "@cpopov", meta: "WR 14 · FRA" },
  { id: "you", name: "You (this device)", handle: "@me", meta: "Your profile" },
];

type StepKey = (typeof STEPS)[number]["key"];
type PlayerState = "idle" | "detecting" | "detected";
type Marks = Record<string, [number, number]>;

function lmById(id: string) {
  return LANDMARKS.find((l) => l.id === id)!;
}

function bilinear(
  corners: [number, number][],
  u: number,
  v: number,
): [number, number] {
  const [c0, c1, c2, c3] = corners;
  const tx = c0[0] + (c1[0] - c0[0]) * u;
  const ty = c0[1] + (c1[1] - c0[1]) * u;
  const bx = c3[0] + (c2[0] - c3[0]) * u;
  const by = c3[1] + (c2[1] - c3[1]) * u;
  return [tx + (bx - tx) * v, ty + (by - ty) * v];
}

function truthOf(lm: Landmark, corners: [number, number][]): [number, number] {
  if (lm.uv) return bilinear(corners, lm.uv[0], lm.uv[1]);
  return lm.img!.slice() as [number, number];
}

function computeQuality(marks: Marks) {
  const ids = Object.keys(marks);
  const n = ids.length;
  const quads = new Set<string>();
  ids.forEach((id) => {
    const lm = lmById(id);
    if (!lm?.uv) return;
    quads.add((lm.uv[0] < 0.5 ? "L" : "R") + (lm.uv[1] < 0.5 ? "F" : "N"));
  });
  const quad = quads.size;
  const netReady = !!(marks["net-l"] && marks["net-r"]);
  const ready = quad >= 4 && netReady;
  const extra = Math.max(0, n - quad - (netReady ? 2 : 0));
  const score = Math.min(100, quad * 16 + (netReady ? 22 : 0) + extra * 5);
  const zonesLeft = Math.max(0, 4 - quad);
  let level: "need" | "good" | "excellent";
  let color: string;
  let label: string;
  if (!ready) {
    level = "need";
    color = "var(--warning-500)";
    if (!netReady && zonesLeft) label = `Net poles + ${zonesLeft} zone${zonesLeft === 1 ? "" : "s"}`;
    else if (!netReady) label = "Mark net poles";
    else label = `${zonesLeft} zone${zonesLeft === 1 ? "" : "s"} left`;
  } else if (score < 92) {
    level = "good";
    color = "var(--success-500)";
    label = "Good";
  } else {
    level = "excellent";
    color = "var(--success-500)";
    label = "Excellent";
  }
  const err = Math.max(0.4, 2.0 - n * 0.17).toFixed(1);
  return { n, quad, zonesLeft, score, level, color, label, err, netReady, ready };
}

function timecodeOf(f: number) {
  const total = 42 + f;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function nextUnplaced(marks: Marks, afterId?: string | null) {
  const start = afterId ? LANDMARKS.findIndex((l) => l.id === afterId) + 1 : 0;
  for (let i = start; i < LANDMARKS.length; i++) {
    if (!marks[LANDMARKS[i].id]) return LANDMARKS[i].id;
  }
  for (let i = 0; i < start; i++) {
    if (!marks[LANDMARKS[i].id]) return LANDMARKS[i].id;
  }
  return null;
}

/* ---------- Court schematic SVG ---------- */
function CourtSchematic({
  marks,
  selectedLm,
  onArm,
}: {
  marks: Marks;
  selectedLm: string | null;
  onArm: (id: string) => void;
}) {
  const X0 = 42,
    X1 = 158,
    Y0 = 22,
    Y1 = 338;
  const sx = (u: number) => X0 + u * (X1 - X0);
  const sy = (v: number) => Y0 + v * (Y1 - Y0);

  return (
    <svg
      viewBox="0 0 200 360"
      className="mx-auto block w-full max-w-[256px]"
      role="img"
      aria-label="Court diagram — pick a reference point"
    >
      <text
        x={100}
        y={12}
        textAnchor="middle"
        fill="var(--text-faint)"
        style={{ fontFamily: "var(--font-mono)", fontSize: 8, letterSpacing: "0.12em" }}
      >
        FAR
      </text>
      <text
        x={100}
        y={354}
        textAnchor="middle"
        fill="var(--text-faint)"
        style={{ fontFamily: "var(--font-mono)", fontSize: 8, letterSpacing: "0.12em" }}
      >
        NEAR
      </text>
      <rect
        x={sx(0)}
        y={sy(0)}
        width={sx(1) - sx(0)}
        height={sy(1) - sy(0)}
        rx={2}
        fill="rgba(34,86,77,0.32)"
        stroke="rgba(228,242,237,0.72)"
        strokeWidth={1.6}
      />
      {[
        [sx(0.08), sy(0), sx(0.08), sy(1), 0.42],
        [sx(0.92), sy(0), sx(0.92), sy(1), 0.42],
        [sx(0), sy(0.07), sx(1), sy(0.07), 0.28],
        [sx(0), sy(0.93), sx(1), sy(0.93), 0.28],
        [sx(0), sy(0.36), sx(1), sy(0.36), 0.5],
        [sx(0), sy(0.64), sx(1), sy(0.64), 0.5],
        [sx(0.5), sy(0), sx(0.5), sy(0.36), 0.42],
        [sx(0.5), sy(0.64), sx(0.5), sy(1), 0.42],
      ].map(([x1, y1, x2, y2, o], i) => (
        <line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={`rgba(228,242,237,${o})`}
          strokeWidth={1.3}
          strokeLinecap="round"
        />
      ))}
      <line
        x1={sx(-0.085)}
        y1={sy(0.5)}
        x2={sx(1.085)}
        y2={sy(0.5)}
        stroke="rgba(228,242,237,0.6)"
        strokeWidth={1.3}
        strokeDasharray="4 3"
        strokeLinecap="round"
      />
      {LANDMARKS.map((lm) => {
        const pos = lm.uv
          ? [sx(lm.uv[0]), sy(lm.uv[1])]
          : [lm.id === "net-l" ? sx(-0.06) : sx(1.06), sy(0.5)];
        const placed = !!marks[lm.id];
        const armed = selectedLm === lm.id;
        const reqOpen = lm.zone === "net" && !placed;
        const ringCol = reqOpen ? "var(--warning-500)" : PA;
        return (
          <g
            key={lm.id}
            onClick={(e) => {
              e.stopPropagation();
              onArm(lm.id);
            }}
            className="cursor-pointer"
            role="button"
            tabIndex={0}
            aria-label={`${lm.label}${placed ? " (placed)" : ""}${armed ? " (selected)" : ""}`}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onArm(lm.id);
              }
            }}
          >
            <circle cx={pos[0]} cy={pos[1]} r={11} fill="transparent" />
            {reqOpen ? (
              <circle
                cx={pos[0]}
                cy={pos[1]}
                r={8.5}
                fill="none"
                stroke="var(--warning-500)"
                strokeWidth={1.2}
                strokeDasharray="2.2 2.4"
                opacity={armed ? 0.5 : 0.85}
              />
            ) : null}
            {armed ? (
              <circle
                cx={pos[0]}
                cy={pos[1]}
                r={5}
                fill="none"
                stroke={ringCol}
                strokeWidth={1.5}
                className="motion-safe:animate-[mxPing_1.5s_ease-out_infinite]"
                style={{ transformOrigin: `${pos[0]}px ${pos[1]}px` }}
              />
            ) : null}
            <circle
              cx={pos[0]}
              cy={pos[1]}
              r={armed ? 5.6 : placed ? 5 : 4.4}
              fill={
                placed
                  ? PA
                  : armed
                    ? reqOpen
                      ? "rgba(251,191,36,0.28)"
                      : "rgba(54,147,255,0.28)"
                    : reqOpen
                      ? "rgba(251,191,36,0.16)"
                      : "rgba(7,8,9,0.55)"
              }
              stroke={
                placed ? PA : reqOpen ? "var(--warning-500)" : armed ? PA : "rgba(228,242,237,0.55)"
              }
              strokeWidth={1.6}
            />
            {placed ? (
              <path
                d={`M${pos[0] - 2.3} ${pos[1]} l1.7 1.8 l3.1 -3.6`}
                stroke="#fff"
                strokeWidth={1.4}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
            {reqOpen ? (
              <text
                x={pos[0]}
                y={pos[1] - 13}
                textAnchor="middle"
                fill="var(--warning-500)"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 7,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                }}
              >
                POLE
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export default function CalibrationPage() {
  const [step, setStep] = useState<StepKey>("points");
  const [maxStep, setMaxStep] = useState(0);
  const [marks, setMarks] = useState<Marks>({});
  const [selectedLm, setSelectedLm] = useState<string | null>("c-fl");
  const [linesDetected, setLinesDetected] = useState<false | "scanning" | true>(false);
  const [players, setPlayers] = useState<Record<"a" | "b", PlayerState>>({
    a: "idle",
    b: "idle",
  });
  const [identify, setIdentify] = useState<
    Record<"a" | "b", { q: string; id: string | null }>
  >({ a: { q: "", id: null }, b: { q: "", id: null } });
  const [frame, setFrame] = useState(() => {
    try {
      const f = parseInt(sessionStorage.getItem("mx_calib_frame") || "", 10);
      return Number.isNaN(f) ? 29 : f;
    } catch {
      return 29;
    }
  });
  const [calibFrame, setCalibFrame] = useState(() => {
    try {
      const f = parseInt(sessionStorage.getItem("mx_calib_frame") || "", 10);
      return Number.isNaN(f) ? 29 : f;
    } catch {
      return 29;
    }
  });
  const [starting, setStarting] = useState(false);
  const [vidReady, setVidReady] = useState(false);
  const [vidErr, setVidErr] = useState(false);
  const [cursor, setCursor] = useState<{ nx: number; ny: number; x: number; y: number } | null>(
    null,
  );
  const [canvasRect, setCanvasRect] = useState({ w: 0, h: 0, left: 0, top: 0 });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [filename] = useState(() => {
    try {
      return sessionStorage.getItem("mx_calib_file") || "singles-drills-session-14.mp4";
    } catch {
      return "singles-drills-session-14.mp4";
    }
  });

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
    const corners = ["c-fl", "c-fr", "c-nr", "c-nl"].filter((id) => marks[id]).length;
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
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
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
    const vids = [videoRef.current, loupeVidRef.current].filter(Boolean) as HTMLVideoElement[];
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

  const onCanvasClick = (e: React.MouseEvent) => {
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
    const f = Math.max(0, Math.min(99, Math.round(((cx - r.left) / r.width) * 100)));
    setFrame(f);
  };

  const onScrubDown = (e: React.PointerEvent) => {
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
        window.location.href = "/video-analysis";
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
          u.name.toLowerCase().includes(q) || u.handle.toLowerCase().includes(q),
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

  // Provisional fit paths
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

  // Loupe position (uses measured canvas size — no ref reads during render)
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

  return (
    <div className="flex h-screen min-h-[640px] flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      <style jsx global>{`
        @keyframes mxPing {
          0% {
            opacity: 0.55;
            transform: translate(-50%, -50%) scale(0.55);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(1.9);
          }
        }
        @keyframes mxSpin {
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes mxScanY {
          0% {
            top: 2%;
          }
          100% {
            top: 98%;
          }
        }
        @keyframes mxRise {
          from {
            opacity: 0;
            transform: translateY(7px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .motion-safe\\:animate-\\[mxPing_1\\.5s_ease-out_infinite\\],
          [style*="mxPing"],
          [style*="mxSpin"],
          [style*="mxScanY"],
          [style*="mxRise"] {
            animation: none !important;
          }
        }
      `}</style>

      {/* Top bar */}
      <header className="flex h-[58px] shrink-0 items-center gap-3.5 border-b border-[var(--border)] bg-[var(--surface-1)] px-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logomark.png" alt="Mintonix" className="block h-[21px] w-auto" />
        <span className="h-[22px] w-px bg-[var(--border)]" aria-hidden />
        <div className="flex min-w-0 flex-col gap-px max-[560px]:hidden">
          <span className="font-display text-sm font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
            Calibrate match
          </span>
          <span className="inline-flex max-w-[240px] items-center gap-1.5 truncate font-mono text-[11px] text-[var(--text-muted)]">
            <Film className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{filename}</span>
          </span>
        </div>
        <div className="flex-1" />
        <span className="font-mono text-[11px] tracking-wide text-[var(--text-muted)]">
          STEP {stepIdx + 1} / {STEPS.length}
        </span>
        <Link
          href="/dashboard"
          aria-label="Close"
          className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
        >
          <X className="h-[17px] w-[17px]" />
        </Link>
      </header>

      <div className="mxRow flex min-h-0 flex-1 max-[880px]:flex-col">
        {/* Canvas */}
        <section className="flex min-w-0 flex-1 flex-col bg-[var(--bg-sunken)]">
          <div className="flex min-h-0 flex-1 items-center justify-center p-[22px] max-[880px]:flex-none max-[880px]:p-[11px]">
            <div
              ref={canvasRef}
              role="application"
              aria-label="Calibration frame — click to place points"
              onPointerMove={onCanvasPointerMove}
              onPointerLeave={() => setCursor(null)}
              onClick={onCanvasClick}
              className="relative aspect-video w-full max-w-[calc((100vh-210px)*1.7778)] touch-none select-none overflow-hidden rounded-[13px] border border-[var(--border-strong)] bg-[#060b0a] shadow-[var(--shadow-lg)]"
              style={{
                cursor:
                  step === "points" && selectedLm
                    ? "crosshair"
                    : step === "players"
                      ? "pointer"
                      : "default",
              }}
            >
              {/* Video */}
              <div className="absolute inset-0 bg-[#070b0a]">
                {vidErr ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 font-mono text-[12.5px] text-[var(--text-muted)]">
                    <Film className="h-5 w-5" />
                    Footage preview unavailable
                  </div>
                ) : !vidReady ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-[radial-gradient(120%_100%_at_50%_30%,#11201d_0%,#0a120f_55%,#070b0a_100%)] font-mono text-xs text-[var(--text-muted)]">
                    <span
                      className="inline-block h-4 w-4 rounded-full border-2 border-[rgba(54,147,255,0.3)] border-t-[var(--brand)]"
                      style={{ animation: "mxSpin 0.7s linear infinite" }}
                    />
                    Loading footage…
                  </div>
                ) : null}
                <video
                  ref={videoRef}
                  src="/media/clip.mp4"
                  muted
                  playsInline
                  preload="auto"
                  tabIndex={-1}
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                  onLoadedMetadata={() => setVidReady(true)}
                  onLoadedData={() => setVidReady(true)}
                  onError={() => setVidErr(true)}
                />
              </div>

              {/* SVG overlays */}
              <div className="pointer-events-none absolute inset-0">
                <svg
                  viewBox="0 0 1600 900"
                  preserveAspectRatio="none"
                  className="absolute inset-0 h-full w-full"
                >
                  {showFit ? (
                    <>
                      <polygon
                        points={activeCorners.map((p) => p.join(",")).join(" ")}
                        fill="rgba(54,147,255,0.10)"
                        stroke={PA}
                        strokeWidth={2.4}
                        strokeDasharray={
                          step === "points" && Q.n < 6 ? "7 6" : "none"
                        }
                        strokeLinejoin="round"
                      />
                      <path
                        d={gridPaths}
                        stroke="rgba(54,147,255,0.26)"
                        strokeWidth={1}
                        fill="none"
                      />
                      {(Q.netReady || step !== "points") && (
                        <line
                          x1={(marks["net-l"] || POLE[0])[0]}
                          y1={(marks["net-l"] || POLE[0])[1]}
                          x2={(marks["net-r"] || POLE[1])[0]}
                          y2={(marks["net-r"] || POLE[1])[1]}
                          stroke={PA}
                          strokeWidth={2.2}
                          strokeDasharray="6 5"
                        />
                      )}
                    </>
                  ) : null}

                  {(["a", "b"] as const).map((k) => {
                    if (step === "points") return null;
                    const color = k === "a" ? PA : PB;
                    const b = PBOX[k];
                    const cx = b.x + b.w / 2;
                    const headR = b.w * 0.3;
                    const headCy = b.y + headR * 0.9;
                    if (players[k] === "detected") {
                      return (
                        <g key={k}>
                          <circle
                            cx={cx}
                            cy={headCy}
                            r={headR}
                            fill={color}
                            fillOpacity={0.3}
                          />
                          <rect
                            x={b.x + b.w * 0.08}
                            y={headCy}
                            width={b.w * 0.84}
                            height={b.h - (headCy - b.y)}
                            rx={b.w * 0.26}
                            fill={color}
                            fillOpacity={0.3}
                          />
                          <rect
                            x={b.x}
                            y={b.y}
                            width={b.w}
                            height={b.h}
                            rx={8}
                            fill="none"
                            stroke={color}
                            strokeWidth={2.4}
                            strokeDasharray="8 6"
                          />
                        </g>
                      );
                    }
                    if (players[k] === "detecting") {
                      return (
                        <rect
                          key={k}
                          x={b.x}
                          y={b.y}
                          width={b.w}
                          height={b.h}
                          rx={8}
                          fill="rgba(54,147,255,0.08)"
                          stroke={color}
                          strokeWidth={2}
                          strokeDasharray="4 4"
                        />
                      );
                    }
                    return null;
                  })}
                </svg>

                {/* Player labels */}
                {step !== "points" &&
                  (["a", "b"] as const).map((k) => {
                    const b = PBOX[k];
                    const color = k === "a" ? PA : PB;
                    if (players[k] === "detected") {
                      return (
                        <div
                          key={`lbl${k}`}
                          className="absolute inline-flex items-center gap-1.5 rounded-[7px] px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wide"
                          style={{
                            left: `${(b.x / 1600) * 100}%`,
                            top: `${(b.y / 900) * 100}%`,
                            transform: "translateY(-100%)",
                            marginTop: -3,
                            background: color,
                            color: k === "a" ? "#fff" : "#1a1300",
                            animation: "mxRise 240ms var(--ease-out, ease) both",
                          }}
                        >
                          Player {k.toUpperCase()}
                          <span className="font-normal opacity-75">98%</span>
                        </div>
                      );
                    }
                    if (players[k] === "detecting") {
                      return (
                        <div
                          key={`det${k}`}
                          className="absolute inline-flex items-center gap-1.5 rounded-[7px] border px-2 py-1 font-mono text-[11px] text-[var(--text-primary)]"
                          style={{
                            left: `${((b.x + b.w / 2) / 1600) * 100}%`,
                            top: `${(b.y / 900) * 100}%`,
                            transform: "translate(-50%, -130%)",
                            background: "rgba(7,8,9,0.85)",
                            borderColor: color,
                          }}
                        >
                          <span
                            className="inline-block h-[11px] w-[11px] rounded-full border-2 border-white/25"
                            style={{
                              borderTopColor: color,
                              animation: "mxSpin 0.7s linear infinite",
                            }}
                          />
                          Segmenting…
                        </div>
                      );
                    }
                    return null;
                  })}

                {/* Placed markers (draggable) */}
                {step === "points" &&
                  Object.entries(marks).map(([id, p]) => {
                    const lm = lmById(id);
                    return (
                      <div
                        key={id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${lm.label} marker — drag to adjust`}
                        onPointerDown={(e) => onMarkerPointerDown(id, e)}
                        onPointerMove={(e) => onMarkerPointerMove(id, e)}
                        onPointerUp={() => onMarkerPointerUp(id)}
                        onPointerCancel={() => onMarkerPointerUp(id)}
                        className={cn(
                          "absolute z-[4] h-[34px] w-[34px] touch-none",
                          draggingId === id ? "cursor-grabbing" : "cursor-grab",
                        )}
                        style={{
                          left: `${(p[0] / 1600) * 100}%`,
                          top: `${(p[1] / 900) * 100}%`,
                          transform: "translate(-50%, -50%)",
                        }}
                      >
                        <div
                          className="absolute inset-0 rounded-full border-2"
                          style={{
                            borderColor: PA,
                            boxShadow: `0 0 0 1px rgba(7,8,9,0.6), 0 0 12px ${PA}66`,
                          }}
                        />
                        <div
                          className="absolute left-1/2 top-1/2 h-3.5 w-px -translate-x-1/2 -translate-y-1/2"
                          style={{ background: PA }}
                        />
                        <div
                          className="absolute left-1/2 top-1/2 h-px w-3.5 -translate-x-1/2 -translate-y-1/2"
                          style={{ background: PA }}
                        />
                        <div
                          className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                          style={{ background: PA }}
                        />
                        <div
                          className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 rounded bg-[rgba(7,8,9,0.82)] px-1.5 py-px font-mono text-[10px] font-semibold leading-relaxed"
                          style={{ color: PA }}
                        >
                          {lm.short}
                        </div>
                      </div>
                    );
                  })}
              </div>

              {/* Scan overlay */}
              {step === "points" && linesDetected === "scanning" ? (
                <div className="pointer-events-none absolute inset-0 overflow-hidden bg-[rgba(54,147,255,0.04)]">
                  <div
                    className="absolute left-0 right-0 h-0.5"
                    style={{
                      background: `linear-gradient(90deg, transparent, ${PA}, transparent)`,
                      boxShadow: `0 0 18px ${PA}`,
                      animation: "mxScanY 0.95s var(--ease-out, ease) forwards",
                    }}
                  />
                  <div
                    className="absolute left-1/2 top-3.5 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11.5px] text-[var(--text-primary)]"
                    style={{ borderColor: PA, background: "rgba(7,8,9,0.85)" }}
                  >
                    <span
                      className="inline-block h-[11px] w-[11px] rounded-full border-2 border-white/25"
                      style={{
                        borderTopColor: PA,
                        animation: "mxSpin 0.7s linear infinite",
                      }}
                    />
                    Detecting court lines…
                  </div>
                </div>
              ) : null}

              {/* Magnifier loupe */}
              {loupe && cursor ? (
                <div
                  className="pointer-events-none absolute z-[6] overflow-hidden rounded-full border-2 bg-[#060b0a]"
                  style={{
                    left: loupe.lx,
                    top: loupe.ly,
                    width: loupe.S,
                    height: loupe.S,
                    borderColor: PA,
                    boxShadow:
                      "0 0 0 1px rgba(7,8,9,0.6), 0 10px 30px rgba(3,7,18,0.6)",
                  }}
                  aria-hidden
                >
                  <video
                    ref={loupeVidRef}
                    src="/media/clip.mp4"
                    muted
                    playsInline
                    preload="auto"
                    tabIndex={-1}
                    className="absolute object-fill"
                    style={{
                      left: loupe.ox,
                      top: loupe.oy,
                      width: loupe.innerW,
                      height: loupe.innerH,
                    }}
                  />
                  <div className="absolute bottom-0 left-1/2 top-0 w-px bg-[rgba(54,147,255,0.6)]" />
                  <div className="absolute left-0 right-0 top-1/2 h-px bg-[rgba(54,147,255,0.6)]" />
                  <div className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80" />
                  <div className="absolute bottom-2 left-2 font-mono text-[9px] tracking-wide text-white/70">
                    2.5×
                  </div>
                </div>
              ) : null}

              {/* Fit chip */}
              {step === "points" && Q.n >= 4 && linesDetected !== "scanning" ? (
                <div
                  className="pointer-events-none absolute right-3.5 top-3.5 z-[5] inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] text-[var(--text-secondary)] backdrop-blur-[8px]"
                  style={{
                    background: "rgba(7,8,9,0.72)",
                    borderColor:
                      Q.level === "need"
                        ? "rgba(251,191,36,0.4)"
                        : "rgba(45,212,167,0.4)",
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: Q.color }}
                  />
                  <span className="font-semibold" style={{ color: Q.color }}>
                    FIT
                  </span>
                  reproj {Q.err}px
                </div>
              ) : null}

              {/* Canvas hint */}
              <div className="pointer-events-none absolute left-3.5 top-3.5 z-[5] inline-flex max-w-[54%] items-center gap-2 rounded-[9px] border border-white/10 bg-[rgba(7,8,9,0.7)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] backdrop-blur-[8px]">
                {step === "players" ? (
                  <ScanSearch className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
                ) : step === "review" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
                ) : (
                  <Crosshair className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
                )}
                {hintText}
              </div>
            </div>
          </div>

          {/* Transport strip */}
          <div className="mxStrip flex shrink-0 items-center gap-3.5 border-t border-[var(--border-subtle)] bg-[var(--surface-1)] px-[22px] py-[11px] max-[880px]:flex-wrap max-[880px]:gap-2.5 max-[880px]:px-3.5 max-[880px]:py-2.5">
            <button
              type="button"
              aria-label="Previous frame"
              onClick={() => setFrame((f) => Math.max(0, f - 1))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-strong)]"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Next frame"
              onClick={() => setFrame((f) => Math.min(99, f + 1))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-strong)]"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="font-mono text-xs tabular-nums tracking-wide text-[var(--text-strong)]">
              {timecodeOf(frame)}{" "}
              <span className="text-[var(--text-faint)]">/ 41:20</span>
            </span>
            <div
              ref={trackRef}
              role="slider"
              aria-label="Scrub calibration frame"
              aria-valuemin={0}
              aria-valuemax={99}
              aria-valuenow={frame}
              tabIndex={0}
              title="Drag to scrub — pick a clean calibration frame"
              onPointerDown={onScrubDown}
              onPointerMove={(e) => {
                if (e.buttons === 1) scrubAt(e.clientX);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") setFrame((f) => Math.max(0, f - 1));
                if (e.key === "ArrowRight") setFrame((f) => Math.min(99, f + 1));
              }}
              className="relative flex h-4 flex-1 cursor-pointer touch-none items-center"
            >
              <div className="pointer-events-none relative h-[5px] w-full rounded-full bg-[var(--surface-3)]">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-[var(--brand)] opacity-50"
                  style={{ width: `${frame}%` }}
                />
                <div
                  className="absolute inset-y-[-3px] w-0.5 -translate-x-1/2 rounded-sm bg-[var(--success-500)]"
                  style={{ left: `${calibFrame}%` }}
                />
                <div
                  className="absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_3px_rgba(54,147,255,0.25)]"
                  style={{ left: `${frame}%` }}
                />
              </div>
            </div>

            <div className="inline-flex items-center gap-2.5 max-[880px]:hidden">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px]",
                  isCal ? "text-[var(--success-500)]" : "text-[var(--text-muted)]",
                )}
              >
                {isCal ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <ImageIcon className="h-3.5 w-3.5" />
                )}
                CAL {timecodeOf(calibFrame)}
              </span>
              <button
                type="button"
                onClick={useThisFrame}
                disabled={isCal}
                className={cn(
                  "inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-[12.5px]",
                  isCal
                    ? "cursor-default border-[var(--border)] text-[var(--text-faint)]"
                    : "border-[var(--brand)] bg-[rgba(54,147,255,0.12)] text-[var(--brand-hover,#5ba8ff)] hover:brightness-110",
                )}
              >
                {isCal ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Crosshair className="h-3.5 w-3.5" />
                )}
                {isCal ? "Calibration frame" : "Use this frame"}
              </button>
            </div>

            <button
              type="button"
              onClick={resetStep}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-[12.5px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset step
            </button>
          </div>
        </section>

        {/* Wizard panel */}
        <aside className="mxPanel flex w-[394px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface-1)] max-[880px]:w-full max-[880px]:border-l-0 max-[880px]:border-t max-[880px]:min-h-0 max-[880px]:flex-1">
          {/* Stepper */}
          <div className="shrink-0 border-b border-[var(--border-subtle)] px-5 pb-4 pt-[18px]">
            <div className="flex items-start gap-0.5">
              {STEPS.map((s, i) => {
                const done = i < stepIdx;
                const active = i === stepIdx;
                const reachable = i <= maxStep;
                return (
                  <div
                    key={s.key}
                    className="flex flex-1 flex-col items-center gap-1.5"
                  >
                    <div className="flex w-full items-center">
                      <div
                        className="h-[1.5px] flex-1"
                        style={{
                          background:
                            i === 0
                              ? "transparent"
                              : i <= stepIdx
                                ? PA
                                : "var(--border)",
                        }}
                      />
                      <button
                        type="button"
                        disabled={!reachable}
                        onClick={() => goTo(s.key)}
                        aria-current={active ? "step" : undefined}
                        aria-label={`Step ${i + 1}: ${s.label}`}
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[1.5px] font-mono text-[11.5px] font-semibold",
                          active && "border-[var(--brand)] bg-[var(--brand)] text-white",
                          done &&
                            !active &&
                            "border-[var(--brand)] bg-[rgba(54,147,255,0.16)] text-[var(--brand)]",
                          !active &&
                            !done &&
                            "border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text-muted)]",
                          reachable ? "cursor-pointer" : "cursor-default",
                        )}
                      >
                        {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                      </button>
                      <div
                        className="h-[1.5px] flex-1"
                        style={{
                          background:
                            i === STEPS.length - 1
                              ? "transparent"
                              : i < stepIdx
                                ? PA
                                : "var(--border)",
                        }}
                      />
                    </div>
                    <span
                      className={cn(
                        "whitespace-nowrap text-[10.5px]",
                        active
                          ? "font-semibold text-[var(--text-strong)]"
                          : "text-[var(--text-muted)]",
                      )}
                    >
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Title */}
          <div className="shrink-0 px-5 pb-1 pt-[18px]">
            <h2 className="font-display text-[19px] font-semibold tracking-[-0.015em] text-[var(--text-strong)]">
              {titleMap[step][0]}
            </h2>
            <p className="mt-1.5 text-[13.5px] leading-[1.5] text-[var(--text-secondary)]">
              {titleMap[step][1]}
            </p>
          </div>

          {/* Body */}
          <div className="mxsc min-h-0 flex-1 overflow-y-auto px-5 py-4 pb-[22px]">
            {step === "points" && (
              <div>
                {/* Phase banner */}
                <div className="mb-3.5 flex items-center gap-2">
                  {(
                    [
                      {
                        n: 1,
                        label: "Court corners",
                        count: pointsPhase.corners,
                        total: 4,
                        active: pointsPhase.phase === "corners",
                        done: pointsPhase.corners === 4,
                        dim: false,
                      },
                      {
                        n: 2,
                        label: "Net pole tops",
                        count: pointsPhase.net,
                        total: 2,
                        active: pointsPhase.phase === "net",
                        done: pointsPhase.phase === "done",
                        dim: pointsPhase.phase === "corners",
                      },
                    ] as const
                  ).map((ph, idx) => (
                    <div key={ph.n} className="contents">
                      {idx > 0 ? (
                        <ChevronRight className="h-[15px] w-[15px] shrink-0 text-[var(--text-faint)]" />
                      ) : null}
                      <div
                        className={cn(
                          "flex flex-1 items-center gap-2 rounded-[11px] border px-2.5 py-2",
                          ph.active
                            ? "border-[var(--brand)] bg-[rgba(54,147,255,0.08)]"
                            : "border-[var(--border-subtle)] bg-[var(--surface-2)]",
                          ph.dim && "opacity-50",
                        )}
                      >
                        <span
                          className={cn(
                            "inline-flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-[7px] font-mono text-[11px] font-semibold",
                            ph.done &&
                              "bg-[rgba(45,212,167,0.16)] text-[var(--success-500)]",
                            ph.active && !ph.done && "bg-[var(--brand)] text-white",
                            !ph.active &&
                              !ph.done &&
                              "bg-[var(--surface-3)] text-[var(--text-muted)]",
                          )}
                        >
                          {ph.done ? <Check className="h-3 w-3" /> : ph.n}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div
                            className={cn(
                              "whitespace-nowrap text-[12.5px] font-medium",
                              ph.active || ph.done
                                ? "text-[var(--text-strong)]"
                                : "text-[var(--text-secondary)]",
                            )}
                          >
                            {ph.label}
                          </div>
                          <div
                            className={cn(
                              "font-mono text-[10px] tracking-wide",
                              ph.done
                                ? "text-[var(--success-500)]"
                                : ph.active
                                  ? "text-[var(--brand-hover,#5ba8ff)]"
                                  : "text-[var(--text-muted)]",
                            )}
                          >
                            {ph.count} / {ph.total}
                            {ph.done ? " done" : ""}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Diagram card */}
                <div className="mb-3.5 rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-sunken)] px-3 pb-[11px] pt-3">
                  {armedLm ? (
                    <div className="mb-2.5 flex items-center gap-2.5 rounded-[10px] border border-[var(--brand)] bg-[rgba(54,147,255,0.08)] px-3 py-2.5">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-[var(--brand)] font-mono text-[11px] font-semibold text-white">
                        {armedLm.short}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--brand)]">
                          Next point
                        </div>
                        <div className="text-[13px] font-medium text-[var(--text-strong)]">
                          {armedLm.label}
                        </div>
                      </div>
                      <span className="whitespace-nowrap font-mono text-[10px] text-[var(--text-muted)]">
                        Click on frame
                      </span>
                    </div>
                  ) : (
                    <div className="mb-2.5 flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-[12.5px] text-[var(--text-secondary)]">
                      <MousePointerClick className="h-[15px] w-[15px] shrink-0 text-[var(--text-muted)]" />
                      Pick another point on the diagram to add it
                    </div>
                  )}
                  <CourtSchematic
                    marks={marks}
                    selectedLm={selectedLm}
                    onArm={setSelectedLm}
                  />
                  <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
                    <Scissors className="h-3.5 w-3.5 shrink-0" />
                    <span>Point blocked? Skip it — just pick another.</span>
                  </div>
                </div>

                {/* Quality meter */}
                <div className="my-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3">
                  <div className="mb-2 flex items-baseline gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                      Calibration quality
                    </span>
                    <div className="flex-1" />
                    <span
                      className="font-mono text-[13px] font-semibold"
                      style={{ color: Q.color }}
                    >
                      {Q.label}
                    </span>
                  </div>
                  <div className="relative h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-200 ease-out"
                      style={{
                        width: `${Q.score}%`,
                        background: Q.ready
                          ? "var(--success-500)"
                          : "var(--warning-500)",
                      }}
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-3 font-mono text-[11px] text-[var(--text-muted)]">
                    <span className="text-[var(--text-secondary)]">
                      <span className="font-semibold text-[var(--text-strong)]">
                        {Q.n}
                      </span>{" "}
                      pts
                    </span>
                    <span
                      className={
                        Q.quad >= 4 ? "text-[var(--success-500)]" : undefined
                      }
                    >
                      {Q.quad}/4 zones
                    </span>
                    <div className="flex-1" />
                    {!Q.netReady ? (
                      <span className="text-[var(--warning-500)]">
                        net poles required
                      </span>
                    ) : Q.zonesLeft ? (
                      <span className="text-[var(--warning-500)]">
                        {Q.zonesLeft} zone{Q.zonesLeft === 1 ? "" : "s"} left
                      </span>
                    ) : (
                      <span className="text-[var(--success-500)]">ready</span>
                    )}
                  </div>
                </div>

                {/* Auto-detect */}
                {linesDetected !== true ? (
                  <button
                    type="button"
                    onClick={detectLines}
                    disabled={linesDetected === "scanning"}
                    className="mb-3.5 flex h-10 w-full items-center justify-center gap-2 rounded-[10px] border border-[var(--brand)] bg-[rgba(54,147,255,0.12)] text-[13.5px] font-medium text-[var(--brand-hover,#5ba8ff)] disabled:cursor-default"
                  >
                    {linesDetected === "scanning" ? (
                      <span
                        className="inline-block h-3.5 w-3.5 rounded-full border-2 border-[rgba(91,168,255,0.3)] border-t-[#5ba8ff]"
                        style={{ animation: "mxSpin 0.7s linear infinite" }}
                      />
                    ) : (
                      <ScanLine className="h-4 w-4" />
                    )}
                    {linesDetected === "scanning"
                      ? "Detecting…"
                      : "Auto-detect court lines"}
                  </button>
                ) : null}

                {/* Marked list */}
                {placedIds.length ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="px-0.5 pb-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
                      Marked points · {placedIds.length}
                    </div>
                    {placedIds.map((id) => {
                      const lm = lmById(id);
                      return (
                        <div
                          key={id}
                          className="flex items-center gap-2.5 rounded-[9px] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 py-1.5"
                        >
                          <span
                            className={cn(
                              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-semibold text-[var(--brand)]",
                              lm.zone === "net"
                                ? "bg-[rgba(54,147,255,0.16)]"
                                : "bg-[var(--surface-3)]",
                            )}
                          >
                            {lm.short}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-primary)]">
                            {lm.label}
                          </span>
                          {lm.zone === "net" ? (
                            <span className="font-mono text-[9.5px] tracking-wide text-[var(--text-faint)]">
                              NET
                            </span>
                          ) : null}
                          <button
                            type="button"
                            aria-label={`Remove ${lm.label}`}
                            onClick={() => removeMark(id)}
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] text-[var(--text-muted)] hover:text-[var(--text-strong)]"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-[10px] border border-dashed border-[var(--border)] px-3 py-3.5 text-center text-[12.5px] text-[var(--text-muted)]">
                    No points yet. Tap the diagram, then click the frame.
                  </div>
                )}
              </div>
            )}

            {step === "players" && (
              <div className="flex flex-col gap-3.5">
                {(["a", "b"] as const).map((k) => {
                  const color = k === "a" ? PA : PB;
                  const tag = `Player ${k.toUpperCase()}`;
                  const sub = k === "a" ? "Near court · blue" : "Far court · amber";
                  const stt = players[k];
                  const segmented = stt === "detected";
                  const sel = identify[k].id
                    ? DIR.find((u) => u.id === identify[k].id)
                    : null;
                  const res = results(k);
                  const q = identify[k].q;

                  return (
                    <div
                      key={k}
                      className="overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-2)]"
                    >
                      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2.5">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: color }}
                        />
                        <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
                          {tag}
                        </span>
                        <span className="text-[11.5px] text-[var(--text-muted)]">
                          {sub}
                        </span>
                        <div className="flex-1" />
                        {segmented ? (
                          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--success-500)]">
                            <Check className="h-3.5 w-3.5" />
                            Mask 98%
                          </span>
                        ) : stt === "detecting" ? (
                          <span
                            className="inline-flex items-center gap-1.5 font-mono text-[11px]"
                            style={{ color }}
                          >
                            <span
                              className="inline-block h-[11px] w-[11px] rounded-full border-2 border-white/20"
                              style={{
                                borderTopColor: color,
                                animation: "mxSpin 0.7s linear infinite",
                              }}
                            />
                            Segmenting
                          </span>
                        ) : (
                          <span className="font-mono text-[10.5px] tracking-wide text-[var(--text-faint)]">
                            CLICK ON FRAME
                          </span>
                        )}
                      </div>

                      {!segmented && stt !== "detecting" ? (
                        <div className="flex items-center gap-2.5 px-3 py-3">
                          <ScanSearch
                            className="h-[18px] w-[18px] shrink-0"
                            style={{ color }}
                          />
                          <span className="flex-1 text-[12.5px] leading-[1.45] text-[var(--text-secondary)]">
                            Click {tag} on the frame — SAM masks them in one
                            click.
                          </span>
                        </div>
                      ) : null}

                      {stt === "detecting" ? (
                        <div className="flex items-center gap-2.5 px-3 py-3">
                          <span
                            className="inline-block h-[15px] w-[15px] shrink-0 rounded-full border-2 border-white/20"
                            style={{
                              borderTopColor: color,
                              animation: "mxSpin 0.7s linear infinite",
                            }}
                          />
                          <span className="flex-1 font-mono text-xs text-[var(--text-secondary)]">
                            Segmenting player…
                          </span>
                        </div>
                      ) : null}

                      {segmented ? (
                        <>
                          {sel ? (
                            <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-3 py-3">
                              <Avatar name={sel.name} size="md" ring />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium text-[var(--text-strong)]">
                                  {sel.name}
                                </div>
                                <div className="font-mono text-[11.5px] text-[var(--text-muted)]">
                                  {sel.handle} · {sel.meta}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setIdentify((s) => ({
                                    ...s,
                                    [k]: { q: "", id: null },
                                  }))
                                }
                                className="inline-flex h-[30px] items-center rounded-lg border border-[var(--border)] px-2.5 text-[12.5px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
                              >
                                Change
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-2.5 border-b border-[var(--border-subtle)] px-3 py-3">
                              <Input
                                size="sm"
                                value={q}
                                onChange={(e) =>
                                  setIdentify((s) => ({
                                    ...s,
                                    [k]: { ...s[k], q: e.target.value },
                                  }))
                                }
                                placeholder="Search Mintonix players"
                                aria-label={`Search players for ${tag}`}
                              />
                              {res.length > 0 ? (
                                <div className="flex flex-col gap-0.5">
                                  <div className="px-0.5 pb-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
                                    {q.trim() ? "Matches" : "Suggested"}
                                  </div>
                                  {res.map((u) => (
                                    <button
                                      key={u.id}
                                      type="button"
                                      onClick={() =>
                                        setIdentify((s) => ({
                                          ...s,
                                          [k]: { q: "", id: u.id },
                                        }))
                                      }
                                      className="flex w-full items-center gap-2.5 rounded-[9px] border border-transparent px-2 py-1.5 text-left hover:border-[var(--border)] hover:bg-[var(--surface-hover)]"
                                    >
                                      <Avatar name={u.name} size="sm" />
                                      <div className="min-w-0 flex-1">
                                        <div className="truncate text-[13px] text-[var(--text-strong)]">
                                          {u.name}
                                        </div>
                                        <div className="font-mono text-[11px] text-[var(--text-muted)]">
                                          {u.handle} · {u.meta}
                                        </div>
                                      </div>
                                      <UserRound className="h-[15px] w-[15px] shrink-0 text-[var(--text-secondary)]" />
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <div className="px-1 py-2.5 text-[12.5px] text-[var(--text-muted)]">
                                  No players match &ldquo;{q}&rdquo;.{" "}
                                  <span className="text-[var(--text-secondary)]">
                                    They&apos;ll stay unnamed.
                                  </span>
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setIdentify((s) => ({
                                    ...s,
                                    [k]: { q: "", id: null },
                                  }))
                                }
                                className="inline-flex h-[30px] items-center gap-1.5 self-start rounded-lg border border-dashed border-[var(--border-strong)] px-2.5 text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--text-strong)]"
                              >
                                <UserMinus className="h-3.5 w-3.5" />
                                Leave unnamed
                              </button>
                            </div>
                          )}
                          <div className="flex px-3 py-2.5">
                            <button
                              type="button"
                              onClick={() =>
                                setPlayers((s) => ({ ...s, [k]: "idle" }))
                              }
                              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-xs text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Re-segment
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  );
                })}

                <div className="flex items-start gap-2 rounded-[10px] border border-[rgba(54,147,255,0.2)] bg-[var(--brand-subtle,rgba(54,147,255,0.12))] px-3 py-2.5">
                  <ScanSearch className="mt-px h-[15px] w-[15px] shrink-0 text-[var(--brand)]" />
                  <span className="text-xs leading-[1.5] text-[var(--text-primary)]">
                    One click runs SAM to mask each player, then link a Mintonix
                    profile. Naming is optional — leave a player unnamed and
                    continue.
                  </span>
                </div>
              </div>
            )}

            {step === "review" && (
              <div className="flex flex-col gap-[15px]">
                {/* Review thumb */}
                <div className="relative aspect-video w-full overflow-hidden rounded-[11px] border border-[var(--border)]">
                  <video
                    ref={reviewVidRef}
                    src="/media/clip.mp4"
                    muted
                    playsInline
                    preload="auto"
                    tabIndex={-1}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  <svg
                    viewBox="0 0 1600 900"
                    preserveAspectRatio="none"
                    className="absolute inset-0 h-full w-full"
                  >
                    {Q.n >= 4 ? (
                      <polygon
                        points={activeCorners.map((p) => p.join(",")).join(" ")}
                        fill="rgba(54,147,255,0.12)"
                        stroke={PA}
                        strokeWidth={3}
                      />
                    ) : null}
                    {Q.netReady ? (
                      <line
                        x1={(marks["net-l"] || POLE[0])[0]}
                        y1={(marks["net-l"] || POLE[0])[1]}
                        x2={(marks["net-r"] || POLE[1])[0]}
                        y2={(marks["net-r"] || POLE[1])[1]}
                        stroke={PA}
                        strokeWidth={3}
                        strokeDasharray="8 6"
                      />
                    ) : null}
                    {Object.entries(marks).map(([id, p]) => (
                      <circle
                        key={id}
                        cx={p[0]}
                        cy={p[1]}
                        r={8}
                        fill={PA}
                        stroke="#fff"
                        strokeWidth={2}
                      />
                    ))}
                    {(["a", "b"] as const).map((k) => {
                      const c = k === "a" ? PA : PB;
                      const b = PBOX[k];
                      return (
                        <rect
                          key={k}
                          x={b.x}
                          y={b.y}
                          width={b.w}
                          height={b.h}
                          rx={8}
                          fill={c}
                          fillOpacity={0.14}
                          stroke={c}
                          strokeWidth={3}
                        />
                      );
                    })}
                  </svg>
                  <div className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1.5 rounded-[7px] bg-[rgba(7,8,9,0.78)] px-2 py-1 font-mono text-[11px] text-[var(--success-500)]">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Court rectified
                  </div>
                </div>

                <div className="overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-2)]">
                  {(
                    [
                      {
                        icon: Crosshair,
                        label: "Reference points",
                        value: `${Q.n} marked`,
                        ok: true,
                      },
                      {
                        icon: Minus,
                        label: "Net plane",
                        value: Q.netReady ? "Posts marked" : "Inferred",
                        ok: Q.netReady,
                      },
                      {
                        icon: Gauge,
                        label: "Fit quality",
                        value: `${Q.label} · ${Q.err}px`,
                        qcolor: Q.color,
                      },
                      {
                        icon: User,
                        label: "Player A",
                        value:
                          DIR.find((u) => u.id === identify.a.id)?.name ||
                          "Unnamed",
                        color: PA,
                      },
                      {
                        icon: User,
                        label: "Player B",
                        value:
                          DIR.find((u) => u.id === identify.b.id)?.name ||
                          "Unnamed",
                        color: PB,
                      },
                      {
                        icon: Film,
                        label: "Calibration frame",
                        value: timecodeOf(calibFrame),
                      },
                    ] as const
                  ).map((r) => {
                    const Icon = r.icon;
                    const iconBg =
                      "color" in r && r.color
                        ? r.color === PB
                          ? "rgba(251,191,36,0.14)"
                          : "rgba(54,147,255,0.14)"
                        : "ok" in r && r.ok
                          ? "var(--success-bg,rgba(45,212,167,0.12))"
                          : "var(--surface-3)";
                    const iconColor =
                      "color" in r && r.color
                        ? r.color
                        : "ok" in r && r.ok
                          ? "var(--success-500)"
                          : "var(--text-secondary)";
                    const valueColor =
                      "qcolor" in r && r.qcolor
                        ? r.qcolor
                        : "color" in r && r.color
                          ? r.color
                          : "var(--text-strong)";
                    return (
                      <div
                        key={r.label}
                        className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-3.5 py-3 last:border-b-0"
                      >
                        <span
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                          style={{ background: iconBg, color: iconColor }}
                        >
                          <Icon className="h-[15px] w-[15px]" />
                        </span>
                        <span className="flex-1 text-[13px] text-[var(--text-secondary)]">
                          {r.label}
                        </span>
                        <span
                          className="text-right font-mono text-[12.5px] tabular-nums"
                          style={{ color: valueColor }}
                        >
                          {r.value}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-start gap-2 rounded-[11px] border border-[rgba(54,147,255,0.2)] bg-[var(--brand-subtle,rgba(54,147,255,0.12))] px-3 py-3">
                  <Sparkles className="mt-px h-[15px] w-[15px] shrink-0 text-[var(--brand)]" />
                  <span className="text-[12.5px] leading-[1.5] text-[var(--text-primary)]">
                    Mintonix will rectify the court from your reference points,
                    track the shuttle, and break the match into rallies. This
                    usually takes a few minutes.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center gap-2.5 border-t border-[var(--border)] px-[18px] py-3">
            <Button variant="ghost" size="md" disabled={stepIdx === 0} onClick={onBack}>
              Back
            </Button>
            <div className="flex-1" />
            <Button
              variant="primary"
              size="md"
              disabled={step === "review" ? starting : !stepComplete}
              onClick={onPrimary}
            >
              {step === "review"
                ? starting
                  ? "Queuing analysis…"
                  : "Start analysis"
                : "Continue"}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
