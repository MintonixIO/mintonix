"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
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
  type Landmark,
  type Marks,
  type PlayerState,
  type StepKey,
} from "@/lib/calibration/geometry";
import { DIR, STEPS } from "@/lib/calibration/constants";

/* ─── Storage helpers ─── */

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

/* ─── State & actions ─── */

export type Cursor = {
  nx: number;
  ny: number;
  x: number;
  y: number;
} | null;

export type CanvasRect = {
  w: number;
  h: number;
  left: number;
  top: number;
};

export type IdentifyState = Record<"a" | "b", { q: string; id: string | null }>;
export type PlayersMap = Record<"a" | "b", PlayerState>;
export type Quality = ReturnType<typeof computeQuality>;

export type Loupe = {
  lx: number;
  ly: number;
  S: number;
  ox: number;
  oy: number;
  innerW: number;
  innerH: number;
} | null;

export type CalibrationState = {
  step: StepKey;
  maxStep: number;
  marks: Marks;
  selectedLm: string | null;
  linesDetected: false | "scanning" | true;
  players: PlayersMap;
  identify: IdentifyState;
  frame: number;
  calibFrame: number;
  starting: boolean;
  vidReady: boolean;
  vidErr: boolean;
  cursor: Cursor;
  canvasRect: CanvasRect;
  draggingId: string | null;
  filename: string;
  skipClick: boolean;
};

export type CalibrationAction =
  | { type: "SET_STEP"; step: StepKey }
  | { type: "SET_MAX_STEP"; maxStep: number }
  | { type: "GO_TO"; step: StepKey }
  | { type: "BACK" }
  | { type: "ADVANCE" }
  | { type: "SET_STARTING"; starting: boolean }
  | { type: "PLACE_MARK"; id: string; pt: [number, number] }
  | { type: "REMOVE_MARK"; id: string }
  | { type: "MOVE_MARK"; id: string; pt: [number, number] }
  | { type: "SET_SELECTED_LM"; id: string | null }
  | { type: "SET_LINES_DETECTED"; value: false | "scanning" | true }
  | { type: "AUTO_DETECT_COMPLETE"; marks: Marks }
  | { type: "SET_PLAYER"; key: "a" | "b"; state: PlayerState }
  | { type: "RESET_IDENTIFY_KEY"; key: "a" | "b" }
  | { type: "SET_IDENTIFY_Q"; key: "a" | "b"; q: string }
  | { type: "SET_IDENTIFY_ID"; key: "a" | "b"; id: string | null }
  | { type: "SET_FRAME"; frame: number }
  | { type: "NUDGE_FRAME"; delta: number }
  | { type: "USE_THIS_FRAME" }
  | { type: "SET_VID_READY"; ready: boolean }
  | { type: "SET_VID_ERR"; err: boolean }
  | { type: "SET_CURSOR"; cursor: Cursor }
  | { type: "SET_CANVAS_RECT"; rect: CanvasRect }
  | { type: "SET_DRAGGING"; id: string | null }
  | { type: "SET_SKIP_CLICK"; skip: boolean }
  | { type: "RESET_POINTS" }
  | { type: "RESET_PLAYERS" };

function createInitialState(): CalibrationState {
  const frame = readStoredFrame();
  return {
    step: "points",
    maxStep: 0,
    marks: {},
    selectedLm: "c-fl",
    linesDetected: false,
    players: { a: "idle", b: "idle" },
    identify: { a: { q: "", id: null }, b: { q: "", id: null } },
    frame,
    calibFrame: frame,
    starting: false,
    vidReady: false,
    vidErr: false,
    cursor: null,
    canvasRect: { w: 0, h: 0, left: 0, top: 0 },
    draggingId: null,
    filename: readStoredFilename(),
    skipClick: false,
  };
}

