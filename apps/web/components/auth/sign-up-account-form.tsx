import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export function SignUpAccountForm({
  fullName,
  email,
  password,
  terms,
  error,
  onFullNameChange,
  onEmailChange,
  onPasswordChange,
  onTermsChange,
  onSubmit,
  onSignIn,
}: {
  fullName: string;
  email: string;
  password: string;
  terms: boolean;
  error: boolean;
  onFullNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onTermsChange: (value: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
  onSignIn: () => void;
}) {
  return (
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
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <Input
          label="Full name"
          name="fullName"
          autoComplete="name"
          placeholder="Lin Dan"
          value={fullName}
          onChange={(e) => onFullNameChange(e.target.value)}
          required
        />
        <Input
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@club.com"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          required
        />
        <Input
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          required
          minLength={8}
        />
        <div className="my-1">
          <Checkbox
            checked={terms}
            onChange={(e) => onTermsChange(e.target.checked)}
          >
            I agree to the Terms and Privacy Policy
          </Checkbox>
        </div>
        {error ? (
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
          onClick={onSignIn}
        >
          Sign in
        </button>
      </p>
    </div>
  );
}
