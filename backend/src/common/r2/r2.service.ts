import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
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

  async getPresignedUploadUrl(fileName: string, contentType: string, folder = 'uploads') {
    if (!this.client || !this.bucket) {
      throw new Error('R2 is not configured');
    }
    const ext = fileName.split('.').pop() || 'bin';
    const objectKey = `${folder}/${randomUUID()}.${ext}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: contentType,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: 900 });
    return { uploadUrl: url, objectKey };
  }

  // Large documents upload as several parts in parallel instead of one single-connection PUT --
  // most home/office connections don't fill their available bandwidth on one TCP stream, so
  // splitting a 20-30MB PDF into ~6MB parts sent concurrently noticeably speeds up the upload.
  async createMultipartUpload(fileName: string, contentType: string, folder = 'uploads') {
    if (!this.client || !this.bucket) throw new Error('R2 is not configured');
    const ext = fileName.split('.').pop() || 'bin';
    const objectKey = `${folder}/${randomUUID()}.${ext}`;
    const result = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: objectKey, ContentType: contentType }));
    return { objectKey, uploadId: result.UploadId! };
  }

  async getUploadPartUrl(objectKey: string, uploadId: string, partNumber: number) {
    if (!this.client || !this.bucket) throw new Error('R2 is not configured');
    const command = new UploadPartCommand({ Bucket: this.bucket, Key: objectKey, UploadId: uploadId, PartNumber: partNumber });
    return getSignedUrl(this.client, command, { expiresIn: 900 });
  }

  async completeMultipartUpload(objectKey: string, uploadId: string, parts: { partNumber: number; eTag: string }[]) {
    if (!this.client || !this.bucket) throw new Error('R2 is not configured');
    await this.client.send(new CompleteMultipartUploadCommand({
      Bucket: this.bucket, Key: objectKey, UploadId: uploadId,
      MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.eTag })) },
    }));
  }

  async abortMultipartUpload(objectKey: string, uploadId: string) {
    if (!this.client || !this.bucket) return;
    await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: objectKey, UploadId: uploadId })).catch(() => undefined);
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

  // For public-facing assets (company logo/favicon) that must render in a plain <img> tag with
  // no auth header -- the browser can't send our JWT, and R2's own endpoint requires SigV4
  // auth on every GET unless the bucket has its own public/custom domain configured, which this
  // account doesn't. We fetch the bytes ourselves (server already has authenticated R2 access)
  // and stream them back through our own public route instead.
  async getObject(objectKey: string): Promise<{ body: Buffer; contentType: string } | null> {
    if (!this.client || !this.bucket) return null;
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      const bytes = await result.Body?.transformToByteArray();
      if (!bytes) return null;
      return { body: Buffer.from(bytes), contentType: result.ContentType || 'application/octet-stream' };
    } catch {
      return null;
    }
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

  // Real round trip for the Integrations health check: reach the bucket, write, read back.
  async health() {
    if (!this.client || !this.bucket) return { configured: false, reachable: false, writable: false };
    const started = Date.now();
    const out: { configured: boolean; bucket: string; reachable: boolean; writable: boolean; latencyMs?: number; error?: string } = { configured: true, bucket: this.bucket, reachable: false, writable: false };
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      out.reachable = true;
      const Key = 'health-check/ping.txt';
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key, Body: new Date().toISOString(), ContentType: 'text/plain' }));
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key }));
      out.writable = true;
    } catch (e) {
      out.error = (e as Error).message.slice(0, 300);
    }
    out.latencyMs = Date.now() - started;
    return out;
  }
}