export function calibrationReducer(
  state: CalibrationState,
  action: CalibrationAction,
): CalibrationState {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, step: action.step };
    case "SET_MAX_STEP":
      return { ...state, maxStep: action.maxStep };
    case "GO_TO": {
      const idx = STEPS.findIndex((s) => s.key === action.step);
      if (idx <= state.maxStep) return { ...state, step: action.step };
      return state;
    }
    case "BACK": {
      const stepIdx = STEPS.findIndex((s) => s.key === state.step);
      if (stepIdx > 0) return { ...state, step: STEPS[stepIdx - 1].key };
      return state;
    }
    case "ADVANCE": {
      const stepIdx = STEPS.findIndex((s) => s.key === state.step);
      const ni = Math.min(STEPS.length - 1, stepIdx + 1);
      const nextKey = STEPS[ni].key;
      return {
        ...state,
        step: nextKey,
        maxStep: Math.max(state.maxStep, ni),
        frame: nextKey !== "points" ? state.calibFrame : state.frame,
      };
    }
    case "SET_STARTING":
      return { ...state, starting: action.starting };
    case "PLACE_MARK": {
      const next = { ...state.marks, [action.id]: action.pt };
      return {
        ...state,
        marks: next,
        selectedLm: nextUnplaced(next, action.id),
      };
    }
    case "REMOVE_MARK": {
      const next = { ...state.marks };
      delete next[action.id];
      return {
        ...state,
        marks: next,
        selectedLm: state.selectedLm || action.id,
      };
    }
    case "MOVE_MARK":
      return {
        ...state,
        marks: { ...state.marks, [action.id]: action.pt },
      };
    case "SET_SELECTED_LM":
      return { ...state, selectedLm: action.id };
    case "SET_LINES_DETECTED":
      return { ...state, linesDetected: action.value };
    case "AUTO_DETECT_COMPLETE":
      return {
        ...state,
        marks: action.marks,
        selectedLm: null,
        linesDetected: true,
      };
    case "SET_PLAYER":
      return {
        ...state,
        players: { ...state.players, [action.key]: action.state },
      };
    case "RESET_IDENTIFY_KEY":
      return {
        ...state,
        identify: {
          ...state.identify,
          [action.key]: { q: "", id: null },
        },
      };
    case "SET_IDENTIFY_Q":
      return {
        ...state,
        identify: {
          ...state.identify,
          [action.key]: { ...state.identify[action.key], q: action.q },
        },
      };
    case "SET_IDENTIFY_ID":
      return {
        ...state,
        identify: {
          ...state.identify,
          [action.key]: { q: "", id: action.id },
        },
      };
    case "SET_FRAME":
      return {
        ...state,
        frame: Math.max(0, Math.min(99, action.frame)),
      };
    case "NUDGE_FRAME":
      return {
        ...state,
        frame: Math.max(0, Math.min(99, state.frame + action.delta)),
      };
    case "USE_THIS_FRAME":
      return { ...state, calibFrame: state.frame };
    case "SET_VID_READY":
      return { ...state, vidReady: action.ready };
    case "SET_VID_ERR":
      return { ...state, vidErr: action.err };
    case "SET_CURSOR":
      return { ...state, cursor: action.cursor };
    case "SET_CANVAS_RECT":
      return { ...state, canvasRect: action.rect };
    case "SET_DRAGGING":
      return { ...state, draggingId: action.id };
    case "SET_SKIP_CLICK":
      return { ...state, skipClick: action.skip };
    case "RESET_POINTS":
      return {
        ...state,
        marks: {},
        selectedLm: "c-fl",
        linesDetected: false,
      };
    case "RESET_PLAYERS":
      return {
        ...state,
        players: { a: "idle", b: "idle" },
        identify: { a: { q: "", id: null }, b: { q: "", id: null } },
      };
    default:
      return state;
  }
}

/* ─── Derived selectors (pure) ─── */

export function selectStepIdx(step: StepKey) {
  return STEPS.findIndex((s) => s.key === step);
}

export function selectQuality(marks: Marks) {
  return computeQuality(marks);
}

export function selectActiveCorners(marks: Marks): [number, number][] {
  const ids = ["c-fl", "c-fr", "c-nr", "c-nl"] as const;
  if (ids.every((id) => marks[id])) return ids.map((id) => marks[id]);
  return C_DEFAULT;
}

export function selectPointsPhase(marks: Marks) {
  const corners = ["c-fl", "c-fr", "c-nr", "c-nl"].filter((id) => marks[id])
    .length;
  const net = (marks["net-l"] ? 1 : 0) + (marks["net-r"] ? 1 : 0);
  const phase = corners < 4 ? "corners" : net < 2 ? "net" : "done";
  return { corners, net, phase };
}

