"use client";

import { useState } from "react";
import { AppTopbar } from "@/components/app/app-topbar";
import { MatchChipStrip } from "@/components/analysis/match-chip-strip";
import { PlacementPanel } from "@/components/analysis/placement-panel";
import { PatternsPanel } from "@/components/analysis/patterns-panel";
import { PointsEndPanel } from "@/components/analysis/points-end-panel";
import { SituationsPanel } from "@/components/analysis/situations-panel";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";

export function AnalysisApp() {
  const [range, setRange] = useState("10");
  const [situation, setSituation] = useState("all");
  const [zoneTab, setZoneTab] = useState<"attack" | "defend">("attack");
  const [patTab, setPatTab] = useState<"cost" | "earn">("cost");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <AppTopbar
        title="Analysis"
        subtitle="Cross-match · every number opens its rallies"
        actions={
          <Button variant="outline" size="md">
            Export
          </Button>
        }
      />

      <div className="mx-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-4 px-7 pb-11 pt-[22px]">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              value={range}
              onChange={setRange}
              options={[
                { id: "5", label: "Last 5" },
                { id: "10", label: "Last 10" },
                { id: "season", label: "Season" },
              ]}
            />
            <Segmented
              value={situation}
              onChange={setSituation}
              options={[
                { id: "all", label: "All points" },
                { id: "serve", label: "Serve" },
                { id: "receive", label: "Receive" },
              ]}
            />
            <div className="w-[150px]">
              <Select
                size="sm"
                defaultValue="all"
                options={[
                  { value: "all", label: "All disciplines" },
                  { value: "singles", label: "Singles" },
                  { value: "doubles", label: "Doubles" },
                ]}
              />
            </div>
            {(range !== "10" || situation !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setRange("10");
                  setSituation("all");
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-[11px] py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-strong)]"
              >
                Clear filters
              </button>
            )}
            <div className="flex-1" />
            <span className="font-mono text-[11.5px] tabular-nums text-[var(--text-muted)]">
              10 matches · 1,248 points · MS
            </span>
          </div>

          <MatchChipStrip />

          <div className="grid gap-4 lg:grid-cols-[1.22fr_1fr]">
            <PointsEndPanel />
            <PlacementPanel zoneTab={zoneTab} onZoneTabChange={setZoneTab} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
            <PatternsPanel patTab={patTab} onPatTabChange={setPatTab} />
            <SituationsPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
