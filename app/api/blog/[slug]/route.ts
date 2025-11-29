import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getBlogContent } from '@/lib/blog-r2';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const supabase = await createClient();

    const { slug } = await params;
    // Get published blog post by slug
    const { data: post, error } = await supabase
      .from('blog_posts')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'published')
      .single();

    if (error || !post) {
      return NextResponse.json({ error: 'Blog post not found' }, { status: 404 });
    }

    // Get content from R2
    const content = await getBlogContent(post.content_key);
    
    return NextResponse.json({
      ...post,
      content
    });
  } catch (error) {
    console.error('Error in GET /api/blog/[slug]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}