export function selectPlayersDone(players: PlayersMap) {
  return players.a === "detected" && players.b === "detected";
}

export function selectStepComplete(
  step: StepKey,
  marks: Marks,
  players: PlayersMap,
) {
  if (step === "points") return computeQuality(marks).ready;
  if (step === "players") return selectPlayersDone(players);
  return true;
}

export function selectGridPaths(activeCorners: [number, number][]) {
  const B = (u: number, v: number) => bilinear(activeCorners, u, v);
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
}

export function selectLoupe(
  cursor: Cursor,
  step: StepKey,
  canvasRect: CanvasRect,
): Loupe {
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
}

export function selectHintText(
  step: StepKey,
  selectedLm: string | null,
  Q: Quality,
  playersDone: boolean,
) {
  if (step === "points") {
    if (selectedLm) return `Click ${lmById(selectedLm).label}`;
    return Q.ready
      ? "Court fit · drag any point to refine, or pick more on the diagram"
      : "Pick a point on the court diagram to mark";
  }
  if (step === "players") {
    return playersDone
      ? "Both players segmented · link profiles in the panel →"
      : "Click a player — SAM segments them automatically";
  }
  return "Calibration complete";
}

export const TITLE_MAP = {
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

/* ─── Context value ─── */

export type CalibrationRefs = {
  canvasRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  loupeVidRef: RefObject<HTMLVideoElement | null>;
  reviewVidRef: RefObject<HTMLVideoElement | null>;
  trackRef: RefObject<HTMLDivElement | null>;
};

export type CalibrationActions = {
  dispatch: Dispatch<CalibrationAction>;
  setSelectedLm: (id: string | null) => void;
  setPlayer: (key: "a" | "b", state: PlayerState) => void;
  resetIdentifyKey: (key: "a" | "b") => void;
  setIdentifyQ: (key: "a" | "b", q: string) => void;
  setIdentifyId: (key: "a" | "b", id: string | null) => void;
  setFrame: (frame: number) => void;
  nudgeFrame: (delta: number) => void;
  setVidReady: (ready: boolean) => void;
  setVidErr: (err: boolean) => void;
  setCursor: (cursor: Cursor) => void;
  placeMark: (id: string, pt: [number, number]) => void;
  removeMark: (id: string) => void;
  detectPlayer: (k: "a" | "b") => void;
  detectLines: () => void;
  onCanvasPointerMove: (e: ReactPointerEvent) => void;
  onMarkerPointerDown: (id: string, e: ReactPointerEvent) => void;
  onMarkerPointerMove: (id: string, e: ReactPointerEvent) => void;
  onMarkerPointerUp: (id: string) => void;
  onCanvasClick: (e: ReactMouseEvent) => void;
  scrubAt: (cx: number) => void;
  onScrubDown: (e: ReactPointerEvent) => void;
  goTo: (key: StepKey) => void;
  onBack: () => void;
  onPrimary: () => void;
  resetStep: () => void;
  useThisFrame: () => void;
  results: (k: "a" | "b") => typeof DIR;
};

export type CalibrationDerived = {
  stepIdx: number;
  Q: Quality;
  activeCorners: [number, number][];
  pointsPhase: { corners: number; net: number; phase: string };
  stepComplete: boolean;
  playersDone: boolean;
  gridPaths: string;
  loupe: Loupe;
  hintText: string;
  isCal: boolean;
  armedLm: Landmark | null;
  placedIds: string[];
  showFit: boolean;
};

type CalibrationContextValue = {
  state: CalibrationState;
  refs: CalibrationRefs;
  actions: CalibrationActions;
  derived: CalibrationDerived;
};

const CalibrationContext = createContext<CalibrationContextValue | null>(null);

/* ─── Provider ─── */

export function CalibrationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(
    calibrationReducer,
    undefined,
    createInitialState,
  );

  const canvasRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const loupeVidRef = useRef<HTMLVideoElement>(null);
  const reviewVidRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Keep latest state for event handlers without re-binding every render
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refs = useMemo<CalibrationRefs>(
    () => ({ canvasRef, videoRef, loupeVidRef, reviewVidRef, trackRef }),
    [],
  );

  /* Effects */

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      dispatch({
        type: "SET_CANVAS_RECT",
        rect: { w: r.width, h: r.height, left: r.left, top: r.top },
      });
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
    const t = (state.frame / 99) * (videoRef.current?.duration || 24);
    vids.forEach((v) => {
      try {
        v.currentTime = t;
      } catch {
        /* ignore */
      }
    });
  }, [state.frame, state.vidReady]);

  useEffect(() => {
    const v = reviewVidRef.current;
    if (!v) return;
    try {
      v.currentTime = (state.calibFrame / 99) * (v.duration || 24);
    } catch {
      /* ignore */
    }
  }, [state.calibFrame, state.step]);

  useEffect(() => {
    const bag = timers;
    return () => {
      bag.current.forEach(clearTimeout);
    };
  }, []);

  /* Derived */

  const derived = useMemo<CalibrationDerived>(() => {
    const stepIdx = selectStepIdx(state.step);
    const Q = selectQuality(state.marks);
    const activeCorners = selectActiveCorners(state.marks);
    const pointsPhase = selectPointsPhase(state.marks);
    const playersDone = selectPlayersDone(state.players);
    const stepComplete = selectStepComplete(
      state.step,
      state.marks,
      state.players,
    );
    const gridPaths = selectGridPaths(activeCorners);
    const loupe = selectLoupe(state.cursor, state.step, state.canvasRect);
    const hintText = selectHintText(
      state.step,
      state.selectedLm,
      Q,
      playersDone,
    );
    const isCal = state.frame === state.calibFrame;
    const armedLm = state.selectedLm ? lmById(state.selectedLm) : null;
    const placedIds = LANDMARKS.filter((l) => state.marks[l.id]).map(
      (l) => l.id,
    );
    const showFit =
      (state.step === "points" && Q.n >= 4) ||
      state.step === "players" ||
      state.step === "review";

    return {
      stepIdx,
      Q,
      activeCorners,
      pointsPhase,
      stepComplete,
      playersDone,
      gridPaths,
      loupe,
      hintText,
      isCal,
      armedLm,
      placedIds,
      showFit,
    };
  }, [state]);

  /* Actions */

  const evtClient = useCallback((cx: number, cy: number) => {
    const { w, h, left, top } = stateRef.current.canvasRect;
    if (!w || !h) return { x: 0, y: 0, nx: 0, ny: 0 };
    const nx = Math.max(0, Math.min(1, (cx - left) / w));
    const ny = Math.max(0, Math.min(1, (cy - top) / h));
    return { x: nx * 1600, y: ny * 900, nx, ny };
  }, []);

  const placeMark = useCallback((id: string, pt: [number, number]) => {
    dispatch({ type: "PLACE_MARK", id, pt });
  }, []);

  const removeMark = useCallback((id: string) => {
    dispatch({ type: "REMOVE_MARK", id });
  }, []);

  const detectPlayer = useCallback((k: "a" | "b") => {
    dispatch({ type: "SET_PLAYER", key: k, state: "detecting" });
    const t = setTimeout(() => {
      dispatch({ type: "SET_PLAYER", key: k, state: "detected" });
    }, 820);
    timers.current.push(t);
  }, []);

  const detectLines = useCallback(() => {
    if (stateRef.current.linesDetected === "scanning") return;
    dispatch({ type: "SET_LINES_DETECTED", value: "scanning" });
    const t = setTimeout(() => {
      const next: Marks = {};
      AUTO_IDS.forEach((id) => {
        next[id] = truthOf(lmById(id), C_DEFAULT);
      });
      dispatch({ type: "AUTO_DETECT_COMPLETE", marks: next });
    }, 1000);
    timers.current.push(t);
  }, []);

  const onCanvasPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const p = evtClient(e.clientX, e.clientY);
      dispatch({ type: "SET_CURSOR", cursor: p });
    },
    [evtClient],
  );

  const onMarkerPointerDown = useCallback(
    (id: string, e: ReactPointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      dispatch({ type: "SET_DRAGGING", id });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const onMarkerPointerMove = useCallback(
    (id: string, e: ReactPointerEvent) => {
      if (stateRef.current.draggingId !== id) return;
      const p = evtClient(e.clientX, e.clientY);
      dispatch({ type: "MOVE_MARK", id, pt: [p.x, p.y] });
      dispatch({ type: "SET_CURSOR", cursor: p });
    },
    [evtClient],
  );

  const onMarkerPointerUp = useCallback((id: string) => {
    if (stateRef.current.draggingId !== id) return;
    dispatch({ type: "SET_SKIP_CLICK", skip: true });
    dispatch({ type: "SET_DRAGGING", id: null });
    setTimeout(() => dispatch({ type: "SET_SKIP_CLICK", skip: false }), 0);
  }, []);

  const onCanvasClick = useCallback(
    (e: ReactMouseEvent) => {
      const s = stateRef.current;
      if (s.skipClick || s.draggingId) return;
      const p = evtClient(e.clientX, e.clientY);
      if (s.step === "points") {
        if (!s.selectedLm) return;
        placeMark(s.selectedLm, [p.x, p.y]);
      } else if (s.step === "players") {
        const k =
          s.players.a !== "detected"
            ? "a"
            : s.players.b !== "detected"
              ? "b"
              : null;
        if (!k || s.players[k] === "detecting") return;
        detectPlayer(k);
      }
    },
    [evtClient, placeMark, detectPlayer],
  );

  const scrubAt = useCallback((cx: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r?.width) return;
    const f = Math.max(
      0,
      Math.min(99, Math.round(((cx - r.left) / r.width) * 100)),
    );
    dispatch({ type: "SET_FRAME", frame: f });
  }, []);

  const onScrubDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      scrubAt(e.clientX);
    },
    [scrubAt],
  );

  const goTo = useCallback((key: StepKey) => {
    dispatch({ type: "GO_TO", step: key });
  }, []);

  const onBack = useCallback(() => {
    dispatch({ type: "BACK" });
  }, []);

  const onPrimary = useCallback(() => {
    const s = stateRef.current;
    if (s.step === "review") {
      dispatch({ type: "SET_STARTING", starting: true });
      const t = setTimeout(() => {
        router.push("/video-analysis");
      }, 1100);
      timers.current.push(t);
      return;
    }
    const complete = selectStepComplete(s.step, s.marks, s.players);
    if (!complete) return;
    dispatch({ type: "ADVANCE" });
  }, [router]);

  const resetStep = useCallback(() => {
    const s = stateRef.current;
    if (s.step === "points") dispatch({ type: "RESET_POINTS" });
    else if (s.step === "players") dispatch({ type: "RESET_PLAYERS" });
  }, []);

  const useThisFrame = useCallback(() => {
    const f = stateRef.current.frame;
    dispatch({ type: "USE_THIS_FRAME" });
    try {
      sessionStorage.setItem("mx_calib_frame", String(f));
    } catch {
      /* ignore */
    }
  }, []);

  const results = useCallback((k: "a" | "b") => {
    const identify = stateRef.current.identify;
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
  }, []);

  const actions = useMemo<CalibrationActions>(
    () => ({
      dispatch,
      setSelectedLm: (id) => dispatch({ type: "SET_SELECTED_LM", id }),
      setPlayer: (key, playerState) =>
        dispatch({ type: "SET_PLAYER", key, state: playerState }),
      resetIdentifyKey: (key) => dispatch({ type: "RESET_IDENTIFY_KEY", key }),
      setIdentifyQ: (key, q) => dispatch({ type: "SET_IDENTIFY_Q", key, q }),
      setIdentifyId: (key, id) => dispatch({ type: "SET_IDENTIFY_ID", key, id }),
      setFrame: (frame) => dispatch({ type: "SET_FRAME", frame }),
      nudgeFrame: (delta) => dispatch({ type: "NUDGE_FRAME", delta }),
      setVidReady: (ready) => dispatch({ type: "SET_VID_READY", ready }),
      setVidErr: (err) => dispatch({ type: "SET_VID_ERR", err }),
      setCursor: (cursor) => dispatch({ type: "SET_CURSOR", cursor }),
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
    }),
    [
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
    ],
  );

  const value = useMemo<CalibrationContextValue>(
    () => ({ state, refs, actions, derived }),
    [state, refs, actions, derived],
  );

  return (
    <CalibrationContext.Provider value={value}>
      {children}
    </CalibrationContext.Provider>
  );
}

