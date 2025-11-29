import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { uploadBlogContent } from '@/lib/blog-r2';
import { isAdminServer, createUnauthorizedResponse, createForbiddenResponse } from '@/lib/admin-auth';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return createUnauthorizedResponse();
    }

    // Check if user has admin role
    const adminAccess = await isAdminServer(user.id);
    if (!adminAccess) {
      return createForbiddenResponse();
    }

    // Get all blog posts from Supabase
    const { data: posts, error } = await supabase
      .from('blog_posts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching blog posts:', error);
      return NextResponse.json({ error: 'Failed to fetch blog posts' }, { status: 500 });
    }

    return NextResponse.json(posts || []);
  } catch (error) {
    console.error('Error in GET /api/admin/blogs:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return createUnauthorizedResponse();
    }

    // Check if user has admin role
    const adminAccess = await isAdminServer(user.id);
    if (!adminAccess) {
      return createForbiddenResponse();
    }

    const body = await request.json();
    const { title, content, excerpt, status, tags, featured_image } = body;

    // Generate slug from title
    const slug = title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .trim();

    // Upload markdown content to R2
    const contentKey = await uploadBlogContent(slug, content);

    // Insert blog post into Supabase
    const { data: post, error } = await supabase
      .from('blog_posts')
      .insert({
        title,
        slug,
        content_key: contentKey,
        excerpt,
        status: status || 'draft',
        tags: tags || [],
        featured_image,
        author: user.email,
        author_id: user.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating blog post:', error);
      return NextResponse.json({ error: 'Failed to create blog post' }, { status: 500 });
    }

    return NextResponse.json(post);
  } catch (error) {
    console.error('Error in POST /api/admin/blogs:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}