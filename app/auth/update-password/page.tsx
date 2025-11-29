"use client";

import { UpdatePasswordForm } from "@/components/auth/UpdatePasswordForm";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function Page() {
  const [isLoading, setIsLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();

      if (session) {
        setHasSession(true);
        setIsLoading(false);
      } else {
        // Wait a moment for the session to be established from URL tokens
        setTimeout(async () => {
          const { data: { session: retrySession } } = await supabase.auth.getSession();
          if (retrySession) {
            setHasSession(true);
            setIsLoading(false);
          } else {
            router.push("/auth/forgot-password?error=Session expired. Please request a new password reset.");
          }
        }, 500);
      }
    };

    checkSession();
  }, [supabase.auth, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm text-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!hasSession) {
    return null;
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <UpdatePasswordForm />
      </div>
    </div>
  );
}
