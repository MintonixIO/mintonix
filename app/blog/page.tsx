"use client";

import { useState, useEffect } from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, User, ArrowRight } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  featured_image: string | null;
  tags: string[];
  created_at: string;
  author: string;
}

export default function BlogPage() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    loadPosts();
  }, []);

  const loadPosts = async (offset = 0) => {
    try {
      const response = await fetch(`/api/blog?limit=10&offset=${offset}`);
      if (response.ok) {
        const newPosts = await response.json();
        if (offset === 0) {
          setPosts(newPosts);
        } else {
          setPosts(prev => [...prev, ...newPosts]);
        }
        setHasMore(newPosts.length === 10);
      }
    } catch (error) {
      console.error('Error loading blog posts:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMore = () => {
    const newPage = page + 1;
    setPage(newPage);
    loadPosts(newPage * 10);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="pt-20 flex items-center justify-center min-h-[50vh]">
          <div className="text-foreground">Loading blog posts...</div>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="pt-20 pb-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="text-center mb-16">
            <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-6">
              Badminton Analytics Blog
            </h1>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
              Insights, tips, and updates from the world of badminton video analysis. 
              Learn how to improve your game with AI-powered analytics.
            </p>
          </div>

          {posts.length === 0 ? (
            <div className="text-center py-16">
              <h2 className="text-2xl font-bold text-foreground mb-4">No blog posts yet</h2>
              <p className="text-muted-foreground">Check back soon for exciting content about badminton analytics!</p>
            </div>
          ) : (
            <>
              {/* Featured Post */}
              {posts.length > 0 && (
                <div className="mb-16">
                  <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-lg">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
                      <div className="relative h-64 lg:h-auto">
                        {posts[0].featured_image ? (
                          <Image
                            src={posts[0].featured_image}
                            alt={posts[0].title}
                            fill
                            className="object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-muted flex items-center justify-center">
                            <div className="text-center">
                              <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                              <p className="text-muted-foreground">Featured Post</p>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="p-8 lg:p-12 flex flex-col justify-center">
                        <div className="flex items-center gap-2 mb-4">
                          <Badge variant="secondary">Featured</Badge>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <User className="h-4 w-4" />
                              {posts[0].author}
                            </div>
                            <div className="flex items-center gap-1">
                              <Calendar className="h-4 w-4" />
                              {new Date(posts[0].created_at).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                        <h2 className="text-2xl lg:text-3xl font-bold text-foreground mb-4">
                          {posts[0].title}
                        </h2>
                        <p className="text-muted-foreground mb-6 leading-relaxed">
                          {posts[0].excerpt}
                        </p>
                        <div className="flex flex-wrap gap-2 mb-6">
                          {posts[0].tags.slice(0, 3).map((tag) => (
                            <Badge key={tag} variant="outline">{tag}</Badge>
                          ))}
                        </div>
                        <Button asChild className="w-fit">
                          <Link href={`/blog/${posts[0].slug}`}>
                            Read More
                            <ArrowRight className="h-4 w-4 ml-2" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Blog Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
                {posts.slice(1).map((post) => (
                  <article key={post.id} className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg transition-shadow">
                    <div className="relative h-48">
                      {post.featured_image ? (
                        <Image
                          src={post.featured_image}
                          alt={post.title}
                          fill
                          className="object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-muted flex items-center justify-center">
                          <Calendar className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="p-6">
                      <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
                        <div className="flex items-center gap-1">
                          <User className="h-4 w-4" />
                          {post.author}
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          {new Date(post.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <h3 className="text-xl font-bold text-foreground mb-3 line-clamp-2">
                        {post.title}
                      </h3>
                      <p className="text-muted-foreground mb-4 line-clamp-3">
                        {post.excerpt}
                      </p>
                      <div className="flex flex-wrap gap-2 mb-4">
                        {post.tags.slice(0, 2).map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                      <Button variant="outline" size="sm" asChild className="w-full">
                        <Link href={`/blog/${post.slug}`}>
                          Read More
                          <ArrowRight className="h-4 w-4 ml-2" />
                        </Link>
                      </Button>
                    </div>
                  </article>
                ))}
              </div>

              {/* Load More */}
              {hasMore && (
                <div className="text-center">
                  <Button onClick={loadMore} variant="outline" size="lg">
                    Load More Posts
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}