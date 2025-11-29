"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AuthHandler() {
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        // Handle password recovery flow
        if (event === "PASSWORD_RECOVERY") {
          router.push("/auth/update-password");
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [supabase.auth, router]);

  return null;
}
