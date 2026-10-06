import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';
import { RequireAccess } from '../../common/access/access.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('leads')
export class LeadsController {
  constructor(private leadsService: LeadsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)
  findAll(
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('campaignName') campaignName?: string,
    @Query('noPhone') noPhone?: string,
    @Query('itineraryStatus') itineraryStatus?: 'read' | 'delivered' | 'sent' | 'unconfirmed' | 'failed' | 'none',
    @Query('source') source?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy?: 'lead_date' | 'activity',
    @Query('ids') ids?: string,
    @Req() request?: any,
  ) {
    return this.leadsService.findAll({
      branchId,
      status,
      search,
      campaignName,
      noPhone: noPhone === 'true',
      itineraryStatus,
      source,
      assignedTo,
      dateFrom,
      dateTo,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      sortBy,
      ids: ids ? ids.split(',').filter(Boolean) : undefined,
    }, request?.user);
  }

  @Get('closed')
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)
  closed(@Req() request: any) {
    return this.leadsService.closedWithReasons(request.user);
  }

  @Get('campaigns')
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)
  findCampaigns(@Req() request: any) {
    return this.leadsService.findDistinctCampaigns(request.user);
  }

  @Get('campaign-summary')
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)
  campaignSummary(@Query('campaign') campaign: string, @Req() request: any) {
    return this.leadsService.campaignSummary(campaign, request.user);
  }

  @Get('stats')
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)
  getStats(@Req() request: any) {
    return this.leadsService.getStats(request.user);
  }

  @Post('export')
  @RequireAccess('leads.export')
  @RequirePermissions(PERMISSIONS.LEADS_EXPORT)
  async exportCampaigns(
    @Body() dto: { campaigns: string[]; dateFrom?: string; dateTo?: string; allFiltered?: boolean },
    @Res() response: Response,
    @Req() request: any,
  ) {
    const campaigns = Array.from(new Set((dto.campaigns ?? []).filter(Boolean)));
    if (!campaigns.length && !dto.allFiltered) return response.status(400).json({ message: 'Select at least one campaign' });
    const file = await this.leadsService.exportCampaigns(campaigns, dto.dateFrom, dto.dateTo, request.user);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="Errances-Leads-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    response.send(file);
  }

  @Post('import')
  @RequireAccess('leads.import')
  @RequirePermissions(PERMISSIONS.LEADS_CREATE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  importWorkbook(@UploadedFile() file: any, @Req() request: any) {
    if (!file) return { message: 'Choose an Excel file' };
    return this.leadsService.importWorkbook(file.buffer, request.user?.userId ?? null);
  }

  @Patch('bulk-assign')
  @RequireAccess('leads.assign')
  @RequirePermissions(PERMISSIONS.LEADS_ASSIGN)
  bulkAssign(@Body() dto: { leadIds: string[]; assignedTo: string }, @Req() request: any) {
    return this.leadsService.bulkAssign(dto.leadIds, dto.assignedTo, request?.user?.userId);
  }

  @Patch(':id/collaborators')
  @RequireAccess('leads.assign')
  @RequirePermissions(PERMISSIONS.LEADS_ASSIGN)
  setCollaborators(@Param('id') id: string, @Body() dto: { userIds: string[] }, @Req() request: any) {
    return this.leadsService.setCollaborators(id, dto.userIds, request.user?.userId ?? null);
  }

  @Post(':id/requirements')
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)
  addRequirement(@Param('id') id: string, @Body() dto: CreateRequirementDto, @Req() request: any) {
    return this.leadsService.addRequirement(id, dto, request.user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)
  findOne(@Param('id') id: string, @Req() request: any) {
    // Every other /leads/:id route (update, delete, addRequirement) already passes
    // request.user through to enforce branch/assignment scoping -- this one didn't, so any
    // user with generic "view leads" permission could read any lead by id/url regardless of
    // branch or assignment (findAll scopes correctly; this was the one route that didn't).
    return this.leadsService.findOne(id, request.user);
  }

  @Post()
  @RequireAccess('leads.add')
  @RequirePermissions(PERMISSIONS.LEADS_CREATE)
  create(@Body() dto: CreateLeadDto, @Req() req: any) {
    return this.leadsService.create(dto, req.user?.userId ?? null);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)
  update(@Param('id') id: string, @Body() dto: UpdateLeadDto, @Req() request: any) {
    return this.leadsService.update(id, dto, request.user);
  }

  @Delete(':id')
  @RequireAccess('leads.delete')
  @RequirePermissions(PERMISSIONS.LEADS_DELETE)
  remove(@Param('id') id: string, @Req() request: any) {
    return this.leadsService.remove(id, request.user);
  }
}
