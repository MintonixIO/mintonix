"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";

// Map of known error codes to user-friendly messages
function getUpdatePasswordErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "An unexpected error occurred. Please try again.";
  }

  const message = error.message.toLowerCase();

  // Handle common password update errors
  if (message.includes("password") && message.includes("weak")) {
    return "Password is too weak. Please choose a stronger password.";
  }
  if (message.includes("password") && message.includes("short")) {
    return "Password must be at least 6 characters long.";
  }
  if (message.includes("same password")) {
    return "New password must be different from your current password.";
  }
  if (message.includes("different password")) {
    return "Please choose a different password.";
  }
  if (message.includes("session") || message.includes("expired") || message.includes("not authenticated")) {
    return "Your session has expired. Please request a new password reset link.";
  }
  if (message.includes("too many requests") || message.includes("rate limit")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (message.includes("network") || message.includes("fetch")) {
    return "Unable to connect. Please check your internet connection and try again.";
  }

  // Default generic message for any other errors
  return "Unable to update password. Please try again later.";
}

export function UpdatePasswordForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      // Use hard redirect to ensure cookies are properly synced before navigation
      // Loading state intentionally stays true until page reloads
      window.location.href = "/dashboard";
      return;
    } catch (error: unknown) {
      setError(getUpdatePasswordErrorMessage(error));
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Reset Your Password</CardTitle>
          <CardDescription>
            Please enter your new password below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleForgotPassword}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="New password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Saving..." : "Save new password"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
