"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserProfile } from "@/lib/admin-auth";
import {
  Users,
  FileText,
  ArrowRight,
  Shield,
  PenSquare
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export default function AdminDashboard() {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [blogCount, setBlogCount] = useState(0);
  const [userCount, setUserCount] = useState(0);
  const router = useRouter();

  useEffect(() => {
    const checkAdminAccess = async () => {
      const supabase = createClient();
      const { data: { user }, error } = await supabase.auth.getUser();

      if (error || !user) {
        router.push("/auth/login");
        return;
      }

      // Check if user has admin role using the new role-based system
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (profileError || !profile || (profile.role !== 'admin' && profile.role !== 'super_admin')) {
        router.push("/dashboard");
        return;
      }

      setUserProfile(profile);
      await loadCounts(profile.role);
      setIsLoading(false);
    };

    const loadCounts = async (role: string) => {
      try {
        // Load blog post count
        const blogResponse = await fetch('/api/admin/blogs');
        if (blogResponse.ok) {
          const posts = await blogResponse.json();
          setBlogCount(posts.length);
        }

        // Load user count if super admin
        if (role === 'super_admin') {
          const userResponse = await fetch('/api/admin/users');
          if (userResponse.ok) {
            const users = await userResponse.json();
            setUserCount(users.length);
          }
        }
      } catch (error) {
        console.error('Error loading counts:', error);
      }
    };

    checkAdminAccess();
  }, [router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground">Loading...</div>
      </div>
    );
  }

  if (!userProfile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-4">Access Denied</h1>
          <p className="text-muted-foreground">You don&apos;t have permission to access the admin dashboard.</p>
          <p className="text-muted-foreground text-sm mt-2">Admin access is required.</p>
        </div>
      </div>
    );
  }

  const isSuperAdmin = userProfile.role === 'super_admin';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <Shield className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-bold text-foreground">Admin Panel</h1>
              <Badge variant={isSuperAdmin ? 'default' : 'secondary'}>
                {userProfile.role.replace('_', ' ').toUpperCase()}
              </Badge>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard">Back to Dashboard</Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-foreground mb-2">
            Welcome back, {userProfile.full_name || 'Admin'}
          </h2>
          <p className="text-muted-foreground">
            Manage your content and users from here.
          </p>
        </div>

        {/* Navigation Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Blog Posts Card */}
          <Link
            href="/admin/blogs"
            className="group block"
          >
            <div className="bg-card border border-border rounded-xl p-6 h-full transition-all duration-200 hover:border-primary hover:shadow-lg">
              <div className="flex items-start justify-between mb-4">
                <div className="p-3 bg-primary/10 rounded-lg">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Blog Posts</h3>
              <p className="text-muted-foreground text-sm mb-4">
                Create, edit, and manage blog content for your platform.
              </p>
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold text-foreground">{blogCount}</span>
                <span className="text-sm text-muted-foreground">total posts</span>
              </div>
            </div>
          </Link>

          {/* Users Card */}
          {isSuperAdmin ? (
            <Link
              href="/admin/users"
              className="group block"
            >
              <div className="bg-card border border-border rounded-xl p-6 h-full transition-all duration-200 hover:border-primary hover:shadow-lg">
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 bg-primary/10 rounded-lg">
                    <Users className="h-6 w-6 text-primary" />
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Users</h3>
                <p className="text-muted-foreground text-sm mb-4">
                  Manage user accounts, roles, and subscriptions.
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold text-foreground">{userCount}</span>
                  <span className="text-sm text-muted-foreground">total users</span>
                </div>
              </div>
            </Link>
          ) : (
            <div className="relative">
              <div className="bg-card border border-border rounded-xl p-6 h-full opacity-50">
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 bg-muted rounded-lg">
                    <Users className="h-6 w-6 text-muted-foreground" />
                  </div>
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Users</h3>
                <p className="text-muted-foreground text-sm mb-4">
                  Manage user accounts, roles, and subscriptions.
                </p>
                <Badge variant="outline" className="text-xs">
                  Super Admin Only
                </Badge>
              </div>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="mt-8 pt-8 border-t border-border">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">Quick Actions</h3>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/admin/blogs/new">
                <PenSquare className="h-4 w-4 mr-2" />
                New Blog Post
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
