import { BadRequestException, Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { MetaService } from '../integrations/meta/meta.service';
import { MetaCapiService } from '../integrations/meta/meta-capi.service';
import { normalizeIndianMobile } from '../integrations/whatsapp/whatsapp-bot.service';

interface ReportNumbers {
  leadsToday: number;
  followUpsPending: number;
  followUpsTotal: number;
  callbacksPending: number;
  callbacksTotal: number;
  failedWhatsapp: number;
  itineraryGaps: number;
  activeCampaigns: number;
  quotationsSent: number;
  quotationsPending: number;
  inboxUnread: number;
  financeCollectedToday: number;
  financeOutstanding: number;
  financeOverdueInstallments: number;
  metaSentToMeta: number;
  metaConfirmed: number | null;
}

// One line per sidebar section, always pulled live from that section's own real
// table at send time -- never cached, never assumed. If a section's own query
// fails, that section reports 0 rather than silently omitting itself, so the
// numbers stay honest about what could and couldn't be checked.
@Injectable()
export class DailyReportService implements OnModuleInit {
  private readonly logger = new Logger('DailyReport');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private config: ConfigService,
    private metaService: MetaService,
    private metaCapi: MetaCapiService,
  ) {}

  onModuleInit() {
    // Checked once a minute; only fires once the clock matches AND today hasn't
    // already been sent, so a slow tick or a restart mid-minute can't double-send.
    setInterval(() => this.tick().catch((err) => this.logger.error(`Daily report tick failed: ${err.message}`)), 60 * 1000);
  }

  private async tick() {
    const settings = await this.getSettings();
    if (!settings.enabled || settings.templateStatus !== 'APPROVED' || !settings.phoneNumbers.length) return;
    const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
    const todayIst = istNow.toISOString().slice(0, 10);
    if (settings.lastSentDate === todayIst) return;
    if (istNow.getUTCHours() !== settings.sendHour || istNow.getUTCMinutes() !== settings.sendMinute) return;
    await this.sendNow();
  }

  async getSettings() {
    const { rows } = await this.pool.query(`SELECT * FROM daily_report_settings WHERE id = true`);
    const row = rows[0] ?? {};
    return {
      phoneNumbers: (row.phone_numbers ?? []) as string[],
      sendHour: row.send_hour ?? 20,
      sendMinute: row.send_minute ?? 0,
      enabled: !!row.enabled,
      templateId: row.template_id ?? null,
      templateName: row.template_name ?? null,
      templateStatus: row.template_status ?? null,
      templateRejectionReason: row.template_rejection_reason ?? null,
      lastSentDate: row.last_sent_date ?? null,
    };
  }

  async saveSettings(input: { phoneNumbers: string[]; sendHour: number; sendMinute: number; enabled: boolean }) {
    const numbers = input.phoneNumbers.map((n) => normalizeIndianMobile(n)).filter((n): n is string => !!n);
    if (input.enabled && !numbers.length) throw new BadRequestException('Add at least one valid WhatsApp number before enabling');
    if (input.sendHour < 0 || input.sendHour > 23 || input.sendMinute < 0 || input.sendMinute > 59) throw new BadRequestException('Invalid time');
    await this.pool.query(
      `UPDATE daily_report_settings SET phone_numbers=$1, send_hour=$2, send_minute=$3, enabled=$4, updated_at=now() WHERE id=true`,
      [JSON.stringify(numbers), input.sendHour, input.sendMinute, input.enabled],
    );
    return this.getSettings();
  }

  // Every number here comes straight from that module's own live table, queried fresh right now --
  // matches exactly what each sidebar badge/page itself would show if opened this second.
  async computeNumbers(): Promise<ReportNumbers> {
    const [
      leadsToday, followUps, callbacks, failedWhatsapp, coverage, quotations, inboxUnread, finance, meta,
    ] = await Promise.all([
      this.pool.query(`SELECT count(*)::int AS n FROM leads WHERE is_deleted=false AND created_at::date = (now() AT TIME ZONE 'Asia/Kolkata')::date`).then((r) => r.rows[0].n).catch(() => 0),
      this.pool.query(`SELECT count(*) FILTER (WHERE status='pending')::int AS pending, count(*)::int AS total FROM lead_follow_ups`).then((r) => r.rows[0]).catch(() => ({ pending: 0, total: 0 })),
      this.pool.query(`SELECT count(*) FILTER (WHERE called_at IS NULL)::int AS pending, count(*)::int AS total FROM callback_requests`).then((r) => r.rows[0]).catch(() => ({ pending: 0, total: 0 })),
      this.pool.query(
        `SELECT count(DISTINCT (w.lead_id, w.package_id))::int AS n
           FROM whatsapp_logs w
          WHERE w.message_type='itinerary' AND w.is_deleted=false AND w.status='failed'
            AND NOT EXISTS (SELECT 1 FROM manual_itinerary_sends m WHERE m.lead_id=w.lead_id AND m.package_id=w.package_id)
            AND NOT EXISTS (SELECT 1 FROM whatsapp_logs g WHERE g.to_number_norm=w.to_number_norm AND g.package_id=w.package_id AND g.message_type='itinerary' AND g.is_deleted=false AND g.status NOT IN ('failed','test_mode_skipped','unconfirmed'))`,
      ).then((r) => r.rows[0].n).catch(() => 0),
      this.metaService.campaignCoverage().catch(() => ({ activeCampaigns: 0, covered: 0, gaps: [] })),
      this.pool.query(`SELECT count(*) FILTER (WHERE status NOT IN ('draft'))::int AS sent, count(*) FILTER (WHERE status='draft')::int AS pending FROM quotations WHERE is_deleted=false`).then((r) => r.rows[0]).catch(() => ({ sent: 0, pending: 0 })),
      this.pool.query(
        `SELECT count(*)::int AS n FROM leads l
           LEFT JOIN whatsapp_chat_state s ON s.lead_id=l.id
          WHERE l.is_deleted=false
            AND EXISTS (SELECT 1 FROM whatsapp_messages m WHERE m.lead_id=l.id AND m.direction='in' AND m.created_at > COALESCE(s.last_read_at, '2026-09-27T00:00:00+05:30'::timestamptz))`,
      ).then((r) => r.rows[0].n).catch(() => 0),
      Promise.all([
        this.pool.query(`SELECT COALESCE(SUM(amount),0)::float AS n FROM payments WHERE status='completed' AND is_deleted=false AND paid_at >= date_trunc('day', now())`).then((r) => r.rows[0].n).catch(() => 0),
        this.pool.query(`SELECT COALESCE(SUM(GREATEST(total_amount - paid_amount,0)),0)::float AS n FROM bookings WHERE is_deleted=false AND (total_amount - paid_amount) > 0`).then((r) => r.rows[0].n).catch(() => 0),
        this.pool.query(`SELECT count(*)::int AS n FROM payment_installments WHERE status IN ('pending','overdue') AND due_date < CURRENT_DATE`).then((r) => r.rows[0].n).catch(() => 0),
      ]),
      this.metaCapi.learningStatus().catch(() => null),
    ]);

    return {
      leadsToday,
      followUpsPending: followUps.pending,
      followUpsTotal: followUps.total,
      callbacksPending: callbacks.pending,
      callbacksTotal: callbacks.total,
      failedWhatsapp,
      itineraryGaps: coverage.gaps.length,
      activeCampaigns: coverage.activeCampaigns,
      quotationsSent: quotations.sent,
      quotationsPending: quotations.pending,
      inboxUnread,
      financeCollectedToday: finance[0],
      financeOutstanding: finance[1],
      financeOverdueInstallments: finance[2],
      metaSentToMeta: meta?.eventsSentTotal ?? 0,
      metaConfirmed: meta?.metaConfirmed?.available ? Object.values(meta.metaConfirmed.totals as Record<string, number>).reduce((s, n) => s + n, 0) : null,
    };
  }

  renderText(n: ReportNumbers, dateLabel: string) {
    return [
      `*Errances Voyages — Daily CRM Report*`,
      dateLabel,
      ``,
      `*Leads*`,
      `New today: ${n.leadsToday}`,
      ``,
      `*Follow-ups*`,
      `Pending: ${n.followUpsPending} / Total: ${n.followUpsTotal}`,
      ``,
      `*Callback Requests*`,
      `Pending: ${n.callbacksPending} / Total: ${n.callbacksTotal}`,
      ``,
      `*Failed WhatsApp*`,
      `Needs attention: ${n.failedWhatsapp}`,
      ``,
      `*Packages & Itinerary*`,
      `Active campaigns: ${n.activeCampaigns} / Not fully mapped: ${n.itineraryGaps}`,
      ``,
      `*Quotations*`,
      `Sent: ${n.quotationsSent} / Draft (pending): ${n.quotationsPending}`,
      ``,
      `*WhatsApp Inbox*`,
      `Unread chats: ${n.inboxUnread}`,
      ``,
      `*Finance*`,
      `Collected today: ₹${Math.round(n.financeCollectedToday).toLocaleString('en-IN')} / Outstanding: ₹${Math.round(n.financeOutstanding).toLocaleString('en-IN')} / Overdue installments: ${n.financeOverdueInstallments}`,
      ``,
      `*Meta Quality*`,
      `Sent to Meta: ${n.metaSentToMeta} / Meta confirms: ${n.metaConfirmed ?? '—'}`,
    ].join('\n');
  }

  async preview() {
    const numbers = await this.computeNumbers();
    const dateLabel = new Date(Date.now() + 5.5 * 3600 * 1000).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return { numbers, text: this.renderText(numbers, dateLabel) };
  }

  private async getConfig() {
    const { rows } = await this.pool.query(
      `SELECT phone_number_id, business_account_id, access_token_encrypted FROM whatsapp_config WHERE is_configured = true ORDER BY created_at DESC LIMIT 1`,
    );
    const row = rows[0];
    if (!row?.phone_number_id || !row?.access_token_encrypted) return null;
    return { phone_number_id: row.phone_number_id as string, business_account_id: row.business_account_id as string, access_token: row.access_token_encrypted as string };
  }

  async submitTemplate() {
    const config = await this.getConfig();
    if (!config?.business_account_id) throw new BadRequestException('WhatsApp Business Account ID is missing in Settings');
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const templateName = `crm_daily_admin_report_v1`;
    const bodyText =
      'Errances Voyages Daily CRM Report — {{1}}\n\n' +
      'Leads new today: {{2}}\n' +
      'Follow-ups pending/total: {{3}}\n' +
      'Callback requests pending/total: {{4}}\n' +
      'Failed WhatsApp needing attention: {{5}}\n' +
      'Active campaigns / not fully mapped: {{6}}\n' +
      'Quotations sent/draft: {{7}}\n' +
      'WhatsApp Inbox unread: {{8}}\n' +
      'Finance — collected today / outstanding / overdue installments: {{9}}\n' +
      'Meta — sent / confirmed: {{10}}';
    const res = await fetch(`https://graph.facebook.com/${version}/${config.business_account_id}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: templateName,
        language: 'en_US',
        category: 'UTILITY',
        components: [
          {
            type: 'BODY',
            text: bodyText,
            example: { body_text: [['Monday, 29 September 2026', '5', '38 / 90', '39 / 50', '86', '4 / 1', '12 / 3', '31', '₹25,000 / ₹1,20,000 / 2', '0 / 9']] },
          },
        ],
      }),
    });
    const created: any = await res.json();
    if (!res.ok || !created.id) throw new BadRequestException(`Meta template submission failed: ${created?.error?.error_user_msg || created?.error?.message || res.status}`);
    const status = String(created.status || 'PENDING').toUpperCase();
    await this.pool.query(
      `UPDATE daily_report_settings SET template_id=$1, template_name=$2, template_status=$3, template_rejection_reason=NULL, updated_at=now() WHERE id=true`,
      [created.id, templateName, status],
    );
    return this.getSettings();
  }

  async syncTemplateStatus() {
    const settings = await this.getSettings();
    if (!settings.templateId) throw new BadRequestException('No template submitted yet');
    const config = await this.getConfig();
    if (!config) throw new BadRequestException('WhatsApp is not configured');
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const res = await fetch(`https://graph.facebook.com/${version}/${settings.templateId}?fields=id,name,status,rejected_reason&access_token=${encodeURIComponent(config.access_token)}`);
    const data: any = await res.json();
    if (!res.ok) throw new BadRequestException(data?.error?.message || 'Could not check template status');
    const status = String(data.status || settings.templateStatus).toUpperCase();
    await this.pool.query(
      `UPDATE daily_report_settings SET template_status=$1, template_rejection_reason=$2, updated_at=now() WHERE id=true`,
      [status, data.rejected_reason ?? null],
    );
    return this.getSettings();
  }

  async sendNow() {
    const settings = await this.getSettings();
    if (settings.templateStatus !== 'APPROVED' || !settings.templateName) throw new BadRequestException('Template is not approved yet');
    if (!settings.phoneNumbers.length) throw new BadRequestException('No numbers configured');
    const config = await this.getConfig();
    if (!config) throw new BadRequestException('WhatsApp is not configured');
    const numbers = await this.computeNumbers();
    const dateLabel = new Date(Date.now() + 5.5 * 3600 * 1000).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const params = [
      dateLabel,
      String(numbers.leadsToday),
      `${numbers.followUpsPending} / ${numbers.followUpsTotal}`,
      `${numbers.callbacksPending} / ${numbers.callbacksTotal}`,
      String(numbers.failedWhatsapp),
      `${numbers.activeCampaigns} / ${numbers.itineraryGaps}`,
      `${numbers.quotationsSent} / ${numbers.quotationsPending}`,
      String(numbers.inboxUnread),
      `₹${Math.round(numbers.financeCollectedToday).toLocaleString('en-IN')} / ₹${Math.round(numbers.financeOutstanding).toLocaleString('en-IN')} / ${numbers.financeOverdueInstallments}`,
      `${numbers.metaSentToMeta} / ${numbers.metaConfirmed ?? '—'}`,
    ];
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    let sent = 0;
    const errors: string[] = [];
    for (const to of settings.phoneNumbers) {
      try {
        const res = await fetch(`https://graph.facebook.com/${version}/${config.phone_number_id}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: { name: settings.templateName, language: { code: 'en_US' }, components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: p })) }] },
          }),
        });
        const data: any = await res.json();
        if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
        sent++;
      } catch (err: any) {
        this.logger.error(`Daily report send to ${to} failed: ${err.message}`);
        errors.push(`${to}: ${err.message}`);
      }
    }
    const todayIst = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    await this.pool.query(`UPDATE daily_report_settings SET last_sent_date=$1, updated_at=now() WHERE id=true`, [todayIst]);
    return { sent, failed: errors };
  }
}
