export interface UploadProgress {
  uploadedBytes: number;
  totalBytes: number;
  percentage: number;
  uploadSpeed: number; // bytes per second
  estimatedTimeRemaining: number; // seconds
  currentPart?: number;
  totalParts?: number;
}

export interface UploadOptions {
  onProgress?: (progress: UploadProgress) => void;
  onError?: (error: Error) => void;
  signal?: AbortSignal; // For cancellation
}

export class VideoUploadManager {
  private file: File;
  private userId: string;
  private uploadInfo: any;
  private abortController: AbortController;
  private startTime: number = 0;
  private uploadedBytes: number = 0;
  private parts: Array<{ ETag: string; PartNumber: number }> = [];

  constructor(file: File, userId: string) {
    this.file = file;
    this.userId = userId;
    this.abortController = new AbortController();
  }

  async initialize(): Promise<void> {
    const response = await fetch('/api/init-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: this.userId,
        fileName: this.file.name,
        fileSize: this.file.size,
        fileType: this.file.type,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to initialize upload');
    }

    const data = await response.json();
    this.uploadInfo = data.uploadInfo;
  }

  async upload(options: UploadOptions = {}): Promise<string> {
    this.startTime = Date.now();

    if (!this.uploadInfo) {
      throw new Error('Upload not initialized. Call initialize() first.');
    }

    try {
      if (this.uploadInfo.isMultipart) {
        return await this.uploadMultipart(options);
      } else {
        return await this.uploadSingle(options);
      }
    } catch (error) {
      // Abort upload on error
      await this.abort();
      throw error;
    }
  }

  private async uploadSingle(options: UploadOptions): Promise<string> {
    const url = this.uploadInfo.urls[0];

    const xhr = new XMLHttpRequest();

    // Track progress
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        this.uploadedBytes = e.loaded;
        const progress = this.calculateProgress(e.loaded, this.file.size);
        options.onProgress?.(progress);
      }
    });

    // Handle completion
    const uploadPromise = new Promise<void>((resolve, reject) => {
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Network error during upload'));
      });

      xhr.addEventListener('abort', () => {
        reject(new Error('Upload cancelled'));
      });
    });

    // Handle cancellation
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        xhr.abort();
      });
    }

    // Start upload
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', this.file.type);
    xhr.send(this.file);

    await uploadPromise;

    return this.uploadInfo.videoId;
  }

  private async uploadMultipart(options: UploadOptions): Promise<string> {
    const { urls, partSize, totalParts } = this.uploadInfo;
    this.parts = [];

    // Upload parts in parallel (limit concurrency to 3)
    const concurrency = 3;
    let currentPart = 0;

    while (currentPart < totalParts!) {
      const batch: Promise<void>[] = [];

      for (let i = 0; i < concurrency && currentPart < totalParts!; i++, currentPart++) {
        const partNumber = currentPart + 1;
        const start = currentPart * partSize!;
        const end = Math.min(start + partSize!, this.file.size);
        const blob = this.file.slice(start, end);

        batch.push(this.uploadPart(urls[currentPart], blob, partNumber, options));
      }

      await Promise.all(batch);
    }

    return this.uploadInfo.videoId;
  }

  private async uploadPart(
    url: string,
    blob: Blob,
    partNumber: number,
    options: UploadOptions
  ): Promise<void> {
    const xhr = new XMLHttpRequest();
    let partUploadedBytes = 0;

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const delta = e.loaded - partUploadedBytes;
        this.uploadedBytes += delta;
        partUploadedBytes = e.loaded;

        const progress = this.calculateProgress(this.uploadedBytes, this.file.size);
        progress.currentPart = partNumber;
        progress.totalParts = this.uploadInfo.totalParts;

        options.onProgress?.(progress);
      }
    });

    const uploadPromise = new Promise<string>((resolve, reject) => {
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const etag = xhr.getResponseHeader('ETag');
          if (etag) {
            resolve(etag.replace(/"/g, '')); // Remove quotes from ETag
          } else {
            reject(new Error('No ETag in response'));
          }
        } else {
          reject(new Error(`Part ${partNumber} upload failed with status ${xhr.status}`));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error(`Network error uploading part ${partNumber}`));
      });

      xhr.addEventListener('abort', () => {
        reject(new Error('Upload cancelled'));
      });
    });

    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        xhr.abort();
      });
    }

    xhr.open('PUT', url);
    xhr.send(blob);

    const etag = await uploadPromise;
    this.parts.push({ ETag: etag, PartNumber: partNumber });
  }

  private calculateProgress(uploadedBytes: number, totalBytes: number): UploadProgress {
    const percentage = Math.round((uploadedBytes / totalBytes) * 100);
    const elapsedTime = (Date.now() - this.startTime) / 1000; // seconds
    const uploadSpeed = elapsedTime > 0 ? uploadedBytes / elapsedTime : 0;
    const remainingBytes = totalBytes - uploadedBytes;
    const estimatedTimeRemaining = uploadSpeed > 0 ? remainingBytes / uploadSpeed : 0;

    return {
      uploadedBytes,
      totalBytes,
      percentage,
      uploadSpeed,
      estimatedTimeRemaining,
    };
  }

  async complete(thumbnail?: string): Promise<any> {
    const response = await fetch('/api/complete-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: this.userId,
        videoId: this.uploadInfo.videoId,
        r2Key: this.uploadInfo.r2Key,
        uploadId: this.uploadInfo.uploadId,
        parts: this.uploadInfo.isMultipart ? this.parts : undefined,
        thumbnail,
        isMultipart: this.uploadInfo.isMultipart,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to complete upload');
    }

    return response.json();
  }

  async abort(): Promise<void> {
    this.abortController.abort();

    if (this.uploadInfo) {
      await fetch('/api/abort-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: this.uploadInfo.videoId,
          r2Key: this.uploadInfo.r2Key,
          uploadId: this.uploadInfo.uploadId,
          isMultipart: this.uploadInfo.isMultipart,
        }),
      });
    }
  }

  getVideoId(): string | null {
    return this.uploadInfo?.videoId || null;
  }
}
