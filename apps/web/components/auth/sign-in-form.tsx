import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export function SignInForm({
  email,
  password,
  remember,
  error,
  onEmailChange,
  onPasswordChange,
  onRememberChange,
  onSubmit,
  onCreateAccount,
}: {
  email: string;
  password: string;
  remember: boolean;
  error: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onRememberChange: (value: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCreateAccount: () => void;
}) {
  return (
    <div className="mx-screen" data-screen-label="Sign in">
      <h2 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
        Sign in
      </h2>
      <p className="mt-2 mb-7 text-[14.5px] text-[var(--text-secondary)]">
        Welcome back. Pick up where you left off.
      </p>
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <Input
          label="Email"
          type="email"
          name="signinEmail"
          autoComplete="email"
          placeholder="you@club.com"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          required
        />
        <Input
          label="Password"
          type="password"
          name="signinPassword"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          required
        />
        <div className="mb-2 mt-1 flex items-center justify-between">
          <Checkbox
            label="Remember me"
            checked={remember}
            onChange={(e) => onRememberChange(e.target.checked)}
          />
          <button
            type="button"
            className="text-[13px] text-[var(--accent)] hover:text-[#6db0ff]"
          >
            Forgot password?
          </button>
        </div>
        {error ? (
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
          onClick={onCreateAccount}
        >
          Create an account
        </button>
      </p>
    </div>
  );
}
