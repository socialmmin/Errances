import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res, HttpCode, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { WhatsAppBotService } from './whatsapp-bot.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../../common/rbac/role-permissions';

// Public webhook endpoints called directly by Meta for inbound WhatsApp
// messages — shares the same Meta App (and therefore the same
// META_APP_SECRET / META_VERIFY_TOKEN) as the Lead Ads webhook, since both
// products are subscribed under one App in Meta Business Manager.
@Controller('integrations/whatsapp')
export class WhatsAppWebhookController {
  constructor(private bot: WhatsAppBotService) {}

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
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)
  messages(@Param('leadId') leadId: string) {
    return this.bot.listMessages(leadId);
  }

  @Post('messages/send')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)
  sendMessage(@Body() dto: { leadId: string; text: string; replyToWaId?: string }, @Req() req: any) {
    return this.bot.sendAgentMessage(dto.leadId, dto.text, req.user?.userId, dto.replyToWaId);
  }

  @Get('inbox-state')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)
  inboxState() { return this.bot.inboxState(); }

  @Post('inbox/:leadId/read')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)
  markRead(@Param('leadId') leadId: string) { return this.bot.markChatRead(leadId); }

  @Post('inbox/:leadId/status')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)
  setStatus(@Param('leadId') leadId: string, @Body() dto: { status: string }) { return this.bot.setChatStatus(leadId, dto.status); }

  @Post('inbox/:leadId/reopen')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)
  reopen(@Param('leadId') leadId: string) { return this.bot.reopenChat(leadId); }

  @Get('quick-replies')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)
  quickReplies() { return this.bot.listQuickReplies(); }

  @Post('quick-replies')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)
  createQuickReply(@Body() dto: { title: string; body: string }, @Req() req: any) { return this.bot.createQuickReply(dto.title, dto.body, req.user?.userId); }

  @Delete('quick-replies/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)
  deleteQuickReply(@Param('id') id: string) { return this.bot.deleteQuickReply(id); }

  @Post('messages/:id/star')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)
  star(@Param('id') id: string) { return this.bot.toggleStar(id); }

  // Image/PDF/document the agent picked from their own device (already uploaded to
  // R2 via POST /files/upload) -- sent to the customer as a real WhatsApp media message.
  @Post('messages/send-media')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)
  sendMedia(@Body() dto: { leadId: string; url: string; filename: string; mimeType: string; caption?: string }, @Req() req: any) {
    return this.bot.sendAgentMedia(dto.leadId, dto.url, dto.filename, dto.mimeType, dto.caption, req.user?.userId);
  }

  // Every currently-failed itinerary send, across every package, in one list --
  // grouped by destination on the frontend -- with why it failed, whose side it's
  // on, and whether retrying can help.
  @Get('failed-sends')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  failedSends() {
    return this.bot.listFailedItineraries();
  }

  @Get('packages/:id/document-url')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)
  documentUrl(@Param('id') id: string) {
    return this.bot.packageDocumentUrl(id);
  }

  @Get('billing-summary')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  billingSummary() {
    return this.bot.billingSummary();
  }

  @Get('lead-coverage')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  leadCoverage() {
    return this.bot.leadCoverage();
  }

  @Get('unsent')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  unsent() {
    return this.bot.listUnsentItineraries();
  }

  @Post('unsent/send')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  sendUnsent(@Req() req: any) {
    return this.bot.sendUnsentItineraries(req.user?.userId);
  }

  @Post('failed-sends/manual')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  markManual(@Body() dto: { leadId: string; packageId: string }, @Req() req: any) {
    return this.bot.markManualItinerary(dto.leadId, dto.packageId, req.user?.userId);
  }

  @Delete('failed-sends/manual/:packageId/:leadId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  unmarkManual(@Param('packageId') packageId: string, @Param('leadId') leadId: string) {
    return this.bot.unmarkManualItinerary(leadId, packageId);
  }

  @Post('failed-sends/retry-all')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  retryAllFailed(@Req() req: any) {
    return this.bot.retryAllFailedItineraries(req.user?.userId);
  }

  @Get('packages/:id/delivery-status')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  deliveryStatus(@Param('id') id: string) {
    return this.bot.itineraryDeliveryStatus(id);
  }

  @Get('packages/:id/messages')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  packageMessages(@Param('id') id: string) {
    return this.bot.packageMessages(id);
  }

  @Post('packages/:id/send-pending')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  sendPending(@Param('id') id: string) {
    return this.bot.sendItineraryBacklog(id);
  }

  @Post('packages/:id/resend/:leadId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  resend(@Param('id') id: string, @Param('leadId') leadId: string, @Req() req: any) {
    return this.bot.resendItineraryToLead(id, leadId, req.user?.userId);
  }

  @Post('test-itinerary')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  testItinerary(@Body() dto: { to: string; packageId: string }) {
    return this.bot.sendTestTemplateItinerary(dto.to, dto.packageId);
  }

  @Post('packages/:id/template/submit')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  submitTemplate(@Param('id') id: string) {
    return this.bot.submitItineraryTemplate(id);
  }

  @Post('packages/:id/template/sync')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PACKAGES_EDIT)
  syncTemplate(@Param('id') id: string) {
    return this.bot.syncItineraryTemplateStatus(id);
  }

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
