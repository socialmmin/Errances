import { Body, Controller, Delete, ForbiddenException, Get, Inject, Param, Post, Query, Req, Res, HttpCode, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../common/db/pool.module';
import { assertLeadVisible, seesAllLeads } from '../../../common/leads/lead-visibility';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { WhatsAppBotService } from './whatsapp-bot.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../../common/rbac/role-permissions';
import { RequireAccess } from '../../../common/access/access.service';
import { AuditService } from '../../../common/audit/audit.service';

// Public webhook endpoints called directly by Meta for inbound WhatsApp
// messages — shares the same Meta App (and therefore the same
// META_APP_SECRET / META_VERIFY_TOKEN) as the Lead Ads webhook, since both
// products are subscribed under one App in Meta Business Manager.
@Controller('integrations/whatsapp')
export class WhatsAppWebhookController {
  constructor(private bot: WhatsAppBotService, private audit: AuditService, @Inject(PG_POOL) private pool: Pool) {}

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  profile() {
    return this.bot.getBusinessProfile();
  }

  // Public: where a Chat button on an itinerary message lands. Redirects to WhatsApp.
  @Get('chat/:code')
  async chat(@Param('code') code: string, @Res() res: Response) {
    const url = await this.bot.resolveChatLink(code).catch(() => null);
    if (!url) {
      res.status(404).send('This chat link is no longer available.');
      return;
    }
    res.redirect(302, url);
  }

  @Get('health')
  @UseGuards(JwtAuthGuard)
  health() {
    return this.bot.connectionHealth();
  }

  @Post('app-secret')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  saveSecret(@Body() dto: { secret: string }) {
    return this.bot.saveAppSecret(dto?.secret);
  }

  @Get('messages/:leadId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('whatsapp', 'leads')
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)  async messages(@Param('leadId') leadId: string, @Req() req: any) {
    await assertLeadVisible(this.pool, leadId, req.user);
    return this.bot.listMessages(leadId);
  }

  // WhatsApp sends have real external side effects and cost -- a bug or a loop hammering this
  // unthrottled could spam customers and risk Meta throttling/banning the business number. 30/min
  // per IP is generous for a real agent sending messages by hand.
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('messages/send')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('whatsapp', 'leads')
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)  async sendMessage(@Body() dto: { leadId: string; text: string; replyToWaId?: string }, @Req() req: any) {
    await assertLeadVisible(this.pool, dto.leadId, req.user);
return this.bot.sendAgentMessage(dto.leadId, dto.text, req.user?.userId, dto.replyToWaId);
  }

  @Get('inbox-state')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('whatsapp', 'leads')
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)  // Salespeople only get the chats of leads assigned/shared to them.
  inboxState(@Req() req: any) { return this.bot.inboxState(seesAllLeads(req.user) ? undefined : req.user?.userId); }

  @Post('inbox/:leadId/read')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('whatsapp', 'leads')
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)  async markRead(@Param('leadId') leadId: string, @Req() req: any) { await assertLeadVisible(this.pool, leadId, req.user); return this.bot.markChatRead(leadId); }

  @Post('inbox/:leadId/status')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('whatsapp', 'leads')
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)  async setStatus(@Param('leadId') leadId: string, @Body() dto: { status: string }, @Req() req: any) { await assertLeadVisible(this.pool, leadId, req.user); return this.bot.setChatStatus(leadId, dto.status); }

  @Post('inbox/:leadId/reopen')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('whatsapp', 'leads')
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)  async reopen(@Param('leadId') leadId: string, @Req() req: any) { await assertLeadVisible(this.pool, leadId, req.user); return this.bot.reopenChat(leadId); }

  @Get('quick-replies')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('whatsapp', 'leads')
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)
  quickReplies() { return this.bot.listQuickReplies(); }

  @Post('quick-replies')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('whatsapp', 'leads')
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)
  createQuickReply(@Body() dto: { title: string; body: string }, @Req() req: any) { return this.bot.createQuickReply(dto.title, dto.body, req.user?.userId); }

  @Delete('quick-replies/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('whatsapp', 'leads')
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)
  deleteQuickReply(@Param('id') id: string) { return this.bot.deleteQuickReply(id); }

  @Post('messages/:id/star')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('whatsapp', 'leads')
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)  async star(@Param('id') id: string, @Req() req: any) {
    if (!seesAllLeads(req.user)) {
      const { rows } = await this.pool.query(`SELECT lead_id FROM whatsapp_messages WHERE id = $1`, [id]);
      await assertLeadVisible(this.pool, rows[0]?.lead_id, req.user);
    }
    return this.bot.toggleStar(id);
  }

  // Image/PDF/document the agent picked from their own device (already uploaded to
  // R2 via POST /files/upload) -- sent to the customer as a real WhatsApp media message.
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('messages/send-media')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('whatsapp', 'leads')
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)  async sendMedia(@Body() dto: { leadId: string; url: string; filename: string; mimeType: string; caption?: string }, @Req() req: any) {    await assertLeadVisible(this.pool, dto.leadId, req.user);
    return this.bot.sendAgentMedia(dto.leadId, dto.url, dto.filename, dto.mimeType, dto.caption, req.user?.userId);
  }

  // Every currently-failed itinerary send, across every package, in one list --
  // grouped by destination on the frontend -- with why it failed, whose side it's
  // on, and whether retrying can help.
  @Get('failed-sends')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('failed_whatsapp', 'dashboard.failed')
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  failedSends(@Req() req: any) {
    return this.bot.listFailedItineraries(seesAllLeads(req.user) ? undefined : req.user?.userId);
  }

  @Get('messages/:id/media')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('whatsapp', 'leads')
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)
  async messageMedia(@Param('id') id: string, @Req() req: any, @Res() res: Response) {
    const media = await this.bot.messageMedia(id);
    if (!media) { res.status(404).send('Not found'); return; }
    await assertLeadVisible(this.pool, media.leadId, req.user);
    res.setHeader('Content-Type', media.contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(media.body);
  }

  @Get('packages/:id/document-url')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)
  documentUrl(@Param('id') id: string) {
    return this.bot.packageDocumentUrl(id);
  }

  @Get('billing-summary')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('dashboard.wa_billing')
  billingSummary() {
    return this.bot.billingSummary();
  }

  @Get('lead-coverage')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('packages', 'failed_whatsapp')
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  leadCoverage(@Req() req: any) {
    return this.bot.leadCoverage(seesAllLeads(req.user) ? undefined : req.user?.userId);
  }

  @Get('unsent')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('packages', 'failed_whatsapp')
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  // Company-wide backlog tool: only a super admin sees or bulk-sends it.
  unsent(@Req() req: any) {
    if (!seesAllLeads(req.user)) return { data: [], total: 0 };
    return this.bot.listUnsentItineraries();
  }

  // Bulk-trigger endpoints (one call can fan out to hundreds of real WhatsApp sends) -- a tight
  // per-IP limit here is about catching an accidental double-click/retry loop, not normal use.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('unsent/send')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('packages', 'failed_whatsapp')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  async sendUnsent(@Req() req: any) {
    if (!seesAllLeads(req.user)) throw new ForbiddenException('Only a super admin can send itineraries to every unsent lead at once');
    const result = await this.bot.sendUnsentItineraries(req.user?.userId);
    this.audit.log({ userId: req.user?.userId, branchId: req.user?.branchId, action: 'whatsapp.bulk_send_unsent', resourceType: 'whatsapp', result: 'success', detail: result as any });
    return result;
  }

  @Post('failed-sends/manual')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('failed_whatsapp')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  async markManual(@Body() dto: { leadId: string; packageId: string }, @Req() req: any) {
    await assertLeadVisible(this.pool, dto.leadId, req.user);
    return this.bot.markManualItinerary(dto.leadId, dto.packageId, req.user?.userId);
  }

  @Delete('failed-sends/manual/:packageId/:leadId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('failed_whatsapp')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  async unmarkManual(@Param('packageId') packageId: string, @Param('leadId') leadId: string, @Req() req: any) {
    await assertLeadVisible(this.pool, leadId, req.user);
    return this.bot.unmarkManualItinerary(leadId, packageId);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('failed-sends/retry-all')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('failed_whatsapp')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  retryAllFailed(@Req() req: any) {
    return this.bot.retryAllFailedItineraries(req.user?.userId);
  }

  @Get('packages/:id/delivery-status')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('packages')
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  deliveryStatus(@Param('id') id: string) {
    return this.bot.itineraryDeliveryStatus(id);
  }

  @Get('packages/:id/messages')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('packages')
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  packageMessages(@Param('id') id: string) {
    return this.bot.packageMessages(id);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('packages/:id/send-pending')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('packages')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  async sendPending(@Param('id') id: string, @Req() req: any) {
    const result = await this.bot.sendItineraryBacklog(id);
    this.audit.log({ userId: req.user?.userId, branchId: req.user?.branchId, action: 'whatsapp.bulk_send_backlog', resourceType: 'package', resourceId: id, result: 'success', detail: result as any });
    return result;
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('packages/:id/resend/:leadId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('packages', 'failed_whatsapp', 'leads')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  async resend(@Param('id') id: string, @Param('leadId') leadId: string, @Req() req: any) {
    await assertLeadVisible(this.pool, leadId, req.user);
    return this.bot.resendItineraryToLead(id, leadId, req.user?.userId);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('test-itinerary')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('packages')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  testItinerary(@Body() dto: { to: string; packageId: string }) {
    return this.bot.sendTestTemplateItinerary(dto.to, dto.packageId);
  }

  @Post('packages/:id/template/submit')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('packages')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  submitTemplate(@Param('id') id: string) {
    return this.bot.submitItineraryTemplate(id);
  }

  @Post('packages/:id/template/sync')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('packages')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  syncTemplate(@Param('id') id: string) {
    return this.bot.syncItineraryTemplateStatus(id);
  }

  @Post('documents/:docId/template/submit')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('packages')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  submitDocumentTemplate(@Param('docId') docId: string) {
    return this.bot.submitAdditionalDocumentTemplate(docId);
  }

  @Post('documents/:docId/template/sync')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('packages')
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  syncDocumentTemplate(@Param('docId') docId: string) {
    return this.bot.syncAdditionalDocumentTemplateStatus(docId);
  }

  // Meta itself calls these, potentially in bursts during a busy campaign -- exempt from the
  // per-IP throttle (signature verification on the POST body is the real protection here, not
  // request volume).
  @SkipThrottle()
  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    if (this.bot.verifySubscription(mode, token)) {
      res.status(200).send(challenge);
    } else {
      res.status(403).send('Verification failed');
    }
  }

  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  async receive(@Req() req: Request, @Res() res: Response) {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    if (!(await this.bot.verifySignature((req as any).rawBody, signature))) {
      res.status(401).send('Invalid signature');
      return;
    }

    res.status(200).send('EVENT_RECEIVED');
    this.bot.processWebhookPayload(req.body).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('WhatsApp webhook processing failed:', err);
    });
  }
}
