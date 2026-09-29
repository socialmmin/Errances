import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { createHmac, timingSafeEqual } from 'crypto';
import { PG_POOL } from '../../../common/db/pool.module';
import { LeadsService } from '../../leads/leads.service';
import { CreateLeadDto } from '../../leads/dto/create-lead.dto';
import { RealtimeGateway } from '../../../common/realtime/realtime.gateway';
import { WhatsAppBotService } from '../whatsapp/whatsapp-bot.service';
import { PushService } from '../../../common/push/push.service';

interface MetaFieldDatum {
  name: string;
  values: string[];
}

interface MetaLeadgenValue {
  leadgen_id: string;
  form_id?: string;
  ad_id?: string;
  page_id?: string;
  created_time?: number;
}

@Injectable()
export class MetaService implements OnModuleInit {
  private logger = new Logger('MetaService');
  private syncRunning = false;
  private lastAdAlert = '';

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private config: ConfigService,
    private leadsService: LeadsService,
    private realtime: RealtimeGateway,
    private whatsappBot: WhatsAppBotService,
    private push: PushService,
  ) {}

  onModuleInit() {
    // Webhooks remain the fast path. This small polling fallback recovers any
    // events Meta could not deliver and is safe because leadgen_id is unique.
    setTimeout(() => this.syncRecentLeads().catch(() => undefined), 15_000);
    setInterval(() => this.syncRecentLeads().catch(() => undefined), 5 * 60_000);
    setTimeout(() => this.checkAdAccountAlerts().catch(() => undefined), 20_000);
    setInterval(() => this.checkAdAccountAlerts().catch(() => undefined), 15 * 60_000);
  }

  private async checkAdAccountAlerts() {
    const summary: any = await this.getAdAccountSummary();
    const key = !summary.connected ? 'unavailable' : summary.accountStatus !== 1 ? `status:${summary.accountStatus}` : summary.warningLevel;
    if (key === 'healthy') { this.lastAdAlert = ''; return; }
    if (key === this.lastAdAlert) return;
    this.lastAdAlert = key;
    const title = summary.warningLevel === 'critical' ? 'Critical: Meta Ads balance is low' : 'Meta Ads campaign alert';
    const body = !summary.connected ? 'The CRM cannot read the Meta Ads account.' :
      summary.accountStatus !== 1 ? 'The Meta ad account is not active. Check Ads Manager now.' :
      `Only ₹${Number(summary.balance || 0).toLocaleString('en-IN')} remains. Recharge to prevent campaigns from stopping.`;
    await this.push.notifyUsers([], { title, body, url: '/dashboard' }, true);
  }

  async syncRecentLeads(days = 2) {
    if (this.syncRunning) return { imported: 0, skipped: 0, message: 'Sync already running' };
    const pageId = this.config.get<string>('META_PAGE_ID');
    const accessToken = this.config.get<string>('META_PAGE_ACCESS_TOKEN');
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v23.0';
    if (!pageId || !accessToken) throw new Error('Meta Page integration is not configured');

    this.syncRunning = true;
    const since = Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000;
    let imported = 0;
    let skipped = 0;
    try {
      const formsUrl = new URL(`https://graph.facebook.com/${version}/${pageId}/leadgen_forms`);
      formsUrl.searchParams.set('fields', 'id,name,status');
      formsUrl.searchParams.set('limit', '100');
      formsUrl.searchParams.set('access_token', accessToken);
      const formsRes = await fetch(formsUrl);
      if (!formsRes.ok) throw new Error(`Could not list Meta forms: ${formsRes.status} ${await formsRes.text()}`);
      const forms = ((await formsRes.json()) as any)?.data ?? [];

      for (const form of forms) {
        let next: string | undefined = `https://graph.facebook.com/${version}/${form.id}/leads?fields=id,created_time&limit=100&access_token=${encodeURIComponent(accessToken)}`;
        while (next) {
          const leadsRes = await fetch(next);
          if (!leadsRes.ok) {
            this.logger.warn(`Could not list leads for form ${form.id}: ${leadsRes.status} ${await leadsRes.text()}`);
            break;
          }
          const page = (await leadsRes.json()) as any;
          let reachedOlderLead = false;
          for (const item of page.data ?? []) {
            const createdAt = item.created_time ? new Date(item.created_time).getTime() : Date.now();
            if (createdAt < since) {
              reachedOlderLead = true;
              continue;
            }
            const before = await this.pool.query(`SELECT 1 FROM meta_lead_events WHERE leadgen_id = $1`, [item.id]);
            if (before.rowCount) {
              skipped++;
              continue;
            }
            await this.processLeadgenEvent({ leadgen_id: item.id, form_id: form.id });
            imported++;
          }
          next = reachedOlderLead ? undefined : page?.paging?.next;
        }
      }
      this.logger.log(`Meta recovery sync completed: ${imported} imported, ${skipped} already present`);
      return { imported, skipped };
    } finally {
      this.syncRunning = false;
    }
  }

  verifySubscription(mode?: string, token?: string): boolean {
    const expected = this.config.get<string>('META_VERIFY_TOKEN');
    return mode === 'subscribe' && !!expected && token === expected;
  }

  async getAdAccountSummary() {
    const accessToken = this.config.get<string>('META_SYSTEM_USER_ACCESS_TOKEN');
    const accountId = this.config.get<string>('META_AD_ACCOUNT_ID');
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v23.0';
    if (!accessToken || !accountId) {
      return { connected: false, message: 'Meta Ads integration is not configured' };
    }

    const request = async (path: string, params: Record<string, string>) => {
      const query = new URLSearchParams({ ...params, access_token: accessToken });
      const response = await fetch(`https://graph.facebook.com/${version}/${path}?${query}`);
      if (!response.ok) throw new Error(`Meta Ads API ${response.status}: ${await response.text()}`);
      return response.json() as Promise<any>;
    };

    try {
      const [account, insights] = await Promise.all([
        request(accountId, {
          fields: 'id,name,account_status,currency,balance,amount_spent,spend_cap,disable_reason',
        }),
        request(`${accountId}/insights`, {
          fields: 'spend,impressions,clicks',
          date_preset: 'today',
          level: 'account',
        }),
      ]);
      const money = (value: unknown) => Number(value || 0) / 100;
      const amountSpent = money(account.amount_spent);
      const spendCap = money(account.spend_cap);
      // This is a prepaid ad account. Meta's generic `balance` field is not
      // the wallet amount displayed in Billing Hub; available funds are the
      // funded spend cap less lifetime spend.
      const balance = Math.max(spendCap - amountSpent, 0);
      const warningLevel = balance <= 500 ? 'critical' : balance <= 1000 ? 'low' : 'healthy';
      const today = insights?.data?.[0] ?? {};
      return {
        connected: true,
        accountId: account.id,
        accountName: account.name,
        accountStatus: Number(account.account_status),
        currency: account.currency,
        balance,
        amountSpent,
        spendCap,
        todaySpend: Number(today.spend || 0),
        todayImpressions: Number(today.impressions || 0),
        todayClicks: Number(today.clicks || 0),
        warningLevel,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Could not fetch Meta ad account summary: ${error}`);
      return { connected: false, message: 'Could not read the Meta Ads account' };
    }
  }

  async getCampaigns() {
    const accessToken = this.config.get<string>('META_SYSTEM_USER_ACCESS_TOKEN');
    const configuredAccount = this.config.get<string>('META_AD_ACCOUNT_ID');
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v23.0';
    if (!accessToken || !configuredAccount) throw new Error('Meta Ads integration is not configured');
    const accountId = configuredAccount.startsWith('act_') ? configuredAccount : `act_${configuredAccount}`;
    const url = new URL(`https://graph.facebook.com/${version}/${accountId}/campaigns`);
    url.searchParams.set('fields', 'id,name,status,effective_status,objective,created_time,updated_time');
    url.searchParams.set('limit', '200');
    url.searchParams.set('access_token', accessToken);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not list Meta campaigns: ${response.status} ${await response.text()}`);
    const payload = await response.json() as any;
    return { data: payload.data ?? [], updatedAt: new Date().toISOString() };
  }

  // Real ad spend, no itinerary ready to send: the exact gap the user found by
  // accident (10 campaigns running, only 9 templates covering them). Compares
  // live Meta campaigns against tour_packages the same way the Campaign Mapping
  // tab does, but surfaced as an alert instead of something someone has to
  // remember to check for.
  async campaignCoverage() {
    const [{ data: campaigns }, { rows: packages }] = await Promise.all([
      this.getCampaigns().catch(() => ({ data: [] as any[] })),
      this.pool.query(`SELECT campaign_name, is_active, whatsapp_template_status, itinerary_pdf_object_key FROM tour_packages WHERE is_deleted = false AND campaign_name IS NOT NULL AND campaign_name <> ''`),
    ]);
    const byCampaign = new Map(packages.map((p: any) => [p.campaign_name, p]));
    const active = campaigns.filter((c: any) => (c.effective_status || c.status) === 'ACTIVE');
    const gaps = active
      .map((c: any) => {
        const pkg = byCampaign.get(c.name);
        if (!pkg) return { id: c.id, name: c.name, reason: 'no_itinerary_mapped' };
        if (!pkg.itinerary_pdf_object_key) return { id: c.id, name: c.name, reason: 'no_itinerary_mapped' };
        if (pkg.whatsapp_template_status !== 'APPROVED') return { id: c.id, name: c.name, reason: 'template_not_approved' };
        if (!pkg.is_active) return { id: c.id, name: c.name, reason: 'itinerary_inactive' };
        return null;
      })
      .filter((g): g is { id: string; name: string; reason: string } => !!g);
    return {
      activeCampaigns: active.length,
      covered: active.length - gaps.length,
      gaps,
    };
  }

  async verifySignature(rawBody: Buffer | undefined, signatureHeader: string | undefined): Promise<boolean> {
    if (!rawBody || !signatureHeader) return false;
    const { rows } = await this.pool.query(`SELECT app_secret FROM whatsapp_config WHERE is_configured = true ORDER BY created_at DESC LIMIT 1`).catch(() => ({ rows: [] as any[] }));
    const secrets = [rows[0]?.app_secret, this.config.get<string>('META_APP_SECRET')].filter((v): v is string => !!v && !!v.trim());
    const providedBuf = Buffer.from(signatureHeader.replace(/^sha256=/, ''), 'hex');
    for (const secret of secrets) {
      const expectedBuf = createHmac('sha256', secret).update(rawBody).digest();
      if (expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf)) return true;
    }
    return false;
  }

  async processWebhookPayload(body: any): Promise<void> {
    const entries = body?.entry ?? [];
    for (const entry of entries) {
      const changes = entry?.changes ?? [];
      for (const change of changes) {
        if (change?.field !== 'leadgen') continue;
        await this.processLeadgenEvent(change.value as MetaLeadgenValue);
      }
    }
  }

  private async processLeadgenEvent(value: MetaLeadgenValue) {
    const leadgenId = value?.leadgen_id;
    if (!leadgenId) return;

    const { rows: existing } = await this.pool.query(
      `SELECT id FROM meta_lead_events WHERE leadgen_id = $1`,
      [leadgenId],
    );
    if (existing.length > 0) {
      this.logger.log(`Skipping already-processed leadgen_id ${leadgenId}`);
      return;
    }

    const details = await this.fetchLeadDetails(leadgenId);
    if (!details) return;

    const branchId = await this.getDefaultBranchId();
    if (!branchId) {
      this.logger.error('No active branch found — cannot create lead from Meta webhook');
      return;
    }

    const fields = this.mapFieldData(details.field_data ?? []);
    const formAnswers = Object.fromEntries(
      (details.field_data ?? []).map((field) => [field.name, field.values?.join(', ') ?? '']),
    );
    const leadDate = details.created_time ? new Date(details.created_time) : new Date();

    const dto: CreateLeadDto = {
      customerName: fields.name || 'Facebook Lead',
      phone: fields.phone,
      email: fields.email,
      source: 'meta_ads',
      priority: 'hot',
      status: 'new',
      remarks: `${this.platformLabel(details.platform)} Lead Ad${details.ad_name ? ` "${details.ad_name}"` : ''}${
        details.form_name ? ` — form "${details.form_name}"` : ''
      }`,
      destination: this.extractDestination(details.campaign_name),
      campaignName: details.campaign_name,
      adName: details.ad_name,
      leadMonth: leadDate.getMonth() + 1,
      leadYear: leadDate.getFullYear(),
      metaAttribution: {
        leadgen_id: value.leadgen_id,
        ad_id: details.ad_id,
        form_id: details.form_id,
        campaign_id: details.campaign_id,
        adset_name: details.adset_name,
        platform: details.platform,
      },
      branchId,
    };
    // A person may submit more than one form or Meta may issue a new leadgen
    // id for the same contact. Keep one CRM lead per phone number and attach
    // every Meta event to that existing lead.
    const existingLead = fields.phone
      ? await this.leadsService.findByContactNumber(fields.phone)
      : null;
    const lead = existingLead
      ? await this.leadsService.update(existingLead.id, {
          customerName: fields.name || existingLead.customer_name,
          phone: fields.phone,
          email: fields.email || existingLead.email,
          destination: dto.destination || existingLead.destination,
          campaignName: details.campaign_name || existingLead.campaign_name,
          adName: details.ad_name || existingLead.ad_name,
          leadMonth: dto.leadMonth,
          leadYear: dto.leadYear,
          metaAttribution: dto.metaAttribution,
        })
      : await this.leadsService.create(dto, null);

    await this.pool.query(
      `INSERT INTO lead_requirements
        (lead_id, destination, campaign_name, ad_name, form_name, meta_leadgen_id, source, attribution, answers, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'meta_ads', $7, $8, $9)
       ON CONFLICT (meta_leadgen_id) DO NOTHING`,
      [
        lead.id,
        dto.destination ?? null,
        details.campaign_name ?? null,
        details.ad_name ?? null,
        details.form_name ?? null,
        leadgenId,
        JSON.stringify(dto.metaAttribution),
        JSON.stringify(formAnswers),
        leadDate,
      ],
    );

    await this.pool.query(
      `INSERT INTO meta_lead_events (leadgen_id, lead_id, form_name, ad_name, raw_payload)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (leadgen_id) DO NOTHING`,
      [leadgenId, lead.id, details.form_name ?? null, details.ad_name ?? null, JSON.stringify(details)],
    );

    // Keep Meta's own ids on the lead itself so reports and the feedback to Meta can name the exact ad.
    await this.pool.query(
      `UPDATE leads SET meta_leadgen_id = COALESCE(meta_leadgen_id, $2), meta_campaign_id = COALESCE(meta_campaign_id, $3), meta_adset_id = COALESCE(meta_adset_id, $4),
              meta_adset_name = COALESCE(meta_adset_name, $5), meta_ad_id = COALESCE(meta_ad_id, $6), meta_form_id = COALESCE(meta_form_id, $7), meta_form_name = COALESCE(meta_form_name, $8)
        WHERE id = $1`,
      [lead.id, leadgenId, (details as any).campaign_id ?? null, (details as any).adset_id ?? null, (details as any).adset_name ?? null, (details as any).ad_id ?? value?.ad_id ?? null, (details as any).form_id ?? value?.form_id ?? null, details.form_name ?? null],
    ).catch((err) => this.logger.warn(`Could not store Meta ids on lead ${lead.id}: ${err.message}`));

    // Every newly processed Meta form submission is actionable, even when the
    // phone number already belongs to an existing CRM profile. Keep the single
    // profile, but alert staff about the new requirement/campaign enquiry.
    this.realtime.broadcastNewLead({
      ...lead,
      is_new_profile: !existingLead,
      destination: dto.destination ?? lead.destination ?? null,
      campaign_name: details.campaign_name ?? null,
    });
    if (fields.phone) {
      await this.whatsappBot.sendLeadWelcomeTemplate(
        fields.phone,
        fields.name || 'Traveller',
        dto.destination || 'your preferred destination',
        lead.id,
      ).catch((err) => this.logger.error(`Could not send WhatsApp lead welcome: ${err.message}`));
    }
    this.logger.log(`${existingLead ? 'Updated' : 'Created'} lead ${lead.id} from Meta leadgen_id ${leadgenId}`);
  }

  private async fetchLeadDetails(leadgenId: string) {
    const accessToken = this.config.get<string>('META_PAGE_ACCESS_TOKEN');
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    if (!accessToken) {
      this.logger.error('META_PAGE_ACCESS_TOKEN is not configured — cannot fetch lead details');
      return null;
    }

    // form_name is not a valid field on the Lead object in current Graph API
    // versions. Requesting it makes Meta reject the whole lead lookup. Fetch
    // the form name separately from the returned form_id instead.
    const url = `https://graph.facebook.com/${version}/${leadgenId}?fields=field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,created_time&access_token=${accessToken}`;
    const res = await fetch(url);
    if (!res.ok) {
      this.logger.error(`Graph API fetch failed for leadgen_id ${leadgenId}: ${res.status} ${await res.text()}`);
      return null;
    }
    const details = (await res.json()) as {
      field_data: MetaFieldDatum[];
      ad_id?: string;
      ad_name?: string;
      adset_name?: string;
      campaign_id?: string;
      campaign_name?: string;
      form_id?: string;
      form_name?: string;
      created_time?: string;
      platform?: string;
    };

    // Platform is fetched separately so an older Graph version that does not
    // expose this optional field cannot break the full lead import.
    const platformUrl = `https://graph.facebook.com/${version}/${leadgenId}?fields=platform&access_token=${accessToken}`;
    const platformRes = await fetch(platformUrl);
    if (platformRes.ok) {
      const platformData = (await platformRes.json()) as { platform?: string };
      details.platform = platformData.platform;
    }

    if (details.form_id) {
      const formUrl = `https://graph.facebook.com/${version}/${details.form_id}?fields=name&access_token=${accessToken}`;
      const formRes = await fetch(formUrl);
      if (formRes.ok) {
        const form = (await formRes.json()) as { name?: string };
        details.form_name = form.name;
      } else {
        this.logger.warn(`Could not fetch form name for form_id ${details.form_id}: ${formRes.status}`);
      }
    }

    return details;
  }

  private platformLabel(platform?: string) {
    const normalized = String(platform || '').toLowerCase();
    if (normalized === 'ig' || normalized.includes('instagram')) return 'Instagram';
    if (normalized === 'fb' || normalized.includes('facebook')) return 'Facebook';
    return 'Meta';
  }

  private mapFieldData(fieldData: MetaFieldDatum[]) {
    const byName: Record<string, string> = {};
    for (const f of fieldData) {
      byName[f.name.toLowerCase()] = f.values?.[0] ?? '';
    }

    const find = (patterns: RegExp[]) => {
      for (const [key, val] of Object.entries(byName)) {
        if (patterns.some((p) => p.test(key))) return val;
      }
      return undefined;
    };

    const firstName = find([/^first_name$/]);
    const lastName = find([/^last_name$/]);
    const fullName = find([/full_name/, /^name$/]) || [firstName, lastName].filter(Boolean).join(' ') || undefined;

    return {
      name: fullName,
      phone: find([/phone/]),
      email: find([/email/]),
    };
  }

  // Campaign names follow "SMM <Destination> – High Intent Traveller – Sep 2026"
  // (or "SocialMM – <Destination> – ..."). Strips the common prefix/suffix to
  // get a clean destination for the lead's destination field/filters.
  private extractDestination(campaignName?: string): string | undefined {
    if (!campaignName) return undefined;
    let s = campaignName.replace(/^(SMM|SocialMM)\s*[-–]?\s*/i, '').trim();
    s = s.split(/[-–]/)[0].trim();
    return s || undefined;
  }

  private async getDefaultBranchId(): Promise<string | null> {
    const configured = this.config.get<string>('META_DEFAULT_BRANCH_ID');
    if (configured) return configured;
    const { rows } = await this.pool.query(
      `SELECT id FROM branches WHERE is_active = true ORDER BY created_at ASC LIMIT 1`,
    );
    return rows[0]?.id ?? null;
  }
}
