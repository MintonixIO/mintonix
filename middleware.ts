import { updateSession } from "@/lib/supabase/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function middleware(request: NextRequest) {
  // First, update the session
  const response = await updateSession(request);
  
  // Check for admin routes
  if (request.nextUrl.pathname.startsWith('/admin')) {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    
    // If no user, redirect to login
    if (error || !user) {
      const redirectUrl = new URL('/auth/login', request.url);
      redirectUrl.searchParams.set('redirectTo', request.nextUrl.pathname);
      return NextResponse.redirect(redirectUrl);
    }
    
    // Check if user has admin role
    try {
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      
      if (profileError || !profile || (profile.role !== 'admin' && profile.role !== 'super_admin')) {
        // Redirect non-admin users to dashboard
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
    } catch (error) {
      console.error('Error checking admin role:', error);
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }
  
  // Check for admin API routes
  if (request.nextUrl.pathname.startsWith('/api/admin')) {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    
    // If no user, return unauthorized
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Check if user has admin role
    try {
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      
      if (profileError || !profile || (profile.role !== 'admin' && profile.role !== 'super_admin')) {
        return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 });
      }
    } catch (error) {
      console.error('Error checking admin role:', error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  }
  
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
