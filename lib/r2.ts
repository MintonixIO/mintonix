import { S3Client, GetObjectCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { logDebug, logSuccess, logError } from './logger';

// Cloudflare R2 configuration
export const r2Client = new S3Client({
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

export interface UploadedVideo {
  key: string;
  fileName: string;
  size: number;
  uploadedAt: Date;
  userId: string;
  videoId: string;
}

function generateVideoId(): string {
  // Generate a unique video ID
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

function sanitizeFileName(fileName: string): string {
  // Remove or replace problematic characters
  // Keep alphanumeric, dots, hyphens, underscores, and spaces
  // Replace special characters with safe alternatives
  return fileName
    .replace(/\[/g, '(')           // Replace [ with (
    .replace(/\]/g, ')')           // Replace ] with )
    .replace(/[⧸\/\\]/g, '-')      // Replace slashes (including unicode fraction slash) with -
    .replace(/[<>:"|?*]/g, '_')    // Replace other problematic chars with _
    .replace(/\s+/g, ' ')          // Normalize multiple spaces to single space
    .trim();
}

export async function uploadVideo(
  userId: string,
  file: File,
  fileName: string
): Promise<UploadedVideo> {
  const videoId = generateVideoId();

  // Sanitize the filename to remove problematic characters
  const sanitizedFileName = sanitizeFileName(fileName);
  const fileExtension = sanitizedFileName.split('.').pop();
  const key = `${R2_ENVIRONMENT}/${userId}/${videoId}/video.${fileExtension}`;

  logDebug('Starting R2 upload', { key, size: `${(file.size / 1024 / 1024).toFixed(2)} MB` });

  const upload = new Upload({
    client: r2Client,
    params: {
      Bucket: BUCKET_NAME,
      Key: key,
      Body: file.stream(),
      ContentType: file.type,
      Metadata: {
        userId,
        videoId,
        originalName: sanitizedFileName,
        uploadTimestamp: Date.now().toString(),
      },
    },
  });

  try {
    await upload.done();
    logSuccess('R2 upload completed', { key });
  } catch (uploadError) {
    logError('R2 upload failed', { key, error: uploadError });
    throw new Error(`Failed to upload video to R2: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`);
  }

  // Add a delay for R2 consistency - increased to 2 seconds
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Try verification with retries - increased delay between retries
  let verificationResult = { exists: false };
  for (let i = 0; i < 5; i++) {
    verificationResult = await verifyUpload(key);
    if (verificationResult.exists) break;
    await new Promise(resolve => setTimeout(resolve, 1000)); // Increased from 500ms to 1s
  }

  if (!verificationResult.exists) {
    logError('Upload verification failed after 5 retries');
    throw new Error('Upload verification failed - file not found on R2 after upload');
  }

  return {
    key,
    fileName: sanitizedFileName,
    size: file.size,
    uploadedAt: new Date(),
    userId,
    videoId: videoId,
  };
}

export async function verifyUpload(key: string): Promise<{ exists: boolean; size?: number }> {
  try {
    // Try using HeadObject instead of ListObjects for verification
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    // Just try to get the object metadata
    const response = await r2Client.send(command);
    return {
      exists: true,
      size: response.ContentLength
    };
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'name' in error && (error.name === 'NoSuchKey' || ('Code' in error && error.Code === 'NoSuchKey'))) {
      return { exists: false };
    }
    logError('Verification error', error);
    return { exists: false };
  }
}

export async function getUserVideos(userId: string): Promise<UploadedVideo[]> {
  try {
    // Try different possible prefixes for the new structure
    const possiblePrefixes = [
      `${R2_ENVIRONMENT}/${userId}/`, // New structure: dev/[user]/[video id]/
      `${userId}/`, // Legacy structure
      `users/${userId}/videos/`, // Old existing structure
      '', // No prefix - list all
    ];

    let response;

    for (const prefix of possiblePrefixes) {
      try {
        const command = new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          Prefix: prefix,
          MaxKeys: 1000,
        });
        
        response = await r2Client.send(command);
        break;
      } catch {
        continue;
      }
    }

    if (!response) {
      throw new Error('All prefix attempts failed');
    }
    
    // Check if bucket exists but no objects found
    if (!response.Contents || response.Contents.length === 0) {
      return [];
    }

    const videoObjects = response.Contents
      .filter(obj => {
        // Only count actual video files, not analysis files
        const isVideoFile = obj.Key &&
               obj.Size &&
               obj.Size > 0 &&
               !obj.Key.endsWith('/') &&
               (
                 // New structure: dev/{userId}/{videoId}/video.{ext}
                 (obj.Key.startsWith(`${R2_ENVIRONMENT}/${userId}/`) && obj.Key.includes('/video.')) ||
                 // Legacy structure: {userId}/{videoId}/video.{ext}
                 (obj.Key.startsWith(`${userId}/`) && obj.Key.includes('/video.'))
               );

        return isVideoFile;
      });

    // Fetch metadata for each video to get the correct filename
    const videos = await Promise.all(videoObjects.map(async (obj) => {
      const key = obj.Key!;
      let fileName = '';
      let videoId = '';

      // Try to get metadata to find renamed filename
      try {
        const headCommand = new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
        });
        const headResponse = await r2Client.send(headCommand);

        // Use metadata filename if available (metadata keys are normalized to lowercase)
        if (headResponse.Metadata && headResponse.Metadata.originalname) {
          fileName = headResponse.Metadata.originalname;
          logDebug('Found metadata filename', { key, fileName });
        } else {
          logDebug('No metadata originalname found', { key, metadata: headResponse.Metadata });
        }
      } catch (error) {
        logDebug('Could not fetch metadata', { key, error });
      }

      // Extract videoId from key structure
      if (key.startsWith(`${R2_ENVIRONMENT}/${userId}/`) && key.includes('/video.')) {
        // New structure: dev/{userId}/{videoId}/video.{ext}
        const parts = key.split('/');
        videoId = parts[2]; // Third part is videoId
        if (!fileName) {
          fileName = parts[parts.length - 1]; // fallback to video.mp4, video.mov, etc.
        }
      } else if (key.startsWith(`${userId}/`) && key.includes('/video.')) {
        // Legacy structure: {userId}/{videoId}/video.{ext}
        const parts = key.split('/');
        videoId = parts[1]; // Second part is videoId
        if (!fileName) {
          fileName = parts[parts.length - 1]; // fallback to video.mp4, video.mov, etc.
        }
      } else if (key.includes(`users/${userId}/videos/`)) {
        // Old existing structure: users/{userId}/videos/{filename}
        const keyParts = key.split('/');
        const fullFilename = keyParts[keyParts.length - 1];
        const timestampMatch = fullFilename.match(/^(\d+)-(.+)$/);
        if (!fileName) {
          fileName = timestampMatch ? timestampMatch[2] : fullFilename;
        }
        videoId = timestampMatch ? timestampMatch[1] : 'existing';
      } else {
        // Fallback for any other structure
        const keyParts = key.split('/');
        if (!fileName) {
          fileName = keyParts[keyParts.length - 1];
        }
        videoId = 'unknown';
      }

      logDebug('Processed video', { key, fileName, videoId });

      return {
        key,
        fileName,
        size: obj.Size || 0,
        uploadedAt: obj.LastModified || new Date(),
        userId,
        videoId,
      };
    }));

    const sortedVideos = videos.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

    return sortedVideos;

  } catch (error: unknown) {
    logError('Error in getUserVideos', error);

    // For any errors, return empty array to prevent frontend crashes
    return [];
  }
}

export async function getVideoUrl(key: string): Promise<string> {
  // Use the video-stream API endpoint which proxies through our server
  // This avoids CORS issues and works with our Range request implementation
  return `/api/video-stream?key=${encodeURIComponent(key)}`;
}

// Generate signed URL for external access (like Modal service)
export async function getSignedVideoUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  
  // Generate signed URL valid for 1 hour
  const signedUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 });
  return signedUrl;
}

