"use client";

import { Camera } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn, initials } from "@/lib/utils";

const DISCIPLINES = ["Singles", "Doubles", "Mixed doubles"] as const;

export function SignUpProfileForm({
  fullName,
  club,
  years,
  level,
  hand,
  disciplines,
  isPrivate,
  avatarUrl,
  onClubChange,
  onYearsChange,
  onLevelChange,
  onHandChange,
  onToggleDiscipline,
  onPrivateChange,
  onAvatarChange,
  onBack,
  onCreate,
  onSkip,
}: {
  fullName: string;
  club: string;
  years: string;
  level: string;
  hand: string;
  disciplines: string[];
  isPrivate: boolean;
  avatarUrl: string | null;
  onClubChange: (value: string) => void;
  onYearsChange: (value: string) => void;
  onLevelChange: (value: string) => void;
  onHandChange: (value: string) => void;
  onToggleDiscipline: (value: string) => void;
  onPrivateChange: (value: boolean) => void;
  onAvatarChange: (file: File) => void;
  onBack: () => void;
  onCreate: () => void;
  onSkip: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const ini = initials(fullName) || "YN";
  const openUpload = () => fileRef.current?.click();

  return (
    <div className="mx-screen" data-screen-label="Player profile">
      <div className="mb-[18px] flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
        <span className="text-[var(--accent)]">Step 2</span>
        <span className="opacity-50">/ 2</span>
        <span className="ml-1 h-[3px] max-w-[120px] flex-1 overflow-hidden rounded-full bg-[var(--border-subtle)]">
          <span className="block h-full w-full bg-[var(--accent)]" />
        </span>
      </div>
      <h2 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
        Build your player profile
      </h2>
      <p className="mt-2 mb-[26px] text-[14.5px] text-[var(--text-secondary)]">
        This is how you&apos;ll show up across Mintonix.
      </p>

      <div className="mb-[22px] flex items-center gap-4">
        <button
          type="button"
          onClick={openUpload}
          aria-label="Upload profile photo"
          className="relative flex h-[72px] w-[72px] items-center justify-center rounded-full border border-[var(--border)] bg-[linear-gradient(135deg,#4a9dff,#2d7ff0)] font-display text-[22px] font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] hover:opacity-90"
        >
          <span className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-full">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span>{ini}</span>
            )}
          </span>
          <span className="absolute -bottom-0.5 -right-0.5 flex h-[26px] w-[26px] items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)]">
            <Camera className="h-[13px] w-[13px]" aria-hidden />
          </span>
        </button>
        <div>
          <Button variant="secondary" size="sm" onClick={openUpload}>
            Upload a photo
          </Button>
          <div className="mt-1.5 text-xs text-[var(--text-muted)]">
            PNG or JPG · square works best
          </div>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        id="mx-avatar-file"
        name="avatarFile"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onAvatarChange(f);
        }}
      />

      <div className="flex flex-col gap-4">
        <Input
          label="Club or team"
          name="club"
          placeholder="e.g. Riverside Badminton Club"
          value={club}
          onChange={(e) => onClubChange(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3.5">
          <Select
            label="Years playing"
            name="years"
            value={years}
            onChange={(e) => onYearsChange(e.target.value)}
            options={[
              { value: "", label: "Select…" },
              { value: "< 1 year", label: "Less than a year" },
              { value: "1–3 years", label: "1–3 years" },
              { value: "3–5 years", label: "3–5 years" },
              { value: "5–10 years", label: "5–10 years" },
              { value: "10+ years", label: "10+ years" },
            ]}
          />
          <Select
            label="Skill level"
            name="level"
            value={level}
            onChange={(e) => onLevelChange(e.target.value)}
            options={[
              { value: "", label: "Select…" },
              { value: "Beginner", label: "Beginner" },
              { value: "Intermediate", label: "Intermediate" },
              { value: "Advanced", label: "Advanced" },
              { value: "Competitive", label: "Competitive" },
              { value: "Pro", label: "Pro" },
            ]}
          />
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-xs font-medium tracking-wide text-[var(--text-secondary)]">
              Discipline
            </span>
            <span className="text-[11px] text-[var(--text-muted)]">
              Select all that apply
            </span>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Discipline">
            {DISCIPLINES.map((d) => {
              const on = disciplines.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggleDiscipline(d)}
                  className={cn(
                    "inline-flex min-h-[38px] items-center rounded-full px-[15px] py-2 text-[13px] transition-colors",
                    on
                      ? "border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "border border-[var(--border)] bg-white/[0.03] text-[var(--text-secondary)] hover:border-[var(--border-strong)]",
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>

        <Select
          label="Playing hand"
          name="hand"
          value={hand}
          onChange={(e) => onHandChange(e.target.value)}
          options={[
            { value: "", label: "Select…" },
            { value: "Right", label: "Right" },
            { value: "Left", label: "Left" },
          ]}
        />
      </div>

      <div className="mt-[22px] flex items-start justify-between gap-4 rounded-xl border border-[var(--border-subtle)] bg-white/[0.015] px-4 py-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--text-strong)]">
            Keep my player card private
          </div>
          <div className="mt-1 text-[12.5px] leading-[1.5] text-[var(--text-muted)]">
            Hide your card, stats, and profile from other players. You can change
            this anytime in settings.
          </div>
        </div>
        <div className="shrink-0 pt-0.5">
          <Switch
            checked={isPrivate}
            onChange={(e) => onPrivateChange(e.target.checked)}
            aria-label="Keep my player card private"
          />
        </div>
      </div>

      <div className="mt-7 flex gap-3">
        <Button variant="ghost" size="lg" onClick={onBack}>
          Back
        </Button>
        <span className="flex-1">
          <Button variant="primary" size="lg" block onClick={onCreate}>
            Create profile
          </Button>
        </span>
      </div>
      <p className="mt-4 text-center text-[13px]">
        <button
          type="button"
          onClick={onSkip}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        >
          Skip for now
        </button>
      </p>
    </div>
  );
}
