import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const ANALYSIS_TOGGLES = [
  {
    title: "Auto-generate highlights",
    sub: "Build a smash + winners reel as soon as analysis finishes.",
    on: true,
  },
  {
    title: "Track shuttle trajectory in 3D",
    sub: "Slower processing, enables the 3D shot view.",
    on: true,
  },
  {
    title: "Reuse last court calibration",
    sub: "Skip calibration when footage is from the same camera angle.",
    on: false,
  },
];

type SettingsAnalysisProps = {
  units: "kmh" | "mph";
  onUnitsChange: (v: "kmh" | "mph") => void;
  threshold: number;
  onThresholdChange: (v: number) => void;
  discipline: string;
  onDisciplineChange: (v: string) => void;
  retention: string;
  onRetentionChange: (v: string) => void;
};

export function SettingsAnalysis({
  units,
  onUnitsChange,
  threshold,
  onThresholdChange,
  discipline,
  onDisciplineChange,
  retention,
  onRetentionChange,
}: SettingsAnalysisProps) {
  return (
    <div className="flex flex-col gap-[18px]">
      <div>
        <div className="font-display text-[17px] font-semibold text-[var(--text-strong)]">
          Analysis preferences
        </div>
        <div className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
          Defaults the engine applies to every new match you upload.
        </div>
      </div>

      <div className="flex items-center gap-3.5 rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4">
        <div className="flex-1">
          <div className="text-[13.5px] font-medium text-[var(--text-strong)]">
            Speed units
          </div>
          <div className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">
            Shown on shot speeds and smash readouts.
          </div>
        </div>
        <Segmented
          size="sm"
          value={units}
          onChange={onUnitsChange}
          options={[
            { id: "kmh", label: "km/h" },
            { id: "mph", label: "mph" },
          ]}
        />
      </div>

      <div className="rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-[13.5px] font-medium text-[var(--text-strong)]">
            Smash highlight threshold
          </div>
          <span className="font-mono text-[13px] tabular-nums text-[var(--accent)]">
            {threshold} km/h
          </span>
        </div>
        <div className="mb-3 text-[12.5px] text-[var(--text-secondary)]">
          Auto-tag smashes faster than this into the highlight feed.
        </div>
        <input
          type="range"
          min={240}
          max={360}
          step={5}
          value={threshold}
          onChange={(e) => onThresholdChange(Number(e.target.value))}
          className="w-full accent-[var(--accent)]"
        />
      </div>

      <div className="overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)]">
        {ANALYSIS_TOGGLES.map((row, i, arr) => (
          <div
            key={row.title}
            className={cn(
              "flex items-center gap-3.5 p-[15px]",
              i < arr.length - 1 && "border-b border-[var(--border-subtle)]",
            )}
          >
            <div className="flex-1">
              <div className="text-[13.5px] font-medium text-[var(--text-strong)]">
                {row.title}
              </div>
              <div className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">
                {row.sub}
              </div>
            </div>
            <Switch defaultChecked={row.on} />
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Default discipline"
          value={discipline}
          onChange={(e) => onDisciplineChange(e.target.value)}
          options={[
            { value: "singles", label: "Singles" },
            { value: "doubles", label: "Doubles" },
            { value: "mixed", label: "Mixed doubles" },
          ]}
        />
        <Select
          label="Footage retention"
          value={retention}
          onChange={(e) => onRetentionChange(e.target.value)}
          options={[
            { value: "3m", label: "Keep 3 months" },
            { value: "12m", label: "Keep 12 months" },
            { value: "forever", label: "Keep forever" },
          ]}
        />
      </div>
    </div>
  );
}
