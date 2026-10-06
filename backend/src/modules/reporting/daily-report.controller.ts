import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { DailyReportService } from './daily-report.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('reporting/daily-report')
export class DailyReportController {
  constructor(private service: DailyReportService) {}

  @Get('settings')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  getSettings() {
    return this.service.getSettings();
  }

  @Post('settings')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  saveSettings(@Body() dto: { phoneNumbers: string[]; sendTimes: string[]; enabled: boolean; includedSections?: string[] }) {
    return this.service.saveSettings(dto);
  }

  @Get('preview')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  preview(@Query('sections') sections?: string) {
    return this.service.preview(sections === undefined ? undefined : sections.split(',').filter(Boolean));
  }

  @Get('deliveries')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  deliveries() {
    return this.service.deliveries();
  }

  @Post('send-test')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  sendTest(@Body() dto: { phone: string }) {
    return this.service.sendTest(dto?.phone ?? '');
  }

  @Post('submit-template')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  submitTemplate() {
    return this.service.submitTemplate();
  }

  @Post('sync-template')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  syncTemplate() {
    return this.service.syncTemplateStatus();
  }

  @Post('submit-new-layout')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  submitNewLayout() {
    return this.service.submitNewLayout();
  }

  @Post('sync-new-layout')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  syncNewLayout() {
    return this.service.syncNewLayout();
  }

  // ---- Work reports: MD (whole team) and each employee ----
  @Get('team')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  team() { return this.service.teamReports(); }

  @Post('team/:which/submit')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  submitWork(@Param('which') which: string) { return this.service.submitWorkTemplate(this.which(which)); }

  @Post('team/:which/sync')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  syncWork(@Param('which') which: string) { return this.service.syncWorkTemplate(this.which(which)); }

  @Post('team/employees/:id')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  setEmployee(@Param('id') id: string, @Body() dto: { enabled: boolean }) { return this.service.setEmployeeReport(id, !!dto?.enabled); }

  @Post('team/employees/:id/send')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  sendEmployee(@Param('id') id: string) { return this.service.sendEmployeeReports({ userId: id, triggeredBy: 'manual' }); }

  private which(v: string): 'md' | 'employee' { if (v !== 'md' && v !== 'employee') throw new BadRequestException('Unknown report'); return v; }

  @Post('send-now')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  sendNow() {
    return this.service.sendNow({ triggeredBy: 'manual' });
  }
}
