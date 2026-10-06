import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, HttpCode, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { MetaService } from './meta.service';
import { MetaCapiService } from './meta-capi.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../../common/rbac/role-permissions';
import { RequireAccess } from '../../../common/access/access.service';
import { WhatsAppBotService } from '../whatsapp/whatsapp-bot.service';

// Public webhook endpoints called directly by Meta (Facebook/Instagram) —
// no JWT auth here. Integrity is instead enforced by:
//  - GET:  hub.verify_token match (set once, in Meta's App Dashboard)
//  - POST: X-Hub-Signature-256 HMAC over the raw body, using META_APP_SECRET
@Controller('integrations/meta')
export class MetaController {
  constructor(
    private metaService: MetaService,
    private capi: MetaCapiService,
    private whatsappBot: WhatsAppBotService,
  ) {}

  @Get('ad-account-summary')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('dashboard.meta_ads')
  getAdAccountSummary() {
    return this.metaService.getAdAccountSummary();
  }

  // ---- Lead quality + conversion feedback ----
  @Get('funnel')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('meta_quality', 'reports')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  funnel() { return this.capi.funnel(); }

  @Get('id-coverage')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('meta_quality', 'reports')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  idCoverage() { return this.capi.idCoverage(); }

  @Post('backfill-ids')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  backfill() { return this.capi.backfillIds(); }

  @Get('capi')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('meta_quality', 'reports')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  capiStatus() { return this.capi.status(); }
  @Get('learning')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('meta_quality', 'reports')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  learning() { return this.capi.learningStatus(); }

  // Per-lead, not aggregate: exactly which lead, which event, our own send status (Meta's
  // HTTP response + trace id at send time -- Meta has no per-event read-receipt API, this
  // is the real confirmation Meta's own endpoint gives us), and a way to retry a failure.
  @Get('capi/events')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('meta_quality', 'reports')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  eventLog(@Query('filter') filter?: 'received' | 'not_received') { return this.capi.eventLog(filter); }

  @Post('capi/events/:eventId/retry')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  retryEvent(@Param('eventId') eventId: string) { return this.capi.retryEvent(eventId); }

  @Post('capi/mode')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  capiMode(@Body() dto: { mode: string; testEventCode?: string; datasetId?: string }) { return this.capi.setMode(dto.mode, dto.testEventCode, dto.datasetId); }

  @Post('capi/test/:leadId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  capiTest(@Param('leadId') leadId: string) { return this.capi.sendTestEvent(leadId); }

  @Patch('lead-quality/:leadId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)
  setQuality(@Param('leadId') leadId: string, @Body() dto: { quality: string | null; lostReason?: string | null }) { return this.capi.setQuality(leadId, dto.quality ?? null, dto.lostReason); }

  @Get('audiences')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('meta_quality', 'reports')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  audiences() { return this.capi.audienceCounts(); }

  @Get('audiences/:segment')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('meta_quality', 'reports')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  async audienceCsv(@Param('segment') segment: string, @Res() res: Response) {
    const csv = await this.capi.audienceCsv(segment);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="errances-voyages-${segment}.csv"`);
    res.send(csv);
  }

  @Get('campaigns')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  getCampaigns() {
    return this.metaService.getCampaigns();
  }

  @Get('campaign-coverage')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAccess('dashboard.coverage', 'packages')
  @RequirePermissions(PERMISSIONS.PACKAGES_VIEW)
  campaignCoverage() {
    return this.metaService.campaignCoverage();
  }

  @Post('sync-leads')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.LEADS_CREATE)
  syncLeads(@Query('days') days?: string) {
    return this.metaService.syncRecentLeads(days ? Number(days) : 2);
  }

  @SkipThrottle()
  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    if (this.metaService.verifySubscription(mode, token)) {
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
    if (!(await this.metaService.verifySignature((req as any).rawBody, signature))) {
      res.status(401).send('Invalid signature');
      return;
    }

    // Acknowledge immediately, then process — Meta expects a fast response
    // and will retry on timeout.
    res.status(200).send('EVENT_RECEIVED');
    Promise.allSettled([
      this.metaService.processWebhookPayload(req.body),
      this.whatsappBot.processWebhookPayload(req.body),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') {
          // eslint-disable-next-line no-console
          console.error('Meta webhook processing failed:', result.reason);
        }
      }
    });
  }
}
