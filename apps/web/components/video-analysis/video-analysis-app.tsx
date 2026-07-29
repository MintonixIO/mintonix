"use client";

import { useMemo, useState } from "react";
import { AnalysisHeader } from "@/components/video-analysis/analysis-header";
import { AnalysisPlayer } from "@/components/video-analysis/analysis-player";
import { RallyPanel } from "@/components/video-analysis/rally-panel";
import { ScopeStats } from "@/components/video-analysis/scope-stats";
import { useVideoTransport } from "@/lib/media/use-video-transport";
import { RALLIES } from "@/lib/video-analysis/rallies";
import {
  type AnalysisScope,
  rallyLengthBuckets,
  shotTypeMix,
} from "@/lib/video-analysis/stats";

export function VideoAnalysisApp() {
  const {
    videoRef,
    playing,
    muted,
    speed,
    togglePlay,
    toggleMute,
    setSpeed,
  } = useVideoTransport();
  const [expanded, setExpanded] = useState(7);
  const [scope, setScope] = useState<AnalysisScope>("rally");
  const [shotIdx, setShotIdx] = useState(0);
  const [shared, setShared] = useState(false);

  const active = useMemo(
    () => RALLIES.find((r) => r.n === expanded) ?? RALLIES[6],
    [expanded],
  );
  const activeShot = active.sequence[shotIdx] ?? active.sequence[0];
  const pace = (active.dur / active.shots).toFixed(1);

  const typeMix = useMemo(() => shotTypeMix(RALLIES), []);
  const lengthBuckets = useMemo(() => rallyLengthBuckets(RALLIES), []);
  const allShotCount = useMemo(
    () => RALLIES.reduce((n, r) => n + r.sequence.length, 0),
    [],
  );

  const shareLabel =
    scope === "shot"
      ? "Share shot"
      : scope === "rally"
        ? "Share rally"
        : "Share match";

  const onShare = () => {
    setShared(true);
    try {
      void navigator.clipboard?.writeText(window.location.href);
    } catch {
      /* ignore */
    }
    setTimeout(() => setShared(false), 1800);
  };

  const onScopeChange = (v: AnalysisScope) => {
    setScope(v);
    if (v === "shot" && shotIdx < 0) setShotIdx(0);
  };

  const goPrevRally = () => {
    setExpanded((n) => Math.max(1, n - 1));
    setShotIdx(0);
    setScope("rally");
  };
  const goNextRally = () => {
    setExpanded((n) => Math.min(RALLIES.length, n + 1));
    setShotIdx(0);
    setScope("rally");
  };

  const onSelectRally = (n: number) => {
    setExpanded(n);
    setShotIdx(0);
    setScope("rally");
  };

  const onSelectShot = (idx: number) => {
    setShotIdx(idx);
    setScope("shot");
  };

  return (
    <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      <AnalysisHeader />

      <div className="mx-auto flex max-w-[1480px] flex-col gap-[18px] px-6 py-[22px] pb-10">
        <div className="grid items-stretch gap-[18px] lg:grid-cols-[minmax(0,1.7fr)_minmax(372px,1fr)]">
          <AnalysisPlayer
            videoRef={videoRef}
            playing={playing}
            muted={muted}
            speed={speed}
            togglePlay={togglePlay}
            toggleMute={toggleMute}
            setSpeed={setSpeed}
          />
          <RallyPanel
            expanded={expanded}
            shotIdx={shotIdx}
            scope={scope}
            onSelectRally={onSelectRally}
            onSelectShot={onSelectShot}
          />
        </div>

        <ScopeStats
          scope={scope}
          onScopeChange={onScopeChange}
          active={active}
          activeShot={activeShot}
          shotIdx={shotIdx}
          setShotIdx={setShotIdx}
          allShotCount={allShotCount}
          pace={pace}
          typeMix={typeMix}
          lengthBuckets={lengthBuckets}
          shared={shared}
          shareLabel={shareLabel}
          onShare={onShare}
          goPrevRally={goPrevRally}
          goNextRally={goNextRally}
          playing={playing}
          togglePlay={togglePlay}
        />
      </div>
    </div>
  );
}