// Future functions for analysis files
export async function uploadAnalysisFile(
  userId: string,
  videoId: string,
  fileName: string,
  content: string | Buffer,
  contentType: string = 'text/csv'
): Promise<void> {
  const key = `${R2_ENVIRONMENT}/${userId}/${videoId}/${fileName}`;
  
  const upload = new Upload({
    client: r2Client,
    params: {
      Bucket: BUCKET_NAME,
      Key: key,
      Body: content,
      ContentType: contentType,
      Metadata: {
        userId,
        videoId,
        fileType: 'analysis',
      },
    },
  });

  await upload.done();
}

export async function getSessionFiles(userId: string, videoId: string): Promise<Array<{
  key: string;
  fileName: string;
  size: number;
  lastModified: Date;
  fileType: 'video' | 'analysis';
}>> {
  try {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: `${R2_ENVIRONMENT}/${userId}/${videoId}/`,
      MaxKeys: 100,
    });

    const response = await r2Client.send(command);
    
    if (!response.Contents) {
      return [];
    }

    return response.Contents
      .filter(obj => obj.Key && obj.Size && obj.Size > 0)
      .map(obj => {
        const key = obj.Key!;
        const fileName = key.split('/').pop()!;
        const fileType: 'video' | 'analysis' = fileName.startsWith('video.') ? 'video' : 'analysis';
        
        return {
          key,
          fileName,
          size: obj.Size || 0,
          lastModified: obj.LastModified || new Date(),
          fileType,
        };
      })
      .sort((a, b) => a.fileName.localeCompare(b.fileName));
  } catch (error) {
    logError('Error getting session files', error);
    return [];
  }
}

