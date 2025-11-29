import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { uploadBlogMedia } from '@/lib/blog-r2';
import { isAdminServer, createUnauthorizedResponse, createForbiddenResponse } from '@/lib/admin-auth';

export const runtime = 'nodejs';

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

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Only images are allowed.' }, { status: 400 });
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return NextResponse.json({ error: 'File too large. Maximum size is 5MB.' }, { status: 400 });
    }

    // Upload to R2
    const mediaUrl = await uploadBlogMedia(file);

    return NextResponse.json({ url: mediaUrl });
  } catch (error) {
    console.error('Error in POST /api/admin/blogs/upload-media:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}