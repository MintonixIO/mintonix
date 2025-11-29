import { createClient } from '@/lib/supabase/server';
import { createClient as createClientClient } from '@/lib/supabase/client';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: 'user' | 'admin' | 'super_admin';
  created_at: string;
  updated_at: string;
}

// Server-side admin check
export async function isAdminServer(userId?: string): Promise<boolean> {
  try {
    const supabase = await createClient();
    
    // Get current user if no userId provided
    if (!userId) {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) return false;
      userId = user.id;
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (error || !data) return false;
    
    return data.role === 'admin' || data.role === 'super_admin';
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

// Server-side super admin check
export async function isSuperAdminServer(userId?: string): Promise<boolean> {
  try {
    const supabase = await createClient();
    
    // Get current user if no userId provided
    if (!userId) {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) return false;
      userId = user.id;
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (error || !data) return false;
    
    return data.role === 'super_admin';
  } catch (error) {
    console.error('Error checking super admin status:', error);
    return false;
  }
}

// Server-side get user profile
export async function getUserProfileServer(userId?: string): Promise<UserProfile | null> {
  try {
    const supabase = await createClient();
    
    // Get current user if no userId provided
    if (!userId) {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) return null;
      userId = user.id;
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !data) return null;
    
    return data as UserProfile;
  } catch (error) {
    console.error('Error getting user profile:', error);
    return null;
  }
}

// Client-side admin check
export async function isAdminClient(): Promise<boolean> {
  try {
    const supabase = createClientClient();
    
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return false;

    const { data, error } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (error || !data) return false;
    
    return data.role === 'admin' || data.role === 'super_admin';
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

// Client-side super admin check
export async function isSuperAdminClient(): Promise<boolean> {
  try {
    const supabase = createClientClient();
    
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return false;

    const { data, error } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (error || !data) return false;
    
    return data.role === 'super_admin';
  } catch (error) {
    console.error('Error checking super admin status:', error);
    return false;
  }
}

// Client-side get user profile
export async function getUserProfileClient(): Promise<UserProfile | null> {
  try {
    const supabase = createClientClient();
    
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return null;

    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error || !data) return null;
    
    return data as UserProfile;
  } catch (error) {
    console.error('Error getting user profile:', error);
    return null;
  }
}

// Update user role (super admin only)
export async function updateUserRole(userId: string, newRole: 'user' | 'admin' | 'super_admin'): Promise<boolean> {
  try {
    const supabase = await createClient();
    
    // Check if current user is super admin
    const isSuperAdmin = await isSuperAdminServer();
    if (!isSuperAdmin) {
      throw new Error('Only super admins can update user roles');
    }

    const { error } = await supabase
      .from('user_profiles')
      .update({ role: newRole })
      .eq('id', userId);

    return !error;
  } catch (error) {
    console.error('Error updating user role:', error);
    return false;
  }
}

// Create or update user profile
export async function createOrUpdateUserProfile(
  userId: string, 
  email: string, 
  fullName?: string,
  role: 'user' | 'admin' | 'super_admin' = 'user'
): Promise<boolean> {
  try {
    const supabase = await createClient();
    
    const { error } = await supabase
      .from('user_profiles')
      .upsert({
        id: userId,
        email,
        full_name: fullName || '',
        role
      });

    return !error;
  } catch (error) {
    console.error('Error creating/updating user profile:', error);
    return false;
  }
}

// Admin authorization response helper
export function createUnauthorizedResponse() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function createForbiddenResponse() {
  return new Response(JSON.stringify({ error: 'Forbidden - Admin access required' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' }
  });
}