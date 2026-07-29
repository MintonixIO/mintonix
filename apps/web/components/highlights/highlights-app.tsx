"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppTopbar } from "@/components/app/app-topbar";
import { Button } from "@/components/ui/button";
import { HighlightsDiscovery } from "@/components/highlights/highlights-discovery";
import { MomentFilterBar } from "@/components/highlights/moment-filter-bar";
import { MomentGrid } from "@/components/highlights/moment-grid";
import { ReelsRail } from "@/components/highlights/reels-rail";
import {
  HighlightsToast,
  SelectionBar,
} from "@/components/highlights/selection-bar";
import {
  QUICK,
  emphWeights,
  parseQuery,
  passes,
  scoreMoment,
  type EmphKey,
} from "@/lib/highlights/query";
import { MOMENTS } from "@/lib/highlights/moments";

export function HighlightsApp() {
  const [query, setQuery] = useState("");
  const [emph, setEmph] = useState<EmphKey>("balanced");
  const [chips, setChips] = useState<string[]>([]);
  const [sort, setSort] = useState("best");
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState("");

  const ranked = useMemo(() => {
    const w = emphWeights(emph);
    return MOMENTS.slice().sort(
      (a, b) => scoreMoment(b, w) - scoreMoment(a, w),
    );
  }, [emph]);
  const disc = ranked.slice(0, 4);
  const hero = disc[0];
  const discRows = disc.slice(1, 4);

  const filtered = useMemo(() => {
    const f = parseQuery(query);
    const chipFs = QUICK.filter((c) => chips.includes(c.id)).map((c) => c.f);
    let list = MOMENTS.filter(
      (m) => passes(m, f) && chipFs.every((cf) => passes(m, cf)),
    );
    if (sort === "best") {
      const w = emphWeights(emph);
      list = list
        .slice()
        .sort((a, b) => scoreMoment(b, w) - scoreMoment(a, w));
    } else if (sort === "fastest")
      list = list.slice().sort((a, b) => (b.speed || 0) - (a.speed || 0));
    else if (sort === "longest")
      list = list.slice().sort((a, b) => b.rallyLen - a.rallyLen);
    else list = list.slice().sort((a, b) => b.ord - a.ord);
    return list;
  }, [query, chips, sort, emph]);

  const parsedChips = useMemo(() => {
    const f = parseQuery(query);
    const out: string[] = [];
    f.types.forEach((t) => out.push(`type: ${t.toLowerCase()}`));
    if (f.speedMin) out.push(`≥ ${f.speedMin} km/h`);
    if (f.rallyMin) out.push(`rally ≥ ${f.rallyMin}`);
    if (f.outcome) out.push("winners");
    if (f.kind === "rally") out.push("rallies");
    f.ctx.forEach((t) => out.push(t));
    f.free.forEach((t) => out.push(`“${t}”`));
    return out;
  }, [query]);

  const selIds = Object.keys(sel).filter((id) => sel[id]);
  const selSecs = selIds.reduce((a, id) => {
    const m = MOMENTS.find((x) => x.id === id);
    return a + (m ? m.dur : 0);
  }, 0);
  const matchCount = new Set(MOMENTS.map((m) => m.match)).size;

  const toggleSel = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    setSel((s) => {
      const next = { ...s };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  };

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2600);
  };

  const exportClip = (title: string) => {
    showToast(`Exporting 9:16 · ${title}`);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      <AppTopbar
        title="Highlights"
        subtitle={`${MOMENTS.length} moments indexed · ${matchCount} matches`}
        searchPlaceholder="Search moments…"
        showBell={false}
        showAccount={false}
        searchValue={query}
        onSearchChange={setQuery}
        onSearchClear={() => setQuery("")}
        actions={
          <Link href="/video-analysis">
            <Button size="md">New reel</Button>
          </Link>
        }
      />

      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-[26px] px-7 pt-6 pb-10">
        <HighlightsDiscovery
          hero={hero}
          discRows={discRows}
          emph={emph}
          onEmphChange={setEmph}
          sel={sel}
          onToggleSel={toggleSel}
          onExport={exportClip}
        />

        <section className="flex flex-col gap-[13px]">
          <div className="flex items-baseline gap-2.5">
            <h2 className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
              All moments
            </h2>
            <span className="font-mono text-[11.5px] text-[var(--text-muted)]">
              {filtered.length} of {MOMENTS.length}
            </span>
          </div>

          <MomentFilterBar
            chips={chips}
            onChipsChange={setChips}
            sort={sort}
            onSortChange={setSort}
            parsedChips={parsedChips}
            showParsed={Boolean(query.trim())}
          />

          <MomentGrid
            filtered={filtered}
            emph={emph}
            sel={sel}
            onToggleSel={toggleSel}
            onExport={exportClip}
          />
        </section>

        <ReelsRail />

        <SelectionBar
          selIds={selIds}
          selSecs={selSecs}
          onClear={() => setSel({})}
          onExport={exportClip}
        />
      </div>

      <HighlightsToast message={toast} onDismiss={() => setToast("")} />
    </div>
  );
}