/* ─── Hooks ─── */

function useCalibrationContext() {
  const ctx = useContext(CalibrationContext);
  if (!ctx) {
    throw new Error(
      "Calibration hooks must be used within <CalibrationProvider>",
    );
  }
  return ctx;
}

/** Full context value — prefer sliced hooks when practical. */
export function useCalibration() {
  return useCalibrationContext();
}

export function useCalibrationStateSlice() {
  return useCalibrationContext().state;
}

export function useCalibrationStep() {
  const { state, derived, actions } = useCalibrationContext();
  return {
    step: state.step,
    maxStep: state.maxStep,
    stepIdx: derived.stepIdx,
    stepComplete: derived.stepComplete,
    starting: state.starting,
    filename: state.filename,
    goTo: actions.goTo,
    onBack: actions.onBack,
    onPrimary: actions.onPrimary,
    resetStep: actions.resetStep,
  };
}

export function useMarks() {
  const { state, derived, actions } = useCalibrationContext();
  return {
    marks: state.marks,
    selectedLm: state.selectedLm,
    linesDetected: state.linesDetected,
    draggingId: state.draggingId,
    Q: derived.Q,
    activeCorners: derived.activeCorners,
    pointsPhase: derived.pointsPhase,
    armedLm: derived.armedLm,
    placedIds: derived.placedIds,
    gridPaths: derived.gridPaths,
    showFit: derived.showFit,
    setSelectedLm: actions.setSelectedLm,
    placeMark: actions.placeMark,
    removeMark: actions.removeMark,
    detectLines: actions.detectLines,
    onMarkerPointerDown: actions.onMarkerPointerDown,
    onMarkerPointerMove: actions.onMarkerPointerMove,
    onMarkerPointerUp: actions.onMarkerPointerUp,
  };
}

