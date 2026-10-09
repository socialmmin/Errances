import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequireAccess } from '../../common/access/access.service';
import { Audience, BroadcastsService, NewTemplate, VariableSource } from './broadcasts.service';

// Bulk WhatsApp -- the "Bulk WhatsApp" page; only people given that page in their access settings.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireAccess('whatsapp_broadcast')
@Controller('broadcasts')
export class BroadcastsController {
  constructor(private broadcasts: BroadcastsService) {}

  @Get('templates')
  templates() { return this.broadcasts.templates(); }

  @Post('templates')
  createTemplate(@Body() body: NewTemplate) { return this.broadcasts.createTemplate(body); }

  // What a promo template is about (tickets, visa, package, other).
  @Post('templates/service')
  templateService(@Body() body: { templateName: string; service: string }) { return this.broadcasts.setTemplateService(String(body?.templateName || ''), String(body?.service || '')); }

  @Delete('templates/:sid')
  deleteTemplate(@Param('sid') sid: string) { return this.broadcasts.deleteTemplate(sid); }

  @Post('test')
  testSend(@Body() body: { contentSid: string; variables: Record<string, VariableSource>; phone: string; service?: string }) { return this.broadcasts.testSend(body); }

  @Get('test/:sid')
  testStatus(@Param('sid') sid: string) { return this.broadcasts.testStatus(sid); }

  @Get('filters')
  filters() { return this.broadcasts.filters(); }

  @Post('preview')
  preview(@Body() body: { audience: Audience; contentSid?: string }) { return this.broadcasts.preview(body); }

  @Get()
  list() { return this.broadcasts.list(); }

  @Post()
  create(@Body() body: { name: string; contentSid: string; variables: Record<string, VariableSource>; audience: Audience; service?: string }, @Req() req: any) {
    return this.broadcasts.create(body, req.user?.userId ?? null);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.broadcasts.get(id); }

  @Post(':id/pause')
  pause(@Param('id', ParseUUIDPipe) id: string) { return this.broadcasts.setStatus(id, 'pause'); }

  @Post(':id/resume')
  resume(@Param('id', ParseUUIDPipe) id: string) { return this.broadcasts.setStatus(id, 'resume'); }

  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string) { return this.broadcasts.setStatus(id, 'cancel'); }
}
