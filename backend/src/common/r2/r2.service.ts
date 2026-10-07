import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { Pool } from 'pg';
import { PG_POOL } from '../db/pool.module';

// Largest single file kept in the CRM's own database (built-in storage).
export const BUILT_IN_MAX_BYTES = 100 * 1024 * 1024;

// Thin wrapper around Cloudflare R2 (S3-compatible) for presigned uploads.
// Modeled off hala-audit/backend/src/storage.ts for wiring shape only.
// Without R2 settings, files are kept in the CRM's own database instead ("built-in storage"):
// same object keys and the same calls, with uploads and downloads going through signed,
// expiring links on this API (see BuiltInFilesController) in place of R2's presigned URLs.
@Injectable()
export class R2Service {
  private readonly logger = new Logger(R2Service.name);
  private client: S3Client | null = null;
  private bucket: string | undefined;

  constructor(private config: ConfigService, @Inject(PG_POOL) private pool: Pool) {
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
      this.logger.warn('R2 credentials not set -- files are stored in the CRM database (built-in storage).');
    }
  }

  // File storage is always available: R2 when configured, otherwise built-in.
  isConfigured(): boolean {
    return true;
  }

  isBuiltIn(): boolean {
    return !this.client;
  }

  // ---------------------------------------------------------------- built-in storage links

  private apiBase() {
    return (this.config.get<string>('PUBLIC_API_BASE') || 'https://api-errances.socialmm.in').replace(/\/+$/, '');
  }

  private secret() {
    return this.config.get<string>('JWT_ACCESS_SECRET') || this.config.get<string>('DATABASE_URL') || 'built-in-storage';
  }

  private sign(claims: { k: string; o: 'put' | 'get'; e: number; c?: string }) {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const mac = createHmac('sha256', this.secret()).update(payload).digest('base64url');
    return `${payload}.${mac}`;
  }

  // The object key (and content type for uploads) a built-in link was issued for, or null if the
  // link was altered, has expired, or is for the other operation.
  verifyLink(token: string, op: 'put' | 'get'): { key: string; contentType?: string } | null {
    const [payload, mac] = String(token || '').split('.');
    if (!payload || !mac) return null;
    const expected = Buffer.from(createHmac('sha256', this.secret()).update(payload).digest('base64url'));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
      if (claims.o !== op || typeof claims.k !== 'string' || Number(claims.e) < Date.now()) return null;
      return { key: claims.k, contentType: claims.c };
    } catch {
      return null;
    }
  }

  async putBuiltIn(objectKey: string, body: Buffer, contentType: string) {
    await this.pool.query(
      `INSERT INTO stored_files (object_key, content_type, size, body) VALUES ($1, $2, $3, $4)
       ON CONFLICT (object_key) DO UPDATE SET content_type = $2, size = $3, body = $4, created_at = now()`,
      [objectKey, contentType || 'application/octet-stream', body.length, body],
    );
  }

  private newKey(folder: string, fileName: string) {
    const ext = fileName.split('.').pop() || 'bin';
    return `${folder}/${randomUUID()}.${ext}`;
  }

  // ---------------------------------------------------------------- storage operations

  async getPresignedUploadUrl(fileName: string, contentType: string, folder = 'uploads') {
    const objectKey = this.newKey(folder, fileName);
    if (!this.client || !this.bucket) {
      const token = this.sign({ k: objectKey, o: 'put', e: Date.now() + 15 * 60 * 1000, c: contentType });
      return { uploadUrl: `${this.apiBase()}/api/files/builtin/${token}`, objectKey };
    }
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
    if (!this.client || !this.bucket) throw new Error('Multipart upload needs R2 storage -- upload the file in one piece');
    const objectKey = this.newKey(folder, fileName);
    const result = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: objectKey, ContentType: contentType }));
    return { objectKey, uploadId: result.UploadId! };
  }

  async getUploadPartUrl(objectKey: string, uploadId: string, partNumber: number) {
    if (!this.client || !this.bucket) throw new Error('Multipart upload needs R2 storage');
    const command = new UploadPartCommand({ Bucket: this.bucket, Key: objectKey, UploadId: uploadId, PartNumber: partNumber });
    return getSignedUrl(this.client, command, { expiresIn: 900 });
  }

  async completeMultipartUpload(objectKey: string, uploadId: string, parts: { partNumber: number; eTag: string }[]) {
    if (!this.client || !this.bucket) throw new Error('Multipart upload needs R2 storage');
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
    const objectKey = this.newKey(folder, fileName);
    if (!this.client || !this.bucket) {
      if (buffer.length > BUILT_IN_MAX_BYTES) throw new Error('File is too large to store');
      await this.putBuiltIn(objectKey, buffer, contentType);
      // Not a usable link by itself (callers read the object key back out of it, see
      // WhatsAppBotService.messageMedia); files are fetched through getObject / signed links.
      return { objectKey, url: `${this.apiBase()}/api/files/stored/${objectKey}` };
    }
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
    if (!this.client || !this.bucket) {
      const { rows } = await this.pool.query(`SELECT body, content_type FROM stored_files WHERE object_key = $1`, [objectKey]).catch(() => ({ rows: [] as any[] }));
      return rows[0] ? { body: rows[0].body as Buffer, contentType: rows[0].content_type } : null;
    }
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
    if (!this.client || !this.bucket) {
      const { rows } = await this.pool.query(`SELECT size FROM stored_files WHERE object_key = $1`, [objectKey]).catch(() => ({ rows: [] as any[] }));
      return rows[0]?.size ?? null;
    }
    try { const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey })); return head.ContentLength ?? null; } catch { return null; }
  }

  async getPresignedDownloadUrl(objectKey: string, expiresInSeconds = 300): Promise<string> {
    if (!this.client || !this.bucket) {
      const token = this.sign({ k: objectKey, o: 'get', e: Date.now() + expiresInSeconds * 1000 });
      const name = objectKey.split('/').pop() || 'file';
      return `${this.apiBase()}/api/files/builtin/${token}/${encodeURIComponent(name)}`;
    }
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: objectKey });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async checkReachable(): Promise<boolean> {
    if (!this.client || !this.bucket) return true;
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
    const started = Date.now();
    if (!this.client || !this.bucket) {
      const out: { configured: boolean; builtIn: boolean; bucket: string; reachable: boolean; writable: boolean; latencyMs?: number; error?: string } = { configured: true, builtIn: true, bucket: 'CRM database', reachable: false, writable: false };
      try {
        await this.putBuiltIn('health-check/ping.txt', Buffer.from(new Date().toISOString()), 'text/plain');
        out.reachable = out.writable = !!(await this.getObject('health-check/ping.txt'));
      } catch (e) {
        out.error = (e as Error).message.slice(0, 300);
      }
      out.latencyMs = Date.now() - started;
      return out;
    }
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
