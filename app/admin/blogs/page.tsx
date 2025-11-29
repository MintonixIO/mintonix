"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserProfile } from "@/lib/admin-auth";
import {
  PlusCircle,
  Eye,
  Edit,
  Trash2,
  ArrowLeft,
  FileText,
  Search
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  status: 'draft' | 'published';
  created_at: string;
  updated_at: string;
  author: string;
}

export default function BlogsManagement() {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [blogPosts, setBlogPosts] = useState<BlogPost[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const router = useRouter();

  useEffect(() => {
    const checkAdminAccess = async () => {
      const supabase = createClient();
      const { data: { user }, error } = await supabase.auth.getUser();

      if (error || !user) {
        router.push("/auth/login");
        return;
      }

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
      await loadBlogPosts();
      setIsLoading(false);
    };

    const loadBlogPosts = async () => {
      try {
        const response = await fetch('/api/admin/blogs');
        if (response.ok) {
          const posts = await response.json();
          setBlogPosts(posts);
        }
      } catch (error) {
        console.error('Error loading blog posts:', error);
      }
    };

    checkAdminAccess();
  }, [router]);

  const deleteBlogPost = async (id: string) => {
    if (!confirm('Are you sure you want to delete this blog post?')) return;

    try {
      const response = await fetch(`/api/admin/blogs/${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setBlogPosts(posts => posts.filter(post => post.id !== id));
      }
    } catch (error) {
      console.error('Error deleting blog post:', error);
    }
  };

  const filteredPosts = blogPosts.filter(post =>
    post.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    post.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
    post.author.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
          <p className="text-muted-foreground">You don&apos;t have permission to access this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/admin">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Link>
              </Button>
              <h1 className="text-xl font-bold text-foreground">Blog Posts</h1>
            </div>
            <Button asChild>
              <Link href="/admin/blogs/new">
                <PlusCircle className="h-4 w-4 mr-2" />
                New Post
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search posts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Blog Posts Table */}
        <div className="bg-card border border-border rounded-lg">
          {filteredPosts.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              {blogPosts.length === 0 ? (
                <>
                  <h3 className="text-lg font-medium text-foreground mb-2">No blog posts yet</h3>
                  <p className="text-muted-foreground mb-4">Create your first blog post to get started.</p>
                  <Button asChild>
                    <Link href="/admin/blogs/new">
                      <PlusCircle className="h-4 w-4 mr-2" />
                      Create Blog Post
                    </Link>
                  </Button>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-medium text-foreground mb-2">No posts found</h3>
                  <p className="text-muted-foreground">Try adjusting your search query.</p>
                </>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-medium text-foreground">Title</th>
                    <th className="text-left py-3 px-4 font-medium text-foreground">Status</th>
                    <th className="text-left py-3 px-4 font-medium text-foreground">Author</th>
                    <th className="text-left py-3 px-4 font-medium text-foreground">Created</th>
                    <th className="text-left py-3 px-4 font-medium text-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPosts.map((post) => (
                    <tr key={post.id} className="border-b border-border/50 hover:bg-muted/50">
                      <td className="py-3 px-4">
                        <div>
                          <p className="font-medium text-foreground">{post.title}</p>
                          <p className="text-sm text-muted-foreground">/{post.slug}</p>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          post.status === 'published'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                        }`}>
                          {post.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">{post.author}</td>
                      <td className="py-3 px-4 text-muted-foreground">
                        {new Date(post.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center space-x-1">
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/blog/${post.slug}`}>
                              <Eye className="h-4 w-4" />
                            </Link>
                          </Button>
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/admin/blogs/edit/${post.id}`}>
                              <Edit className="h-4 w-4" />
                            </Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteBlogPost(post.id)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-100 dark:hover:bg-red-900/30"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Post Count */}
        {filteredPosts.length > 0 && (
          <div className="mt-4 text-sm text-muted-foreground">
            Showing {filteredPosts.length} of {blogPosts.length} posts
          </div>
        )}
      </div>
    </div>
  );
}
