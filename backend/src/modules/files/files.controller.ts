import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { R2Service } from '../../common/r2/r2.service';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequireAccess } from '../../common/access/access.service';

// SVG deliberately excluded -- unlike a raster image, an SVG can carry embedded <script>/event
// handlers, which is a stored-XSS risk anywhere it's later rendered inline rather than just
// downloaded (e.g. the company logo/favicon). Nothing in this CRM actually requires SVG uploads.
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/x-icon'];
const DOCUMENT_TYPES = [
  'application/pdf', 'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];
const ACCEPTED_TYPES = [...IMAGE_TYPES, ...DOCUMENT_TYPES];

// WhatsApp Cloud API's own media limits (not an arbitrary choice of ours):
// images must be under 5MB, documents (PDF/Word/Excel/PPT) under 100MB.
// The upload interceptor's limit is set to the larger of the two; the
// per-type check below enforces the tighter image limit.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(private r2: R2Service, @Inject(PG_POOL) private pool: Pool) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  async upload(@UploadedFile() file: any, @Body('folder') folder?: string) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ACCEPTED_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Only PDF, Word, Excel, PowerPoint, text or image files are allowed');
    }
    const isImage = IMAGE_TYPES.includes(file.mimetype);
    const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
    if (file.size > maxBytes) {
      throw new BadRequestException(isImage ? 'Image must be under 5MB' : 'Document must be under 100MB');
    }
    const safeFolder = (folder || 'uploads').replace(/[^a-zA-Z0-9/_-]/g, '');
    const { url, objectKey } = await this.r2.uploadBuffer(
      file.buffer,
      safeFolder,
      file.originalname,
      file.mimetype,
    );
    // R2 has no public bucket/custom domain configured, so `url` (R2's own endpoint) requires
    // SigV4 auth on every GET -- a plain <img src> can never load it. Branding images specifically
    // need a permanent, unauthenticated, embeddable URL (login page, browser tab, sidebar, while
    // logged out too), so hand back our own public streaming route for those instead.
    const publicUrl = safeFolder.startsWith('company-branding') ? `/api/files/public/${objectKey}` : url;
    return { url, objectKey, publicUrl };
  }

  // For large documents (itinerary PDFs), routing bytes through this server first -- browser to
  // VPS, then VPS to R2 -- doubles the transfer time and is bounded by the VPS's own outbound
  // bandwidth, which is far more limited than R2's edge network. This hands back a presigned R2
  // PUT url instead, so the browser uploads directly to R2 with only one hop.
  @Post('presign-upload')
  async presignUpload(@Body('fileName') fileName?: string, @Body('contentType') contentType?: string, @Body('folder') folder?: string) {
    if (!fileName || !contentType) throw new BadRequestException('fileName and contentType required');
    if (!ACCEPTED_TYPES.includes(contentType)) {
      throw new BadRequestException('Only PDF, Word, Excel, PowerPoint, text or image files are allowed');
    }
    const safeFolder = (folder || 'uploads').replace(/[^a-zA-Z0-9/_-]/g, '');
    const { uploadUrl, objectKey } = await this.r2.getPresignedUploadUrl(fileName, contentType, safeFolder);
    return { uploadUrl, objectKey };
  }

  // Multipart: large files upload as several parts in parallel from the browser instead of one
  // single-connection PUT (see R2Service.createMultipartUpload for why).
  @Post('multipart/create')
  async multipartCreate(@Body('fileName') fileName?: string, @Body('contentType') contentType?: string, @Body('folder') folder?: string) {
    if (!fileName || !contentType) throw new BadRequestException('fileName and contentType required');
    if (!ACCEPTED_TYPES.includes(contentType)) {
      throw new BadRequestException('Only PDF, Word, Excel, PowerPoint, text or image files are allowed');
    }
    const safeFolder = (folder || 'uploads').replace(/[^a-zA-Z0-9/_-]/g, '');
    return this.r2.createMultipartUpload(fileName, contentType, safeFolder);
  }

  @Post('multipart/part-url')
  async multipartPartUrl(@Body('objectKey') objectKey?: string, @Body('uploadId') uploadId?: string, @Body('partNumber') partNumber?: number) {
    if (!objectKey || !uploadId || !partNumber) throw new BadRequestException('objectKey, uploadId and partNumber required');
    const url = await this.r2.getUploadPartUrl(objectKey, uploadId, partNumber);
    return { url };
  }

  @Post('multipart/complete')
  async multipartComplete(@Body('objectKey') objectKey?: string, @Body('uploadId') uploadId?: string, @Body('parts') parts?: { partNumber: number; eTag: string }[]) {
    if (!objectKey || !uploadId || !parts?.length) throw new BadRequestException('objectKey, uploadId and parts required');
    await this.r2.completeMultipartUpload(objectKey, uploadId, parts);
    return { objectKey };
  }

  @Post('multipart/abort')
  async multipartAbort(@Body('objectKey') objectKey?: string, @Body('uploadId') uploadId?: string) {
    if (objectKey && uploadId) await this.r2.abortMultipartUpload(objectKey, uploadId);
    return { ok: true };
  }

  // A short-lived viewing link for a package itinerary document, so a quick "does this PDF still
  // look right?" doesn't need a download-then-open round trip. Deliberately NOT a link to any key
  // in the bucket: customer documents (passports etc.) live there too, so the key must be a
  // registered itinerary document and the caller must have Packages access.
  @Get('presign-download')
  @UseGuards(PermissionsGuard)
  @RequireAccess('packages', 'failed_whatsapp')
  async presignDownload(@Query('objectKey') objectKey?: string) {
    if (!objectKey) throw new BadRequestException('objectKey required');
    const inItineraryFolder = /^packages\/itineraries\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/i.test(objectKey);
    const { rows } = inItineraryFolder ? { rows: [1] } : await this.pool.query(
      `SELECT 1 FROM tour_packages WHERE $1 IN (itinerary_pdf_object_key, itinerary_pdf_object_key_2)
       UNION ALL SELECT 1 FROM package_itinerary_documents WHERE object_key = $1 LIMIT 1`, [objectKey]);
    if (!rows.length) throw new ForbiddenException('This file is not an itinerary document');
    const url = await this.r2.getPresignedDownloadUrl(objectKey, 300);
    return { url };
  }
}

// Deliberately its own controller, outside FilesController's class-level JwtAuthGuard: the
// login page and browser tab favicon must render before anyone signs in. Deliberately
// restricted to the one folder branding images live in -- never a general-purpose open proxy
// to every private document in the bucket.
@Controller('files/public')
export class PublicFilesController {
  constructor(private r2: R2Service) {}

  @Get(':folder/:file')
  async servePublic(@Param('folder') folder: string, @Param('file') file: string, @Res() res: Response) {
    if (folder !== 'company-branding') throw new NotFoundException();
    const objectKey = `${folder}/${file}`;
    const object = await this.r2.getObject(objectKey);
    if (!object) throw new NotFoundException();
    res.setHeader('Content-Type', object.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    // The app and the API are on different addresses; without these the browser refuses to show
    // the logo (the default policy only allows the API's own pages to embed it).
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(object.body);
  }
}
