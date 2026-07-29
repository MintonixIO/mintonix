"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthDone } from "@/components/auth/auth-done";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SignUpAccountForm } from "@/components/auth/sign-up-account-form";
import { SignUpProfileForm } from "@/components/auth/sign-up-profile-form";

export type AuthStep = "signin" | "account" | "profile" | "done";

const STEPS: AuthStep[] = ["signin", "account", "profile", "done"];

/** Map legacy screen names and unknown values onto the query-param steps. */
function parseStep(raw: string | null): AuthStep {
  if (!raw) return "signin";
  if (raw === "signup-account") return "account";
  if (raw === "signup-profile") return "profile";
  if (STEPS.includes(raw as AuthStep)) return raw as AuthStep;
  return "signin";
}

export function AuthApp() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const step = parseStep(searchParams.get("step"));

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

  useEffect(() => {
    return () => {
      if (avatarUrl) URL.revokeObjectURL(avatarUrl);
    };
  }, [avatarUrl]);

  const showCard = step === "profile" || step === "done";
  const showPitch = step === "signin" || step === "account";

  const doneTitle = useMemo(() => {
    const first = fullName.trim().split(/\s+/)[0];
    return first ? `You're all set, ${first}` : "You're all set";
  }, [fullName]);

  const go = (s: AuthStep) => {
    setErrAccount(false);
    setErrSignin(false);
    const params = new URLSearchParams(searchParams.toString());
    if (s === "signin") {
      params.delete("step");
    } else {
      params.set("step", s);
    }
    const qs = params.toString();
    router.replace(qs ? `/auth?${qs}` : "/auth");
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
      fullName.trim() && email.trim() && password.length >= 8 && terms;
    if (!ok) {
      setErrAccount(true);
      return;
    }
    go("profile");
  };

  const toggleDisc = (val: string) => {
    setDisciplines((arr) =>
      arr.includes(val) ? arr.filter((d) => d !== val) : [...arr, val],
    );
  };

  const onAvatarFile = (file: File) => {
    if (avatarUrl) URL.revokeObjectURL(avatarUrl);
    setAvatarUrl(URL.createObjectURL(file));
  };

  return (
    <AuthShell
      showPitch={showPitch}
      showCard={showCard}
      card={{
        name: fullName,
        club,
        level,
        years,
        disciplines,
        isPrivate,
        avatarUrl,
      }}
    >
      {step === "signin" ? (
        <SignInForm
          email={signinEmail}
          password={signinPassword}
          remember={remember}
          error={errSignin}
          onEmailChange={(v) => {
            setSigninEmail(v);
            setErrSignin(false);
          }}
          onPasswordChange={(v) => {
            setSigninPassword(v);
            setErrSignin(false);
          }}
          onRememberChange={setRemember}
          onSubmit={onSignin}
          onCreateAccount={() => go("account")}
        />
      ) : null}

      {step === "account" ? (
        <SignUpAccountForm
          fullName={fullName}
          email={email}
          password={password}
          terms={terms}
          error={errAccount}
          onFullNameChange={(v) => {
            setFullName(v);
            setErrAccount(false);
          }}
          onEmailChange={(v) => {
            setEmail(v);
            setErrAccount(false);
          }}
          onPasswordChange={(v) => {
            setPassword(v);
            setErrAccount(false);
          }}
          onTermsChange={(v) => {
            setTerms(v);
            setErrAccount(false);
          }}
          onSubmit={onAccountNext}
          onSignIn={() => go("signin")}
        />
      ) : null}

      {step === "profile" ? (
        <SignUpProfileForm
          fullName={fullName}
          club={club}
          years={years}
          level={level}
          hand={hand}
          disciplines={disciplines}
          isPrivate={isPrivate}
          avatarUrl={avatarUrl}
          onClubChange={setClub}
          onYearsChange={setYears}
          onLevelChange={setLevel}
          onHandChange={setHand}
          onToggleDiscipline={toggleDisc}
          onPrivateChange={setIsPrivate}
          onAvatarChange={onAvatarFile}
          onBack={() => go("account")}
          onCreate={() => go("done")}
          onSkip={() => go("done")}
        />
      ) : null}

      {step === "done" ? <AuthDone title={doneTitle} /> : null}
    </AuthShell>
  );
}
