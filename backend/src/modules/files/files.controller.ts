import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { R2Service } from '../../common/r2/r2.service';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
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
  constructor(private r2: R2Service) {}

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
    return { url, objectKey };
  }
}
