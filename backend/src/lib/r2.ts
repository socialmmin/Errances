import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { config, isR2Configured } from '../config.js';

let client: S3Client | null = null;

function getClient(): S3Client {
    if (!client) {
        client = new S3Client({
            region: 'auto',
            endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: config.r2.accessKeyId,
                secretAccessKey: config.r2.secretAccessKey,
            },
        });
    }
    return client;
}

/** Uploads a buffer to R2 and returns its public URL, or null if R2 isn't configured. */
export async function uploadToR2(buffer: Buffer, contentType: string, prefix = 'uploads'): Promise<string | null> {
    if (!isR2Configured()) return null;

    const ext = contentType.split('/')[1] || 'bin';
    const key = `${prefix}/${randomUUID()}.${ext}`;

    await getClient().send(
        new PutObjectCommand({
            Bucket: config.r2.bucket,
            Key: key,
            Body: buffer,
            ContentType: contentType,
        })
    );

    const base = config.r2.publicUrl.replace(/\/$/, '');
    return `${base}/${key}`;
}