export function usePlayers() {
  const { state, derived, actions } = useCalibrationContext();
  return {
    players: state.players,
    identify: state.identify,
    playersDone: derived.playersDone,
    setPlayer: actions.setPlayer,
    resetIdentifyKey: actions.resetIdentifyKey,
    setIdentifyQ: actions.setIdentifyQ,
    setIdentifyId: actions.setIdentifyId,
    detectPlayer: actions.detectPlayer,
    results: actions.results,
  };
}

export function useTransport() {
  const { state, derived, actions, refs } = useCalibrationContext();
  return {
    trackRef: refs.trackRef,
    frame: state.frame,
    calibFrame: state.calibFrame,
    isCal: derived.isCal,
    setFrame: actions.setFrame,
    nudgeFrame: actions.nudgeFrame,
    scrubAt: actions.scrubAt,
    onScrubDown: actions.onScrubDown,
    useThisFrame: actions.useThisFrame,
    resetStep: actions.resetStep,
  };
}

export function useTransportRefs() {
  return useCalibrationContext().refs;
}

export function useCanvas() {
  const { state, derived, actions, refs } = useCalibrationContext();
  return {
    canvasRef: refs.canvasRef,
    videoRef: refs.videoRef,
    loupeVidRef: refs.loupeVidRef,
    step: state.step,
    selectedLm: state.selectedLm,
    marks: state.marks,
    players: state.players,
    linesDetected: state.linesDetected,
    draggingId: state.draggingId,
    vidReady: state.vidReady,
    vidErr: state.vidErr,
    cursor: state.cursor,
    loupe: derived.loupe,
    Q: derived.Q,
    activeCorners: derived.activeCorners,
    gridPaths: derived.gridPaths,
    showFit: derived.showFit,
    hintText: derived.hintText,
    onCanvasPointerMove: actions.onCanvasPointerMove,
    onCanvasClick: actions.onCanvasClick,
    setCursor: actions.setCursor,
    setVidReady: actions.setVidReady,
    setVidErr: actions.setVidErr,
    onMarkerPointerDown: actions.onMarkerPointerDown,
    onMarkerPointerMove: actions.onMarkerPointerMove,
    onMarkerPointerUp: actions.onMarkerPointerUp,
  };
}

export function useReview() {
  const { state, derived, refs } = useCalibrationContext();
  return {
    reviewVidRef: refs.reviewVidRef,
    marks: state.marks,
    Q: derived.Q,
    activeCorners: derived.activeCorners,
    identify: state.identify,
    calibFrame: state.calibFrame,
  };
}
