import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  if (!url) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL");
  }
  return url;
}

/**
 * Server-only Supabase client using the publishable/anon key.
 * Not used by the BWF catalog (service-role only; anon SELECT on system
 * matches is revoked). Kept for other app surfaces that may need anon.
 */
export function createAnonClient(): SupabaseClient {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient(requireUrl(), key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Server-only service role client. Bypasses RLS.
 * Used for BWF catalog loads (private server path) and admin/ops.
 * Callers must still filter `owner_id IS NULL` for catalog reads.
 */
export function createServiceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(requireUrl(), key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function hasAnonKey(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function hasServiceRoleKey(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
