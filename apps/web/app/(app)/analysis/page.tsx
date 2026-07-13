"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AppTopbar } from "@/components/app/app-topbar";
import { StatBar } from "@/components/charts/stat-bar";
import { Heatmap } from "@/components/charts/heatmap";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const MATCH_CHIPS = [
  { name: "Vitidsarn", res: "L", pw: 42, w: "0–2", win: false },
  { name: "Antonsen", res: "W", pw: 58, w: "2–1", win: true },
  { name: "Kim/Seo", res: "W", pw: 61, w: "2–0", win: true },
  { name: "Prannoy", res: "W", pw: 55, w: "2–1", win: true },
  { name: "Lee ZJ", res: "L", pw: 46, w: "1–2", win: false },
  { name: "Popov", res: "W", pw: 63, w: "2–0", win: true },
  { name: "Doubles", res: "W", pw: 57, w: "2–1", win: true },
  { name: "Ginting", res: "W", pw: 52, w: "2–1", win: true },
  { name: "Momota", res: "W", pw: 54, w: "2–1", win: true, active: true },
  { name: "Axelsen", res: "L", pw: 48, w: "1–2", win: false },
];

export default function AnalysisPage() {
  const [range, setRange] = useState("10");
  const [situation, setSituation] = useState("all");
  const [zoneTab, setZoneTab] = useState("attack");
  const [patTab, setPatTab] = useState("cost");

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
          {/* Query bar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-0.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] p-0.5">
              {[
                { id: "5", label: "Last 5" },
                { id: "10", label: "Last 10" },
                { id: "season", label: "Season" },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setRange(t.id)}
                  className={cn(
                    "rounded-[7px] px-3 py-1.5 text-[12.5px] whitespace-nowrap",
                    range === t.id
                      ? "bg-[var(--accent)] text-white"
                      : "bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-strong)]",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex gap-0.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface-1)] p-0.5">
              {[
                { id: "all", label: "All points" },
                { id: "serve", label: "Serve" },
                { id: "receive", label: "Receive" },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSituation(t.id)}
                  className={cn(
                    "rounded-[7px] px-3 py-1.5 text-[12.5px] whitespace-nowrap",
                    situation === t.id
                      ? "bg-[var(--accent)] text-white"
                      : "bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-strong)]",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
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

          {/* Match strip */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {MATCH_CHIPS.map((m) => (
              <button
                key={m.name}
                type="button"
                className={cn(
                  "w-[118px] shrink-0 rounded-[10px] border px-2.5 py-2 text-left",
                  m.active
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--border)] bg-[var(--surface-1)] hover:border-[var(--border-strong)]",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[5px] font-mono text-[10px] font-semibold",
                      m.win
                        ? "bg-[var(--success-bg)] text-[var(--success-500)]"
                        : "bg-[var(--danger-bg)] text-[var(--danger-400)]",
                    )}
                  >
                    {m.res}
                  </span>
                  <span className="min-w-0 truncate text-xs text-[var(--text-strong)]">
                    {m.name}
                  </span>
                </span>
                <span className="mt-1.5 flex items-center gap-1.5">
                  <span className="min-w-0 flex-1">
                    <StatBar pct={m.pw} size="xs" tone="accent" />
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
                    {m.w}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {/* Row A */}
          <div className="grid gap-4 lg:grid-cols-[1.22fr_1fr]">
            <section className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[18px] shadow-[var(--shadow-edge)]">
              <div className="mb-1 flex items-baseline gap-3">
                <div className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
                  How your points end
                </div>
                <div className="flex-1" />
                <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                  n=1,248
                </span>
              </div>
              <div className="mb-3.5 text-[12.5px] text-[var(--text-secondary)]">
                Every point in scope, by how it finished. Click a row to watch
                those rallies.
              </div>
              <StatBar
                size="md"
                segments={[
                  { pct: 28, tone: "success", title: "Winners" },
                  { pct: 18, tone: "success-soft", title: "Forced" },
                  { pct: 12, tone: "success-faint", title: "Opp UE" },
                  { pct: 16, tone: "danger", title: "Your UE" },
                  { pct: 14, tone: "danger-soft", title: "Forced against" },
                  { pct: 12, tone: "danger-faint", title: "Opp winners" },
                ]}
              />
              <div className="mt-3.5 grid grid-cols-2 gap-5">
                <div>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--success-500)]">
                    Points won · 58%
                  </div>
                  {[
                    { l: "Your winners", n: "342", p: "28%", c: "var(--success-500)" },
                    { l: "Errors you forced", n: "218", p: "18%", c: "rgba(45,212,167,0.6)" },
                    { l: "Opponent unforced errors", n: "156", p: "12%", c: "rgba(45,212,167,0.3)" },
                  ].map((r) => (
                    <button
                      key={r.l}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--surface-hover)]"
                    >
                      <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: r.c }} />
                      <span className="min-w-0 flex-1 text-[12.5px] text-[var(--text-secondary)]">
                        {r.l}
                      </span>
                      <span className="font-mono text-[11.5px] tabular-nums text-[var(--text-strong)]">
                        {r.n}
                      </span>
                      <span className="w-[30px] text-right font-mono text-[10.5px] tabular-nums text-[var(--text-faint)]">
                        {r.p}
                      </span>
                    </button>
                  ))}
                </div>
                <div>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--danger-400)]">
                    Points lost · 42%
                  </div>
                  {[
                    { l: "Your unforced errors", n: "198", p: "16%", c: "var(--danger-500)" },
                    { l: "Your forced errors", n: "174", p: "14%", c: "rgba(244,81,92,0.6)" },
                    { l: "Opponent winners", n: "160", p: "12%", c: "rgba(244,81,92,0.3)" },
                  ].map((r) => (
                    <button
                      key={r.l}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--surface-hover)]"
                    >
                      <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: r.c }} />
                      <span className="min-w-0 flex-1 text-[12.5px] text-[var(--text-secondary)]">
                        {r.l}
                      </span>
                      <span className="font-mono text-[11.5px] tabular-nums text-[var(--text-strong)]">
                        {r.n}
                      </span>
                      <span className="w-[30px] text-right font-mono text-[10.5px] tabular-nums text-[var(--text-faint)]">
                        {r.p}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="my-3.5 h-px bg-[var(--border-subtle)]" />
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                    Shots that win you points
                  </div>
                  <div className="space-y-1.5">
                    <StatBar label="Smash" labelWidth="88px" tone="success" pct={42} value="142" />
                    <StatBar label="Net" labelWidth="88px" tone="success" pct={28} value="96" />
                    <StatBar label="Drop" labelWidth="88px" tone="success" pct={18} value="61" />
                    <StatBar label="Drive" labelWidth="88px" tone="success" pct={12} value="43" />
                  </div>
                </div>
                <div>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                    Your shots that donate points
                  </div>
                  <div className="space-y-1.5">
                    <StatBar label="Lift error" labelWidth="108px" tone="danger" pct={36} value="71" />
                    <StatBar label="Net miss" labelWidth="108px" tone="danger" pct={28} value="55" />
                    <StatBar label="Clear long" labelWidth="108px" tone="danger" pct={20} value="39" />
                    <StatBar label="Smash wide" labelWidth="108px" tone="danger" pct={16} value="33" />
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[18px] shadow-[var(--shadow-edge)]">
              <div className="mb-1 flex flex-wrap items-center gap-2.5">
                <div className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
                  Placement outcomes
                </div>
                <div className="flex-1" />
                <div className="flex gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
                  {[
                    { id: "attack", label: "Attack" },
                    { id: "defend", label: "Defend" },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setZoneTab(t.id)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[11.5px]",
                        zoneTab === t.id
                          ? "bg-[var(--accent)] text-white"
                          : "text-[var(--text-secondary)]",
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-3.5 text-[12.5px] leading-[1.45] text-[var(--text-secondary)]">
                Win rate vs your season baseline by court zone.
              </div>
              <div className="rounded-[10px] border border-[var(--border)] bg-[#0a1426] p-3">
                <Heatmap
                  columns={3}
                  cellHeight={56}
                  scale="diverging"
                  rowLabels={["Back", "Mid", "Front"]}
                  cells={[
                    { value: 0.4, big: "+4%", small: "back L" },
                    { value: -0.2, big: "−2%", small: "back C" },
                    { value: 0.6, big: "+6%", small: "back R" },
                    { value: 0.1, big: "+1%", small: "mid L" },
                    { value: -0.3, big: "−3%", small: "mid C" },
                    { value: 0.2, big: "+2%", small: "mid R" },
                    { value: 0.5, big: "+5%", small: "net L" },
                    { value: -0.1, big: "−1%", small: "net C" },
                    { value: 0.3, big: "+3%", small: "net R" },
                  ]}
                />
                <div className="mt-2 flex items-center gap-2">
                  <span className="flex-1 border-t border-[rgba(154,168,194,0.4)]" />
                  <span className="font-mono text-[9px] tracking-[0.14em] text-[var(--text-faint)]">
                    NET
                  </span>
                  <span className="flex-1 border-t border-[rgba(154,168,194,0.4)]" />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="font-mono text-[10.5px] text-[var(--text-faint)]">
                  below baseline
                </span>
                <span className="block h-1.5 flex-1 rounded-full bg-[linear-gradient(90deg,rgba(244,81,92,0.55),rgba(20,30,56,0.9),rgba(45,212,167,0.55))]" />
                <span className="font-mono text-[10.5px] text-[var(--text-faint)]">
                  above baseline
                </span>
              </div>
            </section>
          </div>

          {/* Row B */}
          <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
            <section className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[18px] shadow-[var(--shadow-edge)]">
              <div className="mb-1 flex flex-wrap items-center gap-2.5">
                <div className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
                  Recurring patterns
                </div>
                <div className="flex-1" />
                <div className="flex gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
                  {[
                    { id: "cost", label: "Costing" },
                    { id: "earn", label: "Earning" },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setPatTab(t.id)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[11.5px]",
                        patTab === t.id
                          ? "bg-[var(--accent)] text-white"
                          : "text-[var(--text-secondary)]",
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-3.5 text-[12.5px] text-[var(--text-secondary)]">
                Shot sequences the engine keeps seeing · sample floor n≥8
              </div>
              <div className="flex flex-col gap-2">
                {[
                  { name: "Clear → Drop → Net miss", stat: "n=24 · you win 29%", pct: 29, base: 54, cost: "−25pp", neg: true },
                  { name: "Serve short · body → Lift long", stat: "n=18 · you win 33%", pct: 33, base: 54, cost: "−21pp", neg: true },
                  { name: "Drive rally · mid-court squeeze", stat: "n=31 · you win 68%", pct: 68, base: 54, cost: "+14pp", neg: false },
                ].map((p) => (
                  <div
                    key={p.name}
                    className="flex items-center gap-3.5 rounded-[11px] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3.5 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-[var(--text-strong)]">
                        {p.name}
                      </div>
                      <div className="mt-0.5 font-mono text-[10.5px] tabular-nums text-[var(--text-muted)]">
                        {p.stat}
                      </div>
                    </div>
                    <div className="w-[120px] shrink-0">
                      <StatBar tone="auto" pct={p.pct} baseline={p.base} />
                    </div>
                    <span
                      className={cn(
                        "w-[52px] shrink-0 text-right font-mono text-xs tabular-nums",
                        p.neg ? "text-[var(--danger-400)]" : "text-[var(--success-500)]",
                      )}
                    >
                      {p.cost}
                    </span>
                    <Link
                      href="/replay"
                      className="inline-flex shrink-0 items-center gap-1 rounded-[7px] border border-[var(--border-strong)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-strong)]"
                    >
                      <Play className="h-[11px] w-[11px]" />
                      Watch
                    </Link>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[18px] shadow-[var(--shadow-edge)]">
              <div className="mb-1 flex items-baseline gap-3">
                <div className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
                  Situations
                </div>
                <div className="flex-1" />
                <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                  baseline 54%
                </span>
              </div>
              <div className="mb-3.5 text-[12.5px] text-[var(--text-secondary)]">
                Same rallies, cut by context — where your odds move.
              </div>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                Rally length
              </div>
              <div className="space-y-1.5">
                <StatBar label="1–4" labelWidth="74px" tone="auto" pct={61} baseline={54} value="61%" n="n=312" />
                <StatBar label="5–8" labelWidth="74px" tone="auto" pct={56} baseline={54} value="56%" n="n=401" />
                <StatBar label="9–12" labelWidth="74px" tone="auto" pct={49} baseline={54} value="49%" n="n=288" />
                <StatBar label="13+" labelWidth="74px" tone="auto" pct={44} baseline={54} value="44%" n="n=247" />
              </div>
              <div className="mb-2 mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                By game
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "G1", val: "57%", delta: "+3pp", pos: true },
                  { label: "G2", val: "52%", delta: "−2pp", pos: false },
                  { label: "G3", val: "54%", delta: "0", flat: true },
                ].map((c) => (
                  <div
                    key={c.label}
                    className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 py-2.5 text-center"
                  >
                    <span className="block font-mono text-[10px] text-[var(--text-muted)]">
                      {c.label}
                    </span>
                    <span className="mt-1 block font-display text-[19px] font-semibold tabular-nums text-[var(--text-strong)]">
                      {c.val}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 block font-mono text-[10px] tabular-nums",
                        c.flat
                          ? "text-[var(--text-muted)]"
                          : c.pos
                            ? "text-[var(--success-500)]"
                            : "text-[var(--danger-400)]",
                      )}
                    >
                      {c.delta}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mb-2 mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                Score pressure
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "≤17", val: "56%", delta: "+2pp", pos: true },
                  { label: "≥18", val: "49%", delta: "−5pp", pos: false },
                ].map((c) => (
                  <div
                    key={c.label}
                    className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 py-2.5 text-center"
                  >
                    <span className="block font-mono text-[10px] text-[var(--text-muted)]">
                      {c.label}
                    </span>
                    <span className="mt-1 block font-display text-[19px] font-semibold tabular-nums text-[var(--text-strong)]">
                      {c.val}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 block font-mono text-[10px] tabular-nums",
                        c.pos ? "text-[var(--success-500)]" : "text-[var(--danger-400)]",
                      )}
                    >
                      {c.delta}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
