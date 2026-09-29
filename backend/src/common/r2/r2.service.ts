import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

// Thin wrapper around Cloudflare R2 (S3-compatible) for presigned uploads.
// Modeled off hala-audit/backend/src/storage.ts for wiring shape only.
// Degrades gracefully: if R2 env vars are unset, isConfigured() is false and
// callers should surface a clear "storage not configured" response instead
// of throwing on module boot.
@Injectable()
export class R2Service {
  private readonly logger = new Logger(R2Service.name);
  private client: S3Client | null = null;
  private bucket: string | undefined;

  constructor(private config: ConfigService) {
    const endpoint = this.config.get<string>('R2_ENDPOINT');
    const accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY');
    this.bucket = this.config.get<string>('R2_BUCKET');

    if (endpoint && accessKeyId && secretAccessKey && this.bucket) {
      this.client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
      });
    } else {
      this.logger.warn('R2 credentials not fully configured — file storage is disabled.');
    }
  }

  isConfigured(): boolean {
    return !!this.client;
  }

  async getPresignedUploadUrl(fileName: string, contentType: string) {
    if (!this.client || !this.bucket) {
      throw new Error('R2 is not configured');
    }
    const objectKey = `uploads/${randomUUID()}-${fileName}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: contentType,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: 900 });
    return { uploadUrl: url, objectKey };
  }

  async uploadBuffer(buffer: Buffer, folder: string, fileName: string, contentType: string) {
    if (!this.client || !this.bucket) {
      throw new Error('R2 is not configured');
    }
    const ext = fileName.split('.').pop() || 'bin';
    const objectKey = `${folder}/${randomUUID()}.${ext}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    const publicUrl = this.config.get<string>('R2_PUBLIC_URL');
    const endpoint = this.config.get<string>('R2_ENDPOINT');
    const url = publicUrl
      ? `${publicUrl.replace(/\/$/, '')}/${objectKey}`
      : `${(endpoint ?? '').replace(/\/$/, '')}/${this.bucket}/${objectKey}`;
    return { objectKey, url };
  }

  async objectSize(objectKey: string): Promise<number | null> {
    if (!this.client || !this.bucket) return null;
    try { const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey })); return head.ContentLength ?? null; } catch { return null; }
  }

  async getPresignedDownloadUrl(objectKey: string, expiresInSeconds = 300): Promise<string> {
    if (!this.client || !this.bucket) {
      throw new Error('R2 is not configured');
    }
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: objectKey });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async checkReachable(): Promise<boolean> {
    if (!this.client || !this.bucket) return false;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch (e) {
      this.logger.warn(`R2 not reachable: ${(e as Error).message}`);
      return false;
    }
  }
}
