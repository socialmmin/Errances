import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';
import { CreateWhatsAppTemplateDto } from './dto/create-whatsapp-template.dto';
import { UpdateWhatsAppTemplateDto } from './dto/update-whatsapp-template.dto';
import { SaveWhatsAppConfigDto } from './dto/save-whatsapp-config.dto';
import { TwilioWhatsAppService } from '../integrations/whatsapp/twilio-whatsapp.service';

// Templates + message logs + a write-only API config placeholder for the
// Settings > WhatsApp module, ported from hala-audit's whatsapp.tsx.
// No real WhatsApp Business API integration is wired up here — the config
// endpoint stores whether it's configured, never echoes the token back.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('whatsapp')
export class WhatsAppController {
  constructor(@Inject(PG_POOL) private pool: Pool, private twilio: TwilioWhatsAppService) {}

  @Get('templates')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  async findTemplates() {
    const { rows } = await this.pool.query(
      `SELECT * FROM whatsapp_templates WHERE is_deleted = false ORDER BY created_at DESC`,
    );
    return { data: rows, total: rows.length };
  }

  @Post('templates')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  async createTemplate(@Body() dto: CreateWhatsAppTemplateDto, @Req() req: any) {
    const { rows } = await this.pool.query(
      `INSERT INTO whatsapp_templates (name, body_template, is_active, branch_id, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [dto.name, dto.bodyTemplate, dto.isActive ?? true, req.user?.branchId ?? null, req.user?.userId ?? null],
    );
    return rows[0];
  }

  @Patch('templates/:id')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  async updateTemplate(@Param('id') id: string, @Body() dto: UpdateWhatsAppTemplateDto) {
    const sets: string[] = [];
    const args: any[] = [];
    if (dto.name !== undefined) { args.push(dto.name); sets.push(`name = $${args.length}`); }
    if (dto.bodyTemplate !== undefined) { args.push(dto.bodyTemplate); sets.push(`body_template = $${args.length}`); }
    if (dto.isActive !== undefined) { args.push(dto.isActive); sets.push(`is_active = $${args.length}`); }
    if (!sets.length) {
      const { rows } = await this.pool.query(`SELECT * FROM whatsapp_templates WHERE id = $1`, [id]);
      return rows[0] || null;
    }
    args.push(id);
    const { rows } = await this.pool.query(
      `UPDATE whatsapp_templates SET ${sets.join(', ')}, updated_at = now() WHERE id = $${args.length} AND is_deleted = false RETURNING *`,
      args,
    );
    return rows[0] || null;
  }

  @Delete('templates/:id')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  async removeTemplate(@Param('id') id: string) {
    const { rows } = await this.pool.query(
      `UPDATE whatsapp_templates SET is_deleted = true, updated_at = now() WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows[0] || null;
  }

  // The Itinerary Delivery Status page only ever shows message_type='itinerary'
  // rows -- this used to pull the 500 most recent rows of EVERY message type
  // (welcome templates, agent replies, everything), so on a busy day that cap
  // filled up with non-itinerary traffic before older itinerary attempts ever
  // got included, making the page's own "Total" undercount real activity.
  // Filtering server-side means the limit only ever eats into itinerary rows.
  @Get('logs')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  async findLogs() {
    const { rows } = await this.pool.query(
      `SELECT wl.id,wl.to_number,wl.template_name,wl.status,wl.sent_at,wl.created_at,wl.message_id,
              wl.message_type,wl.error_message,wl.lead_id,wl.package_id,tp.name AS package_name,
              l.customer_name,l.lead_number,COALESCE(l.campaign_name, tp.campaign_name) AS campaign_name
         FROM whatsapp_logs wl LEFT JOIN tour_packages tp ON tp.id=wl.package_id
         LEFT JOIN leads l ON l.id=wl.lead_id
         WHERE wl.is_deleted = false AND wl.message_type = 'itinerary' ORDER BY wl.created_at DESC LIMIT 5000`,
    );
    return { data: rows, total: rows.length };
  }

  // Message volumes by Meta conversation category, priced at the rates the team
  // enters below (from their real Meta invoice -- this app never invents a rate).
  @Get('usage-summary')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  async usageSummary() {
    const { rows: rates } = await this.pool.query(`SELECT category, price_inr FROM whatsapp_rates`);
    const rateMap: Record<string, number> = Object.fromEntries(rates.map((r: any) => [r.category, Number(r.price_inr)]));
    // Every template this app creates is submitted to Meta as category MARKETING (see
    // whatsapp-bot.service.ts). Utility and Authentication (OTP) templates are not used
    // anywhere in this system, so those counts are honestly 0, not estimated.
    // Scoped to itinerary sends only -- the separate Lead Ads welcome-message
    // automation (message_type='template') is reported on the Leads side, not
    // counted here, so this only reflects itinerary campaign activity.
    const { rows: templateRows } = await this.pool.query(
      `SELECT count(*)::int AS n FROM whatsapp_logs WHERE is_deleted = false AND message_type = 'itinerary' AND status IN ('accepted','sent','delivered','read')`,
    );
    const { rows: serviceRows } = await this.pool.query(
      `SELECT count(*)::int AS n FROM whatsapp_messages WHERE direction = 'out'`,
    );
    const marketing = templateRows[0]?.n ?? 0;
    const service = serviceRows[0]?.n ?? 0;
    const categories = [
      { category: 'MARKETING', label: 'Marketing (itinerary documents sent to leads)', count: marketing, priceInr: rateMap.MARKETING ?? 0 },
      { category: 'UTILITY', label: 'Utility templates', count: 0, priceInr: rateMap.UTILITY ?? 0 },
      { category: 'AUTHENTICATION', label: 'Authentication (OTP)', count: 0, priceInr: rateMap.AUTHENTICATION ?? 0 },
      { category: 'SERVICE', label: 'Service replies (agent messages, no template)', count: service, priceInr: rateMap.SERVICE ?? 0 },
    ].map((c) => ({ ...c, subtotalInr: Math.round(c.count * c.priceInr * 100) / 100 }));
    return {
      categories,
      totalMessages: categories.reduce((sum, c) => sum + c.count, 0),
      totalSpentInr: Math.round(categories.reduce((sum, c) => sum + c.subtotalInr, 0) * 100) / 100,
      ratesSet: rates.some((r: any) => Number(r.price_inr) > 0),
    };
  }

  @Patch('rates')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  async updateRates(@Body() dto: { rates: { category: string; priceInr: number }[] }, @Req() req: any) {
    const allowed = ['MARKETING', 'UTILITY', 'AUTHENTICATION', 'SERVICE'];
    for (const row of dto?.rates ?? []) {
      if (!allowed.includes(row.category)) continue;
      const price = Number(row.priceInr);
      if (!Number.isFinite(price) || price < 0) continue;
      await this.pool.query(
        `UPDATE whatsapp_rates SET price_inr = $2, updated_at = now(), updated_by = $3 WHERE category = $1`,
        [row.category, price, req.user?.userId ?? null],
      );
    }
    return { ok: true };
  }

  @Get('automation')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  async getAutomation() {
    const { rows } = await this.pool.query(`SELECT live_mode,test_numbers,updated_at FROM whatsapp_automation_settings WHERE id=true`);
    return rows[0] || { live_mode: false, test_numbers: [] };
  }

  @Patch('automation')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  async updateAutomation(@Body() dto: { liveMode?: boolean; testNumbers?: string[] }, @Req() req: any) {
    const numbers = dto.testNumbers?.map((value) => {
      const digits = String(value).replace(/\D/g, '');
      return digits.length === 10 ? `91${digits}` : digits;
    }).filter(Boolean);
    const { rows } = await this.pool.query(
      `UPDATE whatsapp_automation_settings SET live_mode=COALESCE($1,live_mode),
       test_numbers=COALESCE($2,test_numbers),updated_at=now(),updated_by=$3 WHERE id=true
       RETURNING live_mode,test_numbers,updated_at`,
      [dto.liveMode ?? null, numbers ?? null, req.user?.userId ?? null],
    );
    return rows[0];
  }

  // Any signed-in user: the Inbox enables its Send button from this, and it holds nothing secret.
  @Get('config')
  async getConfig() {
    if (this.twilio.isConfigured()) {
      return { provider: 'twilio', sender: this.twilio.from.replace('whatsapp:', ''), phone_number_id: null, business_account_id: null, is_configured: true, configured_at: null };
    }
    const { rows } = await this.pool.query(
      `SELECT phone_number_id, business_account_id, is_configured, configured_at FROM whatsapp_config ORDER BY created_at DESC LIMIT 1`,
    );
    // Never returns access_token_encrypted -- write-only by design.
    return rows[0] || { phone_number_id: null, business_account_id: null, is_configured: false, configured_at: null };
  }

  @Post('config')
  @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  async saveConfig(@Body() dto: SaveWhatsAppConfigDto, @Req() req: any) {
    // Placeholder "stored in vault" write: real encryption/secret-manager
    // integration is out of scope, but the token is never echoed back in
    // any response from this point on.
    await this.pool.query(
      `INSERT INTO whatsapp_config (phone_number_id, business_account_id, access_token_encrypted, is_configured, configured_at, configured_by)
       VALUES ($1,$2,$3,true,now(),$4)`,
      [dto.phoneNumberId, dto.businessAccountId ?? null, dto.accessToken, req.user?.userId ?? null],
    );
    return { is_configured: true };
  }
}
