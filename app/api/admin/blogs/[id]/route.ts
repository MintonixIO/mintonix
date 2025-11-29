import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { uploadBlogContent, deleteBlogContent, getBlogContent } from '@/lib/blog-r2';
import { isAdminServer, createUnauthorizedResponse, createForbiddenResponse } from '@/lib/admin-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const { data: post, error } = await supabase
      .from('blog_posts')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching blog post:', error);
      return NextResponse.json({ error: 'Blog post not found' }, { status: 404 });
    }

    // Get content from R2
    const content = await getBlogContent(post.content_key);
    
    return NextResponse.json({
      ...post,
      content
    });
  } catch (error) {
    console.error('Error in GET /api/admin/blogs/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    // Get existing post to get current content key
    const { data: existingPost, error: fetchError } = await supabase
      .from('blog_posts')
      .select('content_key, slug')
      .eq('id', id)
      .single();

    if (fetchError) {
      return NextResponse.json({ error: 'Blog post not found' }, { status: 404 });
    }

    // Generate new slug if title changed
    const slug = title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .trim();

    // Update content in R2
    const contentKey = await uploadBlogContent(slug, content);

    // Delete old content if slug changed
    if (existingPost.content_key !== contentKey) {
      await deleteBlogContent(existingPost.content_key);
    }

    // Update blog post in Supabase
    const { data: post, error } = await supabase
      .from('blog_posts')
      .update({
        title,
        slug,
        content_key: contentKey,
        excerpt,
        status,
        tags,
        featured_image,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating blog post:', error);
      return NextResponse.json({ error: 'Failed to update blog post' }, { status: 500 });
    }

    return NextResponse.json(post);
  } catch (error) {
    console.error('Error in PUT /api/admin/blogs/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    // Get post to get content key for deletion
    const { data: post, error: fetchError } = await supabase
      .from('blog_posts')
      .select('content_key')
      .eq('id', id)
      .single();

    if (fetchError) {
      return NextResponse.json({ error: 'Blog post not found' }, { status: 404 });
    }

    // Delete from Supabase
    const { error } = await supabase
      .from('blog_posts')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting blog post:', error);
      return NextResponse.json({ error: 'Failed to delete blog post' }, { status: 500 });
    }

    // Delete content from R2
    await deleteBlogContent(post.content_key);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/admin/blogs/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}