// Get file content from R2
export async function getSignedAnalysisUrl(
  userId: string,
  videoId: string,
  fileName: string,
  expiresIn: number = 3600
): Promise<string> {
  const key = `${R2_ENVIRONMENT}/${userId}/${videoId}/${fileName}`;

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const signedUrl = await getSignedUrl(r2Client, command, { expiresIn });
  return signedUrl;
}

export async function getAnalysisFileContent(
  userId: string,
  videoId: string,
  fileName: string
): Promise<string> {
  try {
    const key = `${R2_ENVIRONMENT}/${userId}/${videoId}/${fileName}`;
    
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const response = await r2Client.send(command);
    
    if (!response.Body) {
      throw new Error('No file content found');
    }

    // Convert stream to string
    const chunks: Uint8Array[] = [];
    const reader = response.Body.transformToWebStream().getReader();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    
    const buffer = Buffer.concat(chunks);
    return buffer.toString('utf-8');
  } catch (error) {
    logError('Error reading file', { fileName, error });
    throw error;
  }
}

/**
 * Check analysis progress by verifying existence of output files in R2
 */
export async function checkAnalysisProgress(
  userId: string,
  videoId: string
): Promise<{
  calibration: boolean;
  poseEstimation: boolean;
  shuttleTracking: boolean;
  positionCorrection: boolean;
  visualization: boolean;
  allComplete: boolean;
}> {
  const filesToCheck = [
    { step: 'calibration', file: 'calibration.csv' },
    { step: 'poseEstimation', file: 'pose.json' },
    { step: 'shuttleTracking', file: 'shuttle.json' },
    { step: 'positionCorrection', file: 'corrected_positions.json' },
    { step: 'visualization', file: 'analyzed_video.mp4' },
  ];

  const results: Record<string, boolean> = {
    calibration: false,
    poseEstimation: false,
    shuttleTracking: false,
    positionCorrection: false,
    visualization: false,
  };

  for (const { step, file } of filesToCheck) {
    const key = `${R2_ENVIRONMENT}/${userId}/${videoId}/${file}`;

    try {
      const command = new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });

      await r2Client.send(command);
      results[step] = true;
    } catch {
      // File doesn't exist yet
      results[step] = false;
    }
  }

  const allComplete =
    results.calibration &&
    results.poseEstimation &&
    results.shuttleTracking &&
    results.positionCorrection &&
    results.visualization;

  return {
    calibration: results.calibration,
    poseEstimation: results.poseEstimation,
    shuttleTracking: results.shuttleTracking,
    positionCorrection: results.positionCorrection,
    visualization: results.visualization,
    allComplete
  };
}