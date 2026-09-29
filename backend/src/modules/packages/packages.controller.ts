import { BadRequestException, Body, Controller, StreamableFile, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { PackagesService } from './packages.service';
import { CreatePackageDto } from './dto/create-package.dto';
import { UpdatePackageDto } from './dto/update-package.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';
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
@Controller('packages')
export class PackagesController {
  constructor(private packagesService: PackagesService, private r2: R2Service, private repo: PackagesRepository) {}

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
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  addPreset(@Body() dto: { kind: string; value: string }) {
    const value = String(dto?.value || '').trim();
    if (!PRESET_KINDS.includes(dto?.kind) || !value) throw new BadRequestException('Invalid preset');
    return this.repo.addPreset(dto.kind, value.slice(0, 1500));
  }

  @Patch('presets/:presetId')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  updatePreset(@Param('presetId') presetId: string, @Body() dto: { value: string }) {
    const value = String(dto?.value || '').trim();
    if (!value) throw new BadRequestException('Value required');
    return this.repo.updatePreset(presetId, value.slice(0, 1500));
  }

  @Delete('presets/:presetId')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  deletePreset(@Param('presetId') presetId: string) {
    return this.repo.deletePreset(presetId);
  }

  // Serves the stored itinerary file through the API so the browser can render
  // its first page (direct storage URLs are blocked by CORS for fetch()).
  @Get('document-file')
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  async documentFile(@Query('objectKey') objectKey?: string) {
    if (!objectKey) throw new BadRequestException('objectKey required');
    const url = await this.r2.getPresignedDownloadUrl(objectKey, 300);
    const response = await fetch(url);
    if (!response.ok) throw new BadRequestException('Could not read the document');
    return new StreamableFile(Buffer.from(await response.arrayBuffer()), { type: response.headers.get('content-type') || 'application/octet-stream' });
  }

  @Get('document-preview')
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  async documentPreview(@Query('objectKey') objectKey?: string) {
    if (!objectKey) return { url: null };
    return { url: await this.r2.getPresignedDownloadUrl(objectKey, 900) };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  findOne(@Param('id') id: string) {
    return this.packagesService.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PACKAGES_CREATE)
  create(@Body() dto: CreatePackageDto, @Req() req: any) {
    return this.packagesService.create(dto, req.user?.userId ?? null);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  update(@Param('id') id: string, @Body() dto: UpdatePackageDto) {
    return this.packagesService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PACKAGES_DELETE)
  remove(@Param('id') id: string) {
    return this.packagesService.remove(id);
  }
}
