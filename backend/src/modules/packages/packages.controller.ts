import { BadRequestException, Body, Controller, StreamableFile, Delete, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { PackagesService } from './packages.service';
import { CreatePackageDto } from './dto/create-package.dto';
import { UpdatePackageDto } from './dto/update-package.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';
import { RequireAccess } from '../../common/access/access.service';
import { R2Service } from '../../common/r2/r2.service';
import { PackagesRepository } from './packages.repository';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

const run = promisify(execFile);

const PRESET_KINDS = ['name', 'number', 'button', 'message', 'setup', 'reply', 'link'];

@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireAccess('packages', 'quotations', 'failed_whatsapp')
@Controller('packages')
export class PackagesController {
  constructor(private packagesService: PackagesService, private r2: R2Service, private repo: PackagesRepository, @Inject(PG_POOL) private pool: Pool) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  findAll(
    @Query('branchId') branchId?: string,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('isTemplate') isTemplate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.packagesService.findAll({
      branchId,
      search,
      type,
      isTemplate: isTemplate === undefined ? undefined : isTemplate === 'true',
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  // The cover picture used to exist only if someone had opened a package's edit page and
  // saved it (the browser rendered it). Any itinerary without one showed a blank icon in the
  // Inbox. Now the server builds it from the PDF the first time anyone needs it, and keeps it.
  private thumbJobs = new Map<string, Promise<{ dataUrl: string | null }>>();

  @Get(':id/thumbnail')
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  async getThumbnail(@Param('id') id: string) {
    const existing = await this.repo.getThumbnail(id);
    if (existing.dataUrl) return existing;
    let job = this.thumbJobs.get(id);
    if (!job) {
      job = this.buildThumbnail(id).finally(() => this.thumbJobs.delete(id));
      this.thumbJobs.set(id, job);
    }
    return job;
  }

  private async buildThumbnail(id: string): Promise<{ dataUrl: string | null }> {
    const key = await this.repo.getPdfObjectKey(id);
    if (!key || !this.r2.isConfigured()) return { dataUrl: null };
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'thumb-'));
    try {
      const res = await fetch(await this.r2.getPresignedDownloadUrl(key, 300));
      if (!res.ok) return { dataUrl: null };
      const pdf = path.join(dir, 'in.pdf');
      await fsp.writeFile(pdf, Buffer.from(await res.arrayBuffer()));
      await run('pdftoppm', ['-jpeg', '-jpegopt', 'quality=82', '-f', '1', '-l', '1', '-scale-to-x', '420', '-scale-to-y', '-1', '-singlefile', pdf, path.join(dir, 'cover')], { timeout: 30000 });
      const img = await fsp.readFile(path.join(dir, 'cover.jpg'));
      const dataUrl = `data:image/jpeg;base64,${img.toString('base64')}`;
      if (dataUrl.length > 600000) return { dataUrl: null };
      await this.repo.saveThumbnail(id, dataUrl);
      return { dataUrl };
    } catch {
      return { dataUrl: null };
    } finally {
      fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  @Post(':id/thumbnail')
  @RequireAccess('packages')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  saveThumbnail(@Param('id') id: string, @Body() dto: { dataUrl: string }) {
    const dataUrl = String(dto?.dataUrl || '');
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl) || dataUrl.length > 600000) throw new BadRequestException('Invalid thumbnail');
    return this.repo.saveThumbnail(id, dataUrl);
  }

  @Get('presets')
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  listPresets() {
    return this.repo.listPresets();
  }

  @Post('presets')
  @RequireAccess('packages')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  addPreset(@Body() dto: { kind: string; value: string }) {
    const value = String(dto?.value || '').trim();
    if (!PRESET_KINDS.includes(dto?.kind) || !value) throw new BadRequestException('Invalid preset');
    return this.repo.addPreset(dto.kind, value.slice(0, 1500));
  }

  @Patch('presets/:presetId')
  @RequireAccess('packages')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  updatePreset(@Param('presetId') presetId: string, @Body() dto: { value: string }) {
    const value = String(dto?.value || '').trim();
    if (!value) throw new BadRequestException('Value required');
    return this.repo.updatePreset(presetId, value.slice(0, 1500));
  }

  @Delete('presets/:presetId')
  @RequireAccess('packages')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  deletePreset(@Param('presetId') presetId: string) {
    return this.repo.deletePreset(presetId);
  }

  // objectKey used to be presigned/fetched with no check it actually belongs to a package --
  // any logged-in user with packages:view could read ANY file ever uploaded to R2 under any
  // module (invoices, employee documents, company branding, WhatsApp media) just by knowing or
  // guessing its key. Now the key must actually match a real itinerary file before it's served.
  private async assertIsPackageDocument(objectKey: string) {
    // Just uploaded in the itinerary form but not saved yet: still an itinerary file (random,
    // unguessable name in the itinerary folder), so it can be previewed.
    if (/^packages\/itineraries\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/i.test(objectKey)) return;
    const { rows } = await this.pool.query(
      `SELECT 1 FROM tour_packages WHERE itinerary_pdf_object_key = $1 AND is_deleted = false
       UNION ALL
       SELECT 1 FROM package_itinerary_documents WHERE object_key = $1
       LIMIT 1`,
      [objectKey],
    );
    if (!rows[0]) throw new BadRequestException('Not a recognized itinerary document');
  }

  // Serves the stored itinerary file through the API so the browser can render
  // its first page (direct storage URLs are blocked by CORS for fetch()).
  @Get('document-file')
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  async documentFile(@Query('objectKey') objectKey?: string) {
    if (!objectKey) throw new BadRequestException('objectKey required');
    await this.assertIsPackageDocument(objectKey);
    const url = await this.r2.getPresignedDownloadUrl(objectKey, 300);
    const response = await fetch(url);
    if (!response.ok) throw new BadRequestException('Could not read the document');
    return new StreamableFile(Buffer.from(await response.arrayBuffer()), { type: response.headers.get('content-type') || 'application/octet-stream' });
  }

  @Get('document-preview')
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  async documentPreview(@Query('objectKey') objectKey?: string) {
    if (!objectKey) return { url: null };
    await this.assertIsPackageDocument(objectKey);
    return { url: await this.r2.getPresignedDownloadUrl(objectKey, 900) };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  findOne(@Param('id') id: string) {
    return this.packagesService.findOne(id);
  }

  @Post()
  @RequireAccess('packages')
  @RequirePermissions(PERMISSIONS.PACKAGES_CREATE)
  create(@Body() dto: CreatePackageDto, @Req() req: any) {
    return this.packagesService.create(dto, req.user?.userId ?? null);
  }

  @Patch(':id')
  @RequireAccess('packages')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  update(@Param('id') id: string, @Body() dto: UpdatePackageDto) {
    return this.packagesService.update(id, dto);
  }

  @Delete(':id')
  @RequireAccess('packages')
  @RequirePermissions(PERMISSIONS.PACKAGES_DELETE)
  remove(@Param('id') id: string) {
    return this.packagesService.remove(id);
  }

  // Additional itinerary documents ("Add another") -- no fixed limit, each one is its own
  // WhatsApp template since Meta allows only one document attachment per template.
  @Get(':id/documents')
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  listDocuments(@Param('id') id: string) {
    return this.repo.listDocuments(id);
  }

  @Post(':id/documents')
  @RequireAccess('packages')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  addDocument(@Param('id') id: string, @Body() dto: { durationDays?: number; durationNights?: number; objectKey: string; fileName: string }) {
    if (!dto.objectKey) throw new BadRequestException('Upload the document first');
    // Nights is what the WhatsApp "Explore More Itineraries" duration list is built from --
    // a document saved without it can never be offered to a customer, so block it here too
    // (not just in the UI), the same rule for any caller.
    if (dto.durationNights === undefined || dto.durationNights === null) throw new BadRequestException('Nights is required for an additional itinerary document');
    return this.repo.addDocument(id, dto);
  }

  @Patch(':id/documents/:docId')
  @RequireAccess('packages')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  updateDocument(@Param('docId') docId: string, @Body() dto: { durationDays?: number; durationNights?: number }) {
    return this.repo.updateDocumentDuration(docId, dto.durationDays, dto.durationNights);
  }

  @Delete(':id/documents/:docId')
  @RequireAccess('packages')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  removeDocument(@Param('docId') docId: string) {
    return this.repo.deleteDocument(docId);
  }
}
