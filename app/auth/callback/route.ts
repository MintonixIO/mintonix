import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = requestUrl.searchParams.get('next') || '/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      // Redirect to login with error if code exchange fails
      return NextResponse.redirect(
        new URL(`/auth/login?error=${encodeURIComponent(error.message)}`, requestUrl.origin)
      );
    }
  }

  // Redirect to the next URL or dashboard
  return NextResponse.redirect(new URL(next, requestUrl.origin));
}
