import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const NOTIFS = [
  {
    title: "Analysis complete",
    sub: "When a match finishes processing and is ready to review.",
    on: true,
  },
  {
    title: "Highlight reel rendered",
    sub: "When an auto-generated reel is ready to share.",
    on: true,
  },
  {
    title: "Shared reel viewed",
    sub: "When someone opens a reel you shared.",
    on: false,
  },
  {
    title: "Weekly performance digest",
    sub: "A Monday summary of your tracked metrics.",
    on: true,
  },
  {
    title: "Product updates",
    sub: "New engine features and improvements.",
    on: false,
  },
];

export function SettingsNotifications() {
  return (
    <div className="flex flex-col gap-[18px]">
      <div>
        <div className="font-display text-[17px] font-semibold text-[var(--text-strong)]">
          Notifications
        </div>
        <div className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
          Choose what Mintonix tells you about, and where.
        </div>
      </div>
      <div className="overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)]">
        {NOTIFS.map((n, i) => (
          <div
            key={n.title}
            className={cn(
              "flex items-center gap-3.5 p-[15px]",
              i < NOTIFS.length - 1 && "border-b border-[var(--border-subtle)]",
            )}
          >
            <div className="flex-1">
              <div className="text-[13.5px] font-medium text-[var(--text-strong)]">
                {n.title}
              </div>
              <div className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">
                {n.sub}
              </div>
            </div>
            <Switch defaultChecked={n.on} />
          </div>
        ))}
      </div>
    </div>
  );
}
