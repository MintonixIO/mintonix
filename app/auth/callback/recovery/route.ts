import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(
        new URL(`/auth/forgot-password?error=${encodeURIComponent(error.message)}`, requestUrl.origin)
      );
    }
  }

  // Redirect to update-password page after successful code exchange
  return NextResponse.redirect(new URL('/auth/update-password', requestUrl.origin));
}
