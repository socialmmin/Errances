import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { QuotationsService } from './quotations.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';
import { RequireAccess } from '../../common/access/access.service';
import { BranchAccessService } from '../../common/guards/branch-access.service';
import { AuditService } from '../../common/audit/audit.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireAccess('quotations', 'dashboard.quotations')
@Controller('quotations')
export class QuotationsController {
  constructor(private quotationsService: QuotationsService, private branchAccess: BranchAccessService, private audit: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.QUOTATIONS_VIEW)
  findAll(
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('category') category?: string,
    @Query('destination') destination?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Req() req?: any,
  ) {
    const effectiveBranchId = req?.user?.roleName === 'super_admin' ? branchId : req?.user?.branchId;
    return this.quotationsService.findAll({
      branchId: effectiveBranchId,
      visibleTo: req?.user?.roleName === 'super_admin' ? undefined : req?.user?.userId,
      status,
      search,
      from, to, category, destination,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get('requirements')
  @RequirePermissions(PERMISSIONS.QUOTATIONS_VIEW)
  requirements(@Query('leadId') leadId?: string) {
    if (!leadId || !/^[0-9a-f-]{36}$/i.test(leadId)) return { data: [], next: 1, openRequirement: null };
    return this.quotationsService.requirementsForLead(leadId);
  }

  @Get('stats')
  @RequirePermissions(PERMISSIONS.QUOTATIONS_VIEW)
  stats(@Query('branchId') branchId?: string, @Req() req?: any) {
    const isSuper = req?.user?.roleName === 'super_admin';
    return this.quotationsService.stats(isSuper ? branchId : req?.user?.branchId, isSuper ? undefined : req?.user?.userId);
  }

  @Get('template')
  @RequirePermissions(PERMISSIONS.QUOTATIONS_VIEW)
  getTemplate() {
    return this.quotationsService.getTemplateSettings();
  }

  @Post('template/submit')
  @RequireAccess('quotations')
  @RequirePermissions(PERMISSIONS.QUOTATIONS_EDIT)
  submitTemplate() {
    return this.quotationsService.submitTemplate();
  }

  @Post('template/sync')
  @RequireAccess('quotations')
  @RequirePermissions(PERMISSIONS.QUOTATIONS_EDIT)
  syncTemplate() {
    return this.quotationsService.syncTemplateStatus();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.QUOTATIONS_VIEW)
  async findOne(@Param('id') id: string, @Req() req: any) {
    await this.branchAccess.assertAccess('quotations', id, req.user);
    await this.quotationsService.assertVisible(id, req.user);
    return this.quotationsService.findOne(id);
  }

  @Post()
  @RequireAccess('quotations')
  @RequirePermissions(PERMISSIONS.QUOTATIONS_CREATE)
  create(@Body() dto: CreateQuotationDto, @Req() req: any) {
    return this.quotationsService.create(dto, req.user?.userId ?? null);
  }

  @Patch(':id')
  @RequireAccess('quotations')
  @RequirePermissions(PERMISSIONS.QUOTATIONS_EDIT)
  async update(@Param('id') id: string, @Body() dto: UpdateQuotationDto, @Req() req: any) {
    await this.branchAccess.assertAccess('quotations', id, req.user);
    await this.quotationsService.assertVisible(id, req.user);
    return this.quotationsService.update(id, dto);
  }

  @Patch(':id/status')
  @RequireAccess('quotations')
  @RequirePermissions(PERMISSIONS.QUOTATIONS_EDIT)
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto, @Req() req: any) {
    await this.branchAccess.assertAccess('quotations', id, req.user);
    await this.quotationsService.assertVisible(id, req.user);
    return this.quotationsService.updateStatus(id, dto.status, req.user?.userId ?? null);
  }

  @Post(':id/send-whatsapp')
  @RequireAccess('quotations')
  @RequirePermissions(PERMISSIONS.QUOTATIONS_EDIT)
  async sendWhatsApp(@Param('id') id: string, @Body() body: { text?: string; edited?: boolean }, @Req() req: any) {
    await this.branchAccess.assertAccess('quotations', id, req.user);
    await this.quotationsService.assertVisible(id, req.user);
    return this.quotationsService.sendViaWhatsApp(id, req.user?.userId ?? null, typeof body?.text === 'string' ? body.text : undefined, body?.edited !== false);
  }

  @Delete(':id')
  @RequireAccess('quotations')
  @RequirePermissions(PERMISSIONS.QUOTATIONS_DELETE)
  async remove(@Param('id') id: string, @Req() req: any) {
    await this.branchAccess.assertAccess('quotations', id, req.user);
    await this.quotationsService.assertVisible(id, req.user);
    const result = await this.quotationsService.remove(id);
    this.audit.log({ userId: req.user?.userId, branchId: req.user?.branchId, action: 'quotation.deleted', resourceType: 'quotation', resourceId: id, result: 'success' });
    return result;
  }
}
