"use client";

import { useState, useEffect, useCallback } from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, User, ArrowLeft, Share2, Clock } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  featured_image: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  author: string;
}

export default function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const [post, setPost] = useState<BlogPost | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [readingTime, setReadingTime] = useState(0);
  const [slug, setSlug] = useState<string>('');
  const router = useRouter();

  useEffect(() => {
    const initializeSlug = async () => {
      const resolvedParams = await params;
      setSlug(resolvedParams.slug);
    };
    initializeSlug();
  }, [params]);

  const loadPost = useCallback(async () => {
    try {
      const response = await fetch(`/api/blog/${slug}`);
      if (response.ok) {
        const postData = await response.json();
        setPost(postData);
        
        // Calculate reading time (average 200 words per minute)
        const wordCount = postData.content.split(/\s+/).length;
        const time = Math.ceil(wordCount / 200);
        setReadingTime(time);
      } else if (response.status === 404) {
        router.push('/blog');
      }
    } catch {
      router.push('/blog');
    } finally {
      setIsLoading(false);
    }
  }, [slug, router]);

  useEffect(() => {
    if (slug) {
      loadPost();
    }
  }, [slug, loadPost]);

  const sharePost = async () => {
    if (navigator.share && post) {
      try {
        await navigator.share({
          title: post.title,
          text: post.excerpt,
          url: window.location.href,
        });
      } catch {
        // Fallback to copying URL
        navigator.clipboard.writeText(window.location.href);
        alert('URL copied to clipboard!');
      }
    } else {
      // Fallback to copying URL
      navigator.clipboard.writeText(window.location.href);
      alert('URL copied to clipboard!');
    }
  };

  // Simple markdown to HTML converter (basic implementation)
  const renderMarkdown = (markdown: string) => {
    let html = markdown;
    
    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3 class="text-xl font-bold text-foreground mt-8 mb-4">$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2 class="text-2xl font-bold text-foreground mt-10 mb-6">$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1 class="text-3xl font-bold text-foreground mt-12 mb-8">$1</h1>');
    
    // Bold and italic
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold">$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em class="italic">$1</em>');
    
    // Code blocks
    html = html.replace(/```([\s\S]*?)```/g, '<pre class="bg-muted p-4 rounded-lg overflow-x-auto my-4"><code>$1</code></pre>');
    html = html.replace(/`(.*?)`/g, '<code class="bg-muted px-2 py-1 rounded text-sm">$1</code>');
    
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-primary hover:underline">$1</a>');
    
    // Images
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="max-w-full h-auto rounded-lg my-6" />');
    
    // Lists
    html = html.replace(/^- (.*)$/gm, '<li class="ml-4 mb-2">• $1</li>');
    html = html.replace(/(<li[\s\S]*<\/li>)/, '<ul class="my-4">$1</ul>');
    
    // Paragraphs
    html = html.replace(/\n\n/g, '</p><p class="mb-4 text-muted-foreground leading-relaxed">');
    html = '<p class="mb-4 text-muted-foreground leading-relaxed">' + html + '</p>';
    
    return html;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="pt-20 flex items-center justify-center min-h-[50vh]">
          <div className="text-foreground">Loading blog post...</div>
        </div>
        <Footer />
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="pt-20 flex items-center justify-center min-h-[50vh]">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground mb-4">Blog Post Not Found</h1>
            <Button asChild>
              <Link href="/blog">Back to Blog</Link>
            </Button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="pt-20 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Back Button */}
          <div className="mb-8">
            <Button variant="ghost" asChild>
              <Link href="/blog">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Blog
              </Link>
            </Button>
          </div>

          {/* Article Header */}
          <article className="mb-16">
            <header className="mb-8">
              {/* Meta Info */}
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-6">
                <div className="flex items-center gap-1">
                  <User className="h-4 w-4" />
                  {post.author}
                </div>
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {new Date(post.created_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {readingTime} min read
                </div>
              </div>

              {/* Title */}
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-6 leading-tight">
                {post.title}
              </h1>

              {/* Excerpt */}
              {post.excerpt && (
                <p className="text-xl text-muted-foreground mb-6 leading-relaxed">
                  {post.excerpt}
                </p>
              )}

              {/* Tags and Share */}
              <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
                <div className="flex flex-wrap gap-2">
                  {post.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">{tag}</Badge>
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={sharePost}>
                  <Share2 className="h-4 w-4 mr-2" />
                  Share
                </Button>
              </div>

              {/* Featured Image */}
              {post.featured_image && (
                <div className="relative w-full h-64 md:h-96 mb-8 rounded-xl overflow-hidden">
                  <Image
                    src={post.featured_image}
                    alt={post.title}
                    fill
                    className="object-cover"
                    priority
                  />
                </div>
              )}
            </header>

            {/* Content */}
            <div className="prose prose-lg max-w-none">
              <div 
                className="blog-content"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(post.content) }}
              />
            </div>
          </article>

          {/* Footer */}
          <footer className="border-t border-border pt-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="text-center md:text-left">
                <h3 className="font-semibold text-foreground mb-2">Published by {post.author}</h3>
                <p className="text-sm text-muted-foreground">
                  Last updated on {new Date(post.updated_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </p>
              </div>
              <div className="flex gap-4">
                <Button variant="outline" onClick={sharePost}>
                  <Share2 className="h-4 w-4 mr-2" />
                  Share Article
                </Button>
                <Button asChild>
                  <Link href="/blog">More Articles</Link>
                </Button>
              </div>
            </div>
          </footer>
        </div>
      </main>

      <Footer />

      <style jsx global>{`
        .blog-content h1,
        .blog-content h2,
        .blog-content h3 {
          color: hsl(var(--foreground));
        }
        
        .blog-content p {
          color: hsl(var(--muted-foreground));
          line-height: 1.7;
          margin-bottom: 1rem;
        }
        
        .blog-content ul {
          margin: 1rem 0;
        }
        
        .blog-content li {
          color: hsl(var(--muted-foreground));
          margin-left: 1rem;
          margin-bottom: 0.5rem;
        }
        
        .blog-content code {
          background-color: hsl(var(--muted));
          padding: 0.25rem 0.5rem;
          border-radius: 0.375rem;
          font-size: 0.875rem;
        }
        
        .blog-content pre {
          background-color: hsl(var(--muted));
          padding: 1rem;
          border-radius: 0.5rem;
          overflow-x: auto;
          margin: 1rem 0;
        }
        
        .blog-content img {
          max-width: 100%;
          height: auto;
          border-radius: 0.5rem;
          margin: 1.5rem 0;
        }
        
        .blog-content a {
          color: hsl(var(--primary));
          text-decoration: underline;
        }
        
        .blog-content a:hover {
          text-decoration: none;
        }
      `}</style>
    </div>
  );
}