"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ReplayRallyPanel } from "@/components/replay/replay-rally-panel";
import { ReplayTransport } from "@/components/replay/replay-transport";
import { ReplayViewport } from "@/components/replay/replay-viewport";
import { PRESETS, SHOTS } from "@/lib/replay/data";

export function ReplayApp() {
  const [preset, setPreset] = useState<string>("broadcast");
  const [az, setAz] = useState(0);
  const [el, setEl] = useState(52);
  const [zoom, setZoom] = useState(0.95);
  const [playing, setPlaying] = useState(false);
  const [shot, setShot] = useState(4);
  const [rally, setRally] = useState(86);

  const applyPreset = useCallback((id: string) => {
    const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
    setPreset(id);
    setAz(p.az);
    setEl(p.el);
    setZoom(p.zoom);
  }, []);

  const rot = useMemo(
    () => `rotateX(${el}deg) rotateZ(${az}deg)`,
    [az, el],
  );

  // Auto-advance shots when playing (CSS 3D timeline — not a <video>)
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setShot((s) => {
        if (s >= SHOTS.length) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, 900);
    return () => clearInterval(id);
  }, [playing]);

  const viewLabel =
    PRESETS.find((p) => p.id === preset)?.label ?? "Free camera";
  const scoreA = 20;
  const scoreB = 17;

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex min-h-[62px] items-center gap-3.5 border-b border-[var(--border-subtle)] bg-[rgba(10,16,32,0.78)] px-5 py-2.5">
          <Link
            href="/dashboard/library"
            aria-label="Back to library"
            className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-strong)]"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-2 font-mono text-xs text-[var(--text-muted)]"
          >
            <span>Library</span>
            <span className="text-[var(--text-faint)]">/</span>
            <span>Axelsen vs Momota</span>
            <span className="text-[var(--text-faint)]">/</span>
            <span className="text-[var(--text-strong)]">Replay</span>
          </nav>
          <div className="flex-1" />
          <div className="flex items-center gap-2.5 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5">
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--text-secondary)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--player-a)]" />
              Axelsen
            </span>
            <span className="font-mono text-[13px] tabular-nums text-[var(--text-strong)]">
              {scoreA} — {scoreB}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--text-secondary)]">
              Momota
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--player-b)]" />
            </span>
            <span className="font-mono text-[10.5px] tracking-widest text-[var(--text-faint)]">
              G3
            </span>
          </div>
          <Button variant="outline" size="sm">
            Export clip
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 gap-4 p-4 pb-5">
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[linear-gradient(160deg,#0c1426,#070d1a)] shadow-[var(--shadow-lg),0_0_0_1px_rgba(80,222,255,0.06)]">
            <ReplayViewport
              preset={preset}
              az={az}
              el={el}
              zoom={zoom}
              rot={rot}
              viewLabel={viewLabel}
              onOrbit={(nextAz, nextEl) => {
                setAz(nextAz);
                setEl(nextEl);
              }}
              onZoom={(deltaY) =>
                setZoom((z) => Math.max(0.55, Math.min(1.9, z - deltaY * 0.001)))
              }
              onPreset={applyPreset}
              onCustom={() => setPreset("custom")}
            />
            <ReplayTransport
              shot={shot}
              setShot={setShot}
              playing={playing}
              togglePlay={() => setPlaying((v) => !v)}
            />
          </section>

          <ReplayRallyPanel
            rally={rally}
            setRally={setRally}
            shot={shot}
            setShot={setShot}
            scoreA={scoreA}
            scoreB={scoreB}
          />
        </div>
      </div>
    </div>
  );
}
