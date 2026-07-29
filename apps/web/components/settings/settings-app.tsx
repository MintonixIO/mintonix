"use client";

import {
  Bell,
  CreditCard,
  SlidersHorizontal,
  User,
} from "lucide-react";
import { useState } from "react";
import { AppTopbar } from "@/components/app/app-topbar";
import { SettingsAnalysis } from "@/components/settings/settings-analysis";
import { SettingsBilling } from "@/components/settings/settings-billing";
import { SettingsNotifications } from "@/components/settings/settings-notifications";
import { SettingsProfile } from "@/components/settings/settings-profile";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { v: "profile", label: "Profile", icon: User },
  { v: "analysis", label: "Analysis", icon: SlidersHorizontal },
  { v: "notif", label: "Notifications", icon: Bell },
  { v: "billing", label: "Billing", icon: CreditCard },
] as const;

type SectionKey = (typeof SECTIONS)[number]["v"];

export function SettingsApp() {
  const [section, setSection] = useState<SectionKey>("profile");
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
            <SettingsProfile role={role} onRoleChange={setRole} />
          ) : null}
          {section === "analysis" ? (
            <SettingsAnalysis
              units={units}
              onUnitsChange={setUnits}
              threshold={threshold}
              onThresholdChange={setThreshold}
              discipline={discipline}
              onDisciplineChange={setDiscipline}
              retention={retention}
              onRetentionChange={setRetention}
            />
          ) : null}
          {section === "notif" ? <SettingsNotifications /> : null}
          {section === "billing" ? <SettingsBilling /> : null}
        </div>
      </div>
    </div>
  );
}
