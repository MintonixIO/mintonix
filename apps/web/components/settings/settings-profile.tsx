import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type SettingsProfileProps = {
  role: string;
  onRoleChange: (v: string) => void;
};

export function SettingsProfile({ role, onRoleChange }: SettingsProfileProps) {
  return (
    <div className="flex flex-col gap-[22px]">
      <div>
        <div className="font-display text-[17px] font-semibold text-[var(--text-strong)]">
          Profile
        </div>
        <div className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
          How you appear across the workspace and on shared reels.
        </div>
      </div>
      <div className="flex items-center gap-4 rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-4">
        <span
          className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--ink-850)] text-[var(--text-muted)]"
          aria-hidden
        >
          <Camera className="h-6 w-6" strokeWidth={1.75} />
        </span>
        <div className="flex-1">
          <div className="text-sm font-medium text-[var(--text-strong)]">
            Profile photo
          </div>
          <div className="mt-0.5 font-mono text-[11.5px] text-[var(--text-muted)]">
            PNG or JPG · up to 2 MB
          </div>
        </div>
        <Button variant="outline" size="sm">
          Upload
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Full name" defaultValue="Viktor Koster" />
        <Input label="Email" defaultValue="viktor@velocitybc.com" />
        <Select
          label="Role"
          value={role}
          onChange={(e) => onRoleChange(e.target.value)}
          options={[
            { value: "coach", label: "Head coach" },
            { value: "assistant", label: "Assistant coach" },
            { value: "analyst", label: "Performance analyst" },
            { value: "player", label: "Player" },
          ]}
        />
        <Input label="Club / academy" defaultValue="Velocity Badminton Club" />
      </div>
      <div className="flex gap-2.5 pt-1">
        <Button>Save changes</Button>
        <Button variant="ghost">Cancel</Button>
      </div>
    </div>
  );
}
