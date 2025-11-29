import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10');
    const offset = parseInt(searchParams.get('offset') || '0');

    const supabase = await createClient();

    // Get published blog posts only
    const { data: posts, error } = await supabase
      .from('blog_posts')
      .select('id, title, slug, excerpt, featured_image, tags, created_at, author')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching blog posts:', error);
      return NextResponse.json({ error: 'Failed to fetch blog posts' }, { status: 500 });
    }

    return NextResponse.json(posts || []);
  } catch (error) {
    console.error('Error in GET /api/blog:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}