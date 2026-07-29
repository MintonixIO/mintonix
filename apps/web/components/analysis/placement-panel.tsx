import { Heatmap } from "@/components/charts/heatmap";
import { Segmented } from "@/components/ui/segmented";

type PlacementPanelProps = {
  zoneTab: "attack" | "defend";
  onZoneTabChange: (v: "attack" | "defend") => void;
};

export function PlacementPanel({
  zoneTab,
  onZoneTabChange,
}: PlacementPanelProps) {
  return (
    <section className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] p-[18px] shadow-[var(--shadow-edge)]">
      <div className="mb-1 flex flex-wrap items-center gap-2.5">
        <div className="font-display text-[15px] font-semibold text-[var(--text-strong)]">
          Placement outcomes
        </div>
        <div className="flex-1" />
        <Segmented
          size="sm"
          className="rounded-lg bg-[var(--surface-2)]"
          value={zoneTab}
          onChange={onZoneTabChange}
          options={[
            { id: "attack", label: "Attack" },
            { id: "defend", label: "Defend" },
          ]}
        />
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
  );
}
