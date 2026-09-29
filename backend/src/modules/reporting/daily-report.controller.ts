import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
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
  saveSettings(@Body() dto: { phoneNumbers: string[]; sendHour: number; sendMinute: number; enabled: boolean }) {
    return this.service.saveSettings(dto);
  }

  @Get('preview')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  preview() {
    return this.service.preview();
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

  @Post('send-now')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  sendNow() {
    return this.service.sendNow();
  }
}
