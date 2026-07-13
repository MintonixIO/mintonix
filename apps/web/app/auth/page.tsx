"use client";

import Link from "next/link";
import Image from "next/image";
import { Camera, Check, Lock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn, initials } from "@/lib/utils";

type Screen = "signin" | "signup-account" | "signup-profile" | "done";

const DISCIPLINES = ["Singles", "Doubles", "Mixed doubles"] as const;

function PlayerCardPreview({
  name,
  club,
  level,
  years,
  disciplines,
  isPrivate,
  avatarUrl,
}: {
  name: string;
  club: string;
  level: string;
  years: string;
  disciplines: string[];
  isPrivate: boolean;
  avatarUrl: string | null;
}) {
  const displayName = name.trim() || "Your name";
  const displayClub = club.trim() || "Add your club";
  const ini = initials(name) || "YN";

  return (
    <div className="max-w-[360px]">
      <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--accent)]">
        Your player card
      </div>
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] shadow-[var(--shadow-lg),inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="flex items-center gap-3.5 border-b border-[var(--border-subtle)] px-[22px] py-[22px] pb-[18px]">
          <div className="relative flex h-[58px] w-[58px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-[linear-gradient(135deg,#4a9dff,#2d7ff0)] font-display text-[21px] font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <span>{ini}</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate font-display text-lg font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
              {displayName}
            </div>
            <div className="mt-0.5 truncate text-[13px] text-[var(--text-muted)]">
              {displayClub}
            </div>
          </div>
          {isPrivate ? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 self-start rounded-full border border-[var(--border)] bg-white/[0.04] px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
              <Lock className="h-[11px] w-[11px]" aria-hidden />
              Private
            </span>
          ) : null}
        </div>
        <div className="flex min-h-[30px] flex-wrap gap-2 px-[22px] py-4">
          {level ? (
            <span className="rounded-full border border-[var(--border)] bg-[var(--accent-soft)] px-2.5 py-1 font-mono text-[11px] tracking-wide text-[var(--accent)]">
              {level}
            </span>
          ) : null}
          {disciplines.map((d) => (
            <span
              key={d}
              className="rounded-full border border-[var(--border)] bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] tracking-wide text-[var(--text-secondary)]"
            >
              {d}
            </span>
          ))}
          {years ? (
            <span className="rounded-full border border-[var(--border)] bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] tracking-wide text-[var(--text-secondary)]">
              {years}
            </span>
          ) : null}
        </div>
        <div className="mx-[22px] mb-[22px] grid grid-cols-3 gap-px overflow-hidden rounded-[11px] border border-[var(--border-subtle)] bg-[var(--border-subtle)]">
          {["Matches", "Win rate", "Rallies"].map((label) => (
            <div
              key={label}
              className="bg-[var(--surface-1)] px-2.5 py-3 text-center"
            >
              <div className="font-mono text-lg font-semibold text-[var(--text-faint)]">
                —
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-4 px-1 text-[13px] leading-[1.55] text-[var(--text-muted)]">
        Your card fills in as you play. Upload your first match to start tracking
        these stats.
      </p>
    </div>
  );
}

export default function AuthPage() {
  const [screen, setScreen] = useState<Screen>("signin");
  const [errSignin, setErrSignin] = useState(false);
  const [errAccount, setErrAccount] = useState(false);

  const [signinEmail, setSigninEmail] = useState("");
  const [signinPassword, setSigninPassword] = useState("");
  const [remember, setRemember] = useState(true);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);

  const [club, setClub] = useState("");
  const [years, setYears] = useState("");
  const [level, setLevel] = useState("");
  const [hand, setHand] = useState("");
  const [disciplines, setDisciplines] = useState<string[]>([]);
  const [isPrivate, setIsPrivate] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (avatarUrl) URL.revokeObjectURL(avatarUrl);
    };
  }, [avatarUrl]);

  const showCard = screen === "signup-profile" || screen === "done";
  const showPitch = screen === "signin" || screen === "signup-account";

  const doneTitle = useMemo(() => {
    const first = fullName.trim().split(/\s+/)[0];
    return first ? `You're all set, ${first}` : "You're all set";
  }, [fullName]);

  const go = (s: Screen) => {
    setErrAccount(false);
    setErrSignin(false);
    setScreen(s);
  };

  const onSignin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!signinEmail.trim() || !signinPassword.trim()) {
      setErrSignin(true);
      return;
    }
    go("done");
  };

  const onAccountNext = (e: React.FormEvent) => {
    e.preventDefault();
    const ok =
      fullName.trim() &&
      email.trim() &&
      password.length >= 8 &&
      terms;
    if (!ok) {
      setErrAccount(true);
      return;
    }
    go("signup-profile");
  };

  const toggleDisc = (val: string) => {
    setDisciplines((arr) =>
      arr.includes(val) ? arr.filter((d) => d !== val) : [...arr, val],
    );
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (avatarUrl) URL.revokeObjectURL(avatarUrl);
    setAvatarUrl(URL.createObjectURL(f));
  };

  const openUpload = () => fileRef.current?.click();

  const ini = initials(fullName) || "YN";

  return (
    <main className="flex min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      <style jsx global>{`
        @keyframes mx-rise {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @keyframes mx-pop {
          0% {
            transform: scale(0.6);
            opacity: 0;
          }
          60% {
            transform: scale(1.08);
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        .mx-screen {
          animation: mx-rise 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .mx-screen,
          .mx-pop {
            animation: none !important;
          }
        }
      `}</style>

      {/* Left brand panel */}
      <aside className="relative hidden min-h-screen w-[46%] max-w-[640px] shrink-0 overflow-hidden border-r border-[var(--border-subtle)] bg-[linear-gradient(180deg,#0c1426_0%,#0a1020_100%)] px-12 py-10 md:flex md:flex-col">
        <div
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(120% 60% at 30% -5%, rgba(54,147,255,0.20), transparent 60%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-45"
          style={{
            backgroundImage:
              "linear-gradient(rgba(54,147,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(54,147,255,0.05) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage:
              "radial-gradient(80% 70% at 30% 10%, #000 20%, transparent 80%)",
            WebkitMaskImage:
              "radial-gradient(80% 70% at 30% 10%, #000 20%, transparent 80%)",
          }}
        />
        <div className="relative flex h-full min-h-0 flex-1 flex-col">
          <Link href="/" className="inline-flex w-max items-center gap-2.5">
            <Image
              src="/assets/logomark.png"
              alt="Mintonix"
              width={26}
              height={26}
            />
            <span className="font-display text-[19px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
              Mintonix
            </span>
          </Link>

          <div className="flex flex-1 flex-col justify-center py-10">
            {showPitch ? (
              <div className="max-w-[30ch]">
                <div className="mb-[18px] font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--accent)]">
                  Badminton analysis engine
                </div>
                <h1 className="text-balance font-display text-[clamp(30px,3.4vw,44px)] font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--text-strong)]">
                  See every rally. Understand every match.
                </h1>
                <p className="mt-5 text-[15.5px] leading-[1.6] text-[var(--text-secondary)]">
                  Turn your footage into rallies, heatmaps, and head-to-head
                  metrics — all in one library, shareable with a link.
                </p>
                <div className="mt-10 flex gap-7">
                  {[
                    { k: "12k+", v: "matches analyzed" },
                    { k: "38", v: "metrics per rally" },
                    { k: "1", v: "link to share" },
                  ].map((s, i) => (
                    <div key={s.v} className="flex gap-7">
                      {i > 0 ? (
                        <div className="w-px self-stretch bg-[var(--border-subtle)]" />
                      ) : null}
                      <div>
                        <div className="font-mono text-[26px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
                          {s.k}
                        </div>
                        <div className="mt-1 text-xs text-[var(--text-muted)]">
                          {s.v}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {showCard ? (
              <PlayerCardPreview
                name={fullName}
                club={club}
                level={level}
                years={years}
                disciplines={disciplines}
                isPrivate={isPrivate}
                avatarUrl={avatarUrl}
              />
            ) : null}
          </div>

          <div className="text-xs text-[var(--text-faint)]">© 2026 Mintonix</div>
        </div>
      </aside>

      {/* Right form */}
      <section className="flex min-h-screen min-w-0 flex-1 items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-[416px]">
          <Link
            href="/"
            className="mb-7 flex items-center gap-2.5 md:hidden"
          >
            <Image
              src="/assets/logomark.png"
              alt="Mintonix"
              width={24}
              height={24}
            />
            <span className="font-display text-lg font-semibold text-[var(--text-strong)]">
              Mintonix
            </span>
          </Link>

          {/* Sign in */}
          {screen === "signin" ? (
            <div className="mx-screen" data-screen-label="Sign in">
              <h2 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
                Sign in
              </h2>
              <p className="mt-2 mb-7 text-[14.5px] text-[var(--text-secondary)]">
                Welcome back. Pick up where you left off.
              </p>
              <form className="flex flex-col gap-4" onSubmit={onSignin}>
                <Input
                  label="Email"
                  type="email"
                  name="signinEmail"
                  autoComplete="email"
                  placeholder="you@club.com"
                  value={signinEmail}
                  onChange={(e) => {
                    setSigninEmail(e.target.value);
                    setErrSignin(false);
                  }}
                  required
                />
                <Input
                  label="Password"
                  type="password"
                  name="signinPassword"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={signinPassword}
                  onChange={(e) => {
                    setSigninPassword(e.target.value);
                    setErrSignin(false);
                  }}
                  required
                />
                <div className="mb-2 mt-1 flex items-center justify-between">
                  <Checkbox
                    label="Remember me"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  <button
                    type="button"
                    className="text-[13px] text-[var(--accent)] hover:text-[#6db0ff]"
                  >
                    Forgot password?
                  </button>
                </div>
                {errSignin ? (
                  <div className="text-[13px] text-[var(--coral-400,#f4515c)]">
                    Enter your email and password to continue.
                  </div>
                ) : null}
                <Button type="submit" block size="lg">
                  Sign in
                </Button>
              </form>
              <p className="mt-6 text-center text-sm text-[var(--text-secondary)]">
                New to Mintonix?{" "}
                <button
                  type="button"
                  className="font-medium text-[var(--accent)] hover:text-[#6db0ff]"
                  onClick={() => go("signup-account")}
                >
                  Create an account
                </button>
              </p>
            </div>
          ) : null}

          {/* Create account */}
          {screen === "signup-account" ? (
            <div className="mx-screen" data-screen-label="Create account">
              <div className="mb-[18px] flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                <span className="text-[var(--accent)]">Step 1</span>
                <span className="opacity-50">/ 2</span>
                <span className="ml-1 h-[3px] max-w-[120px] flex-1 overflow-hidden rounded-full bg-[var(--border-subtle)]">
                  <span className="block h-full w-1/2 bg-[var(--accent)]" />
                </span>
              </div>
              <h2 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
                Create your account
              </h2>
              <p className="mt-2 mb-7 text-[14.5px] text-[var(--text-secondary)]">
                Start analyzing your matches in minutes.
              </p>
              <form className="flex flex-col gap-4" onSubmit={onAccountNext}>
                <Input
                  label="Full name"
                  name="fullName"
                  autoComplete="name"
                  placeholder="Lin Dan"
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    setErrAccount(false);
                  }}
                  required
                />
                <Input
                  label="Email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="you@club.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setErrAccount(false);
                  }}
                  required
                />
                <Input
                  label="Password"
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setErrAccount(false);
                  }}
                  required
                  minLength={8}
                />
                <div className="my-1">
                  <Checkbox
                    checked={terms}
                    onChange={(e) => {
                      setTerms(e.target.checked);
                      setErrAccount(false);
                    }}
                  >
                    I agree to the Terms and Privacy Policy
                  </Checkbox>
                </div>
                {errAccount ? (
                  <div className="text-[13px] text-[var(--coral-400,#f4515c)]">
                    Please fill in every field and accept the terms.
                  </div>
                ) : null}
                <Button type="submit" block size="lg">
                  Continue
                </Button>
              </form>
              <p className="mt-6 text-center text-sm text-[var(--text-secondary)]">
                Already have an account?{" "}
                <button
                  type="button"
                  className="font-medium text-[var(--accent)] hover:text-[#6db0ff]"
                  onClick={() => go("signin")}
                >
                  Sign in
                </button>
              </p>
            </div>
          ) : null}

          {/* Player profile */}
          {screen === "signup-profile" ? (
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

              {/* Photo */}
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
                onChange={onFile}
              />

              <div className="flex flex-col gap-4">
                <Input
                  label="Club or team"
                  name="club"
                  placeholder="e.g. Riverside Badminton Club"
                  value={club}
                  onChange={(e) => setClub(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-3.5">
                  <Select
                    label="Years playing"
                    name="years"
                    value={years}
                    onChange={(e) => setYears(e.target.value)}
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
                    onChange={(e) => setLevel(e.target.value)}
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
                  <div
                    className="flex flex-wrap gap-2"
                    role="group"
                    aria-label="Discipline"
                  >
                    {DISCIPLINES.map((d) => {
                      const on = disciplines.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleDisc(d)}
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
                  onChange={(e) => setHand(e.target.value)}
                  options={[
                    { value: "", label: "Select…" },
                    { value: "Right", label: "Right" },
                    { value: "Left", label: "Left" },
                  ]}
                />
              </div>

              {/* Privacy */}
              <div className="mt-[22px] flex items-start justify-between gap-4 rounded-xl border border-[var(--border-subtle)] bg-white/[0.015] px-4 py-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--text-strong)]">
                    Keep my player card private
                  </div>
                  <div className="mt-1 text-[12.5px] leading-[1.5] text-[var(--text-muted)]">
                    Hide your card, stats, and profile from other players. You
                    can change this anytime in settings.
                  </div>
                </div>
                <div className="shrink-0 pt-0.5">
                  <Switch
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                    aria-label="Keep my player card private"
                  />
                </div>
              </div>

              <div className="mt-7 flex gap-3">
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => go("signup-account")}
                >
                  Back
                </Button>
                <span className="flex-1">
                  <Button
                    variant="primary"
                    size="lg"
                    block
                    onClick={() => go("done")}
                  >
                    Create profile
                  </Button>
                </span>
              </div>
              <p className="mt-4 text-center text-[13px]">
                <button
                  type="button"
                  onClick={() => go("done")}
                  className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                >
                  Skip for now
                </button>
              </p>
            </div>
          ) : null}

          {/* Done */}
          {screen === "done" ? (
            <div className="mx-screen text-center" data-screen-label="Done">
              <div
                className="mx-pop mx-auto mb-[22px] flex h-16 w-16 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]"
                style={{
                  animation:
                    "mx-pop 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
                }}
              >
                <Check className="h-[30px] w-[30px]" aria-hidden />
              </div>
              <h2 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
                {doneTitle}
              </h2>
              <p className="mx-auto mt-2.5 mb-[30px] max-w-[34ch] text-[14.5px] leading-[1.6] text-[var(--text-secondary)]">
                Your player profile is ready. Upload your first match and
                Mintonix will turn it into rallies, heatmaps, and metrics.
              </p>
              <Link href="/dashboard" className="block">
                <Button variant="primary" size="lg" block>
                  Go to your dashboard
                </Button>
              </Link>
              <Link
                href="/"
                className="mt-3.5 inline-flex justify-center"
              >
                <Button variant="ghost" size="md">
                  Back to home
                </Button>
              </Link>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
