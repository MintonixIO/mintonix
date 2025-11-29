import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

// Cloudflare R2 configuration
const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT_URL,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true, // Use path-style URLs instead of virtual-hosted-style
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;
const R2_ENVIRONMENT = process.env.R2_ENVIRONMENT || 'dev';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';

// Blog content storage functions
export async function uploadBlogContent(slug: string, content: string): Promise<string> {
  const key = `${R2_ENVIRONMENT}/blog/content/${slug}.md`;
  
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: content,
    ContentType: 'text/markdown',
    Metadata: {
      type: 'blog-content',
      slug,
      uploadTimestamp: Date.now().toString(),
    },
  });

  await r2Client.send(command);
  return key;
}

export async function getBlogContent(contentKey: string): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: contentKey,
    });

    const response = await r2Client.send(command);
    
    if (!response.Body) {
      throw new Error('No content found');
    }

    return await response.Body.transformToString();
  } catch (error) {
    console.error('Error getting blog content:', error);
    throw new Error('Failed to retrieve blog content');
  }
}

export async function deleteBlogContent(contentKey: string): Promise<void> {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: contentKey,
    });

    await r2Client.send(command);
  } catch (error) {
    console.error('Error deleting blog content:', error);
    // Don't throw error for deletion failures
  }
}

// Blog media storage functions
export async function uploadBlogMedia(file: File): Promise<string> {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const fileExtension = file.name.split('.').pop();
  const fileName = `${timestamp}-${random}.${fileExtension}`;
  const key = `${R2_ENVIRONMENT}/blog/media/${fileName}`;
  
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: new Uint8Array(await file.arrayBuffer()),
    ContentType: file.type,
    Metadata: {
      type: 'blog-media',
      originalName: file.name,
      uploadTimestamp: timestamp.toString(),
    },
  });

  await r2Client.send(command);
  
  // Return public URL if available, otherwise return API endpoint
  if (R2_PUBLIC_URL) {
    return `${R2_PUBLIC_URL}/${key}`;
  } else {
    return `/api/blog/media?key=${encodeURIComponent(key)}`;
  }
}

export async function getBlogMediaUrl(key: string): Promise<string> {
  // If public URL is configured, return direct URL
  if (R2_PUBLIC_URL) {
    return `${R2_PUBLIC_URL}/${key}`;
  }
  
  // Otherwise return API endpoint
  return `/api/blog/media?key=${encodeURIComponent(key)}`;
}

// Generate a unique blog ID
export function generateBlogId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}