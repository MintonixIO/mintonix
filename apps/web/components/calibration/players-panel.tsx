"use client";

import {
  Check,
  RotateCcw,
  ScanSearch,
  UserMinus,
  UserRound,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { usePlayers } from "@/components/calibration/calibration-context";
import { DIR, PA, PB } from "@/lib/calibration/constants";

export function PlayersPanel() {
  const {
    players,
    identify,
    setPlayer,
    resetIdentifyKey,
    setIdentifyQ,
    setIdentifyId,
    results,
  } = usePlayers();

  return (
    <div className="flex flex-col gap-3.5">
      {(["a", "b"] as const).map((k) => {
        const color = k === "a" ? PA : PB;
        const tag = `Player ${k.toUpperCase()}`;
        const sub = k === "a" ? "Near court · blue" : "Far court · ice";
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
                  Click {tag} on the frame — SAM masks them in one click.
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
                      onClick={() => resetIdentifyKey(k)}
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
                      onChange={(e) => setIdentifyQ(k, e.target.value)}
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
                            onClick={() => setIdentifyId(k, u.id)}
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
                      onClick={() => resetIdentifyKey(k)}
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
                    onClick={() => setPlayer(k, "idle")}
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

      <div className="flex items-start gap-2 rounded-[10px] border border-[rgba(54,147,255,0.2)] bg-[var(--brand-subtle)] px-3 py-2.5">
        <ScanSearch className="mt-px h-[15px] w-[15px] shrink-0 text-[var(--brand)]" />
        <span className="text-xs leading-[1.5] text-[var(--text-primary)]">
          One click runs SAM to mask each player, then link a Mintonix profile.
          Naming is optional — leave a player unnamed and continue.
        </span>
      </div>
    </div>
  );
}
