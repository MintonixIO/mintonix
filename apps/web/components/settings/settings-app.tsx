"use client";

import {
  Bell,
  Camera,
  CreditCard,
  Download,
  FileText,
  SlidersHorizontal,
  User,
} from "lucide-react";
import { useState } from "react";
import { AppTopbar } from "@/components/app/app-topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { v: "profile", label: "Profile", icon: User },
  { v: "analysis", label: "Analysis", icon: SlidersHorizontal },
  { v: "notif", label: "Notifications", icon: Bell },
  { v: "billing", label: "Billing", icon: CreditCard },
] as const;

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

const INVOICES = [
  { date: "1 Jun 2026", amount: "$29.00" },
  { date: "1 May 2026", amount: "$29.00" },
  { date: "1 Apr 2026", amount: "$29.00" },
];

export function SettingsApp() {
  const [section, setSection] =
    useState<(typeof SECTIONS)[number]["v"]>("profile");
  const [units, setUnits] = useState<"kmh" | "mph">("kmh");
  const [threshold, setThreshold] = useState(300);
  const [role, setRole] = useState("coach");
  const [discipline, setDiscipline] = useState("singles");
  const [retention, setRetention] = useState("12m");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <AppTopbar
        title="Settings"
        subtitle="Velocity Badminton Club workspace"
        showSearch={false}
        showBell={false}
        showAccount={false}
      />

      <div className="mx-auto grid w-full max-w-[1040px] grid-cols-1 gap-7 px-7 pt-6 pb-12 lg:grid-cols-[212px_minmax(0,1fr)]">
        <nav className="flex flex-row gap-1 overflow-x-auto lg:sticky lg:top-[100px] lg:flex-col lg:self-start lg:overflow-visible">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = section === s.v;
            return (
              <button
                key={s.v}
                type="button"
                onClick={() => setSection(s.v)}
                className={cn(
                  "flex shrink-0 items-center gap-[11px] rounded-[9px] px-3 py-2 text-left text-[13.5px]",
                  active
                    ? "border border-[var(--border)] bg-[var(--accent-soft)] font-medium text-[var(--text-strong)]"
                    : "border border-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-strong)]",
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4",
                    active ? "text-[var(--accent)]" : undefined,
                  )}
                />
                {s.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
          {section === "profile" ? (
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
                  onChange={(e) => setRole(e.target.value)}
                  options={[
                    { value: "coach", label: "Head coach" },
                    { value: "assistant", label: "Assistant coach" },
                    { value: "analyst", label: "Performance analyst" },
                    { value: "player", label: "Player" },
                  ]}
                />
                <Input
                  label="Club / academy"
                  defaultValue="Velocity Badminton Club"
                />
              </div>
              <div className="flex gap-2.5 pt-1">
                <Button>Save changes</Button>
                <Button variant="ghost">Cancel</Button>
              </div>
            </div>
          ) : null}

          {section === "analysis" ? (
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
                  onChange={setUnits}
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
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-full accent-[var(--accent)]"
                />
              </div>

              <div className="overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)]">
                {[
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
                ].map((row, i, arr) => (
                  <div
                    key={row.title}
                    className={cn(
                      "flex items-center gap-3.5 p-[15px]",
                      i < arr.length - 1 &&
                        "border-b border-[var(--border-subtle)]",
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
                  onChange={(e) => setDiscipline(e.target.value)}
                  options={[
                    { value: "singles", label: "Singles" },
                    { value: "doubles", label: "Doubles" },
                    { value: "mixed", label: "Mixed doubles" },
                  ]}
                />
                <Select
                  label="Footage retention"
                  value={retention}
                  onChange={(e) => setRetention(e.target.value)}
                  options={[
                    { value: "3m", label: "Keep 3 months" },
                    { value: "12m", label: "Keep 12 months" },
                    { value: "forever", label: "Keep forever" },
                  ]}
                />
              </div>
            </div>
          ) : null}

          {section === "notif" ? (
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
                      i < NOTIFS.length - 1 &&
                        "border-b border-[var(--border-subtle)]",
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
          ) : null}

          {section === "billing" ? (
            <div className="flex flex-col gap-[18px]">
              <div>
                <div className="font-display text-[17px] font-semibold text-[var(--text-strong)]">
                  Billing & plan
                </div>
                <div className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
                  Manage your subscription, usage and invoices.
                </div>
              </div>

              <div className="relative overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-5">
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      "radial-gradient(70% 130% at 100% 0%, rgba(54,147,255,0.10), transparent 60%)",
                  }}
                />
                <div className="relative flex flex-wrap items-start gap-4">
                  <div className="min-w-[200px] flex-1">
                    <div className="inline-flex items-center gap-2">
                      <span className="font-display text-lg font-semibold text-[var(--text-strong)]">
                        Pro
                      </span>
                      <span className="rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.1em] text-[var(--accent)] uppercase">
                        Current
                      </span>
                    </div>
                    <div className="mt-1.5 text-[13px] text-[var(--text-secondary)]">
                      600 analysis minutes & 100 GB storage / month. Renews 1
                      Jul 2026.
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-[26px] font-semibold text-[var(--text-strong)]">
                      $29
                      <span className="font-mono text-[13px] font-normal text-[var(--text-muted)]">
                        {" "}
                        / mo
                      </span>
                    </div>
                  </div>
                </div>
                <div className="relative mt-[18px] grid gap-[18px] sm:grid-cols-2">
                  <div>
                    <div className="mb-1.5 flex justify-between text-[12.5px] text-[var(--text-secondary)]">
                      <span>Analysis minutes</span>
                      <span className="font-mono text-[var(--text-strong)]">
                        428 / 600
                      </span>
                    </div>
                    <div className="h-[7px] overflow-hidden rounded-full bg-[var(--surface-3)]">
                      <div className="h-full w-[71%] rounded-full bg-[var(--accent)]" />
                    </div>
                  </div>
                  <div>
                    <div className="mb-1.5 flex justify-between text-[12.5px] text-[var(--text-secondary)]">
                      <span>Storage</span>
                      <span className="font-mono text-[var(--text-strong)]">
                        18.4 / 100 GB
                      </span>
                    </div>
                    <div className="h-[7px] overflow-hidden rounded-full bg-[var(--surface-3)]">
                      <div className="h-full w-[18%] rounded-full bg-[var(--accent)]" />
                    </div>
                  </div>
                </div>
                <div className="relative mt-[18px] flex gap-2.5">
                  <Button>Upgrade plan</Button>
                  <Button variant="ghost">Cancel plan</Button>
                </div>
              </div>

              <div className="flex items-center gap-3.5 rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)] p-[15px]">
                <span className="inline-flex h-[30px] w-[42px] shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-3)] text-[var(--text-secondary)]">
                  <CreditCard className="h-[18px] w-[18px]" />
                </span>
                <div className="flex-1">
                  <div className="text-[13.5px] text-[var(--text-strong)]">
                    Visa ending 4242
                  </div>
                  <div className="mt-px font-mono text-[11.5px] text-[var(--text-muted)]">
                    Expires 09 / 28
                  </div>
                </div>
                <Button variant="outline" size="sm">
                  Update
                </Button>
              </div>

              <div className="overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface-1)]">
                <div className="px-[15px] pt-[13px] pb-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)] uppercase">
                  Recent invoices
                </div>
                {INVOICES.map((iv) => (
                  <div
                    key={iv.date}
                    className="flex items-center gap-3 border-t border-[var(--border-subtle)] px-[15px] py-3"
                  >
                    <FileText className="h-[15px] w-[15px] shrink-0 text-[var(--text-muted)]" />
                    <span className="flex-1 text-[13px] text-[var(--text-strong)]">
                      {iv.date}
                    </span>
                    <span className="font-mono text-[12.5px] tabular-nums text-[var(--text-secondary)]">
                      {iv.amount}
                    </span>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-[12.5px] text-[var(--text-link)]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      PDF
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
