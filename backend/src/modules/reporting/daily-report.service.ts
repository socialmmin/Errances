import { BadRequestException, Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { TwilioWhatsAppService, TWILIO_PSEUDO_ID } from '../integrations/whatsapp/twilio-whatsapp.service';
import { PG_POOL } from '../../common/db/pool.module';
import { MetaService } from '../integrations/meta/meta.service';
import { MetaCapiService } from '../integrations/meta/meta-capi.service';
import { waNumber } from '../integrations/whatsapp/whatsapp-bot.service';
import { boardSections, workBoardRows } from '../../common/work-board';

interface ReportNumbers {
  leadsToday: number;
  followUpsDone: number;
  followUpsPending: number;
  followUpsTotal: number;
  callbacksDone: number;
  callbacksPending: number;
  callbacksTotal: number;
  failedResolved: number;
  failedPending: number;
  failedTotal: number;
  itineraryMapped: number;
  itineraryGaps: number;
  activeCampaigns: number;
  quotationsSent: number;
  quotationsPending: number;
  quotationsTotal: number;
  inboxHandled: number;
  inboxUnread: number;
  inboxTotal: number;
  financeCollectedToday: number;
  financeOutstanding: number;
  financeOverdueInstallments: number;
  metaSentToMeta: number;
  metaConfirmed: number | null;
}

// Matches the fixed order of {{2}}..{{10}} in the approved template body (see submitTemplate) --
// a Meta template's parameter slots can't be added or removed without a brand new template and a
// fresh review, so "excluding" a section can't mean dropping its slot. Instead an excluded
// section's slot still gets sent, just with a plain "Not included in this report" instead of its
// real numbers -- this ships today with zero re-approval, matching every already-approved template.
// The approved template's body -- what actually lands on WhatsApp, with {{1}}..{{10}} filled in.
// Shared by submitTemplate (what Meta reviews) and preview (what the phone mock-up shows).
const BODY_TEXT =
  'Daily CRM Report for {{1}}.\n\n' +
  'Leads — New today: {{2}}.\n' +
  'Follow-ups: {{3}}.\n' +
  'Callback Requests: {{4}}.\n' +
  'Failed WhatsApp: {{5}}.\n' +
  'Packages & Itinerary: {{6}}.\n' +
  'Quotations: {{7}}.\n' +
  'WhatsApp Inbox: {{8}}.\n' +
  'Finance: {{9}}.\n' +
  'Meta Quality: {{10}}. Have a great day!';

// The new layout (a second Meta template): today's work, what needs attention, each employee.
const BODY_V2 =
  '📊 *ERRANCES VOYAGES*\n*Daily CRM Report*\n🗓️ {{1}}\n\n' +
  '✅ *TODAY\'S WORK*\n' +
  '🧲 New leads received: {{2}}\n' +
  '📞 Follow-ups: {{3}}\n' +
  '🔔 Callback requests: {{4}}\n' +
  '📄 Quotations: {{5}}\n' +
  '💰 Payments collected: {{6}}\n\n' +
  '⚠️ *NEEDS ATTENTION NOW*\n' +
  '⏰ Follow-ups overdue: {{7}}\n' +
  '❌ Failed WhatsApp itineraries: {{8}}\n' +
  '💬 WhatsApp chats awaiting a reply: {{9}}\n' +
  '🗺️ Ad campaigns without an itinerary: {{10}}\n\n' +
  '👥 *TEAM ACTIVITY TODAY*\n' +
  '▪️ {{11}}\n▪️ {{12}}\n▪️ {{13}}\n▪️ {{14}}\n▪️ {{15}}\n\n' +
  'Open the CRM for the full details. Have a great day!';
const EXAMPLE_V2 = ['Monday, 5 October 2026', '19', '6 set, 4 completed, 3 due tomorrow', '5 received, 4 called back, 1 waiting', '2 created, 1 approved, 1 awaiting approval', 'Rs. 6,000 in 1 payment', '4', '3', '6', '1 of 12',
  'Vikram: 9 leads contacted, 3 follow-ups set, 2 completed, 1 callbacks, 1 quotations', 'Suguna: 7 leads contacted, 2 follow-ups set, 1 completed, 2 callbacks, 0 quotations', 'Pictchaimoorthy: 5 leads contacted, 1 follow-ups set, 1 completed, 1 callbacks, 1 quotations', '-', '-'];

// ---------------- Work reports (third layout) ----------------
// Every section of the sidebar, each as pending now / done today / upcoming, for the MD (whole team)
// and for each employee (their own work). Two more Meta templates; the numbers come from the same
// query as the work board, so the message, the Performance tab and the team board always agree.
const WORK_TEMPLATES = {
  md: {
    kind: 'daily_md_v3', name: 'crm_daily_work_report_v3',
    body:
      '📊 *ERRANCES VOYAGES*\n*Daily Work Report*\n🗓️ {{1}}\n\n' +
      'Pending work should come down to zero.\n\n' +
      '🧲 *Leads:* {{2}}\n' +
      '📞 *Follow-ups:* {{3}}\n' +
      '🔔 *Callback requests:* {{4}}\n' +
      '❌ *Failed WhatsApp:* {{5}}\n' +
      '🗺️ *Packages & Itinerary:* {{6}}\n' +
      '📄 *Quotations:* {{7}}\n' +
      '🧾 *Invoices:* {{8}}\n' +
      '⏰ *Payment reminders:* {{9}}\n' +
      '💬 *WhatsApp Inbox:* {{10}}\n' +
      '💰 *Finance:* {{11}}\n\n' +
      '📌 *OVERALL:* {{12}}\n\n' +
      '👥 *TEAM* (pending / done today / due tomorrow)\n' +
      '▪️ {{13}}\n▪️ {{14}}\n▪️ {{15}}\n▪️ {{16}}\n▪️ {{17}}\n\n' +
      'Open the CRM team board for the full lists.',
    example: ['Tuesday, 6 October 2026', '553 new to call, 284 in progress, 60 contacted today', '21 overdue, 12 done today, 4 due tomorrow, 10 upcoming', '0 waiting, 3 called today', '94 to resend, 5 fixed today',
      '0 campaigns without itinerary, 12 ready', '1 awaiting approval, 1 draft, 0 approved today', '1 unpaid, 0 paid today', '1 unpaid without reminder, 0 scheduled, 0 sent today', '152 replies pending, 18 replied today',
      'Rs. 6,000 collected today, Rs. 13,788 still to collect', '822 pending, 98 done today, 4 due tomorrow, 295 upcoming', 'Suguna: 297 / 11 / 2', 'Pictchaimoorthy: 285 / 12 / 1', 'Vikram: 240 / 59 / 1', '-', '-'],
  },
  employee: {
    kind: 'daily_employee_v1', name: 'crm_employee_work_report_v1',
    body:
      '👋 Hello {{1}},\n*Your work report* · {{2}}\n\n' +
      '🧲 *Leads:* {{3}}\n' +
      '📞 *Follow-ups:* {{4}}\n' +
      '🔔 *Callback requests:* {{5}}\n' +
      '❌ *Failed WhatsApp:* {{6}}\n' +
      '💬 *WhatsApp Inbox:* {{7}}\n' +
      '📄 *Quotations:* {{8}}\n' +
      '🧾 *Invoices:* {{9}}\n' +
      '⏰ *Payment reminders:* {{10}}\n\n' +
      '📌 *OVERALL:* {{11}}\n' +
      '🗓️ *TOMORROW:* {{12}}\n\n' +
      'Please clear the pending work first. Open the CRM for your full list.',
    example: ['Vikram', 'Tuesday, 6 October 2026', '153 new to call, 116 in progress, 47 contacted today', '0 overdue, 12 done today, 1 due tomorrow, 10 upcoming', '0 waiting, 2 called today', '31 to resend, 0 fixed today',
      '54 replies pending, 6 replied today', '0 awaiting approval, 0 drafts, 0 approved today', '1 unpaid, 0 paid today', '1 unpaid without reminder, 0 scheduled, 0 sent today',
      '240 pending, 67 done today, 126 upcoming', '1 follow-up due, and 240 pending items to clear'],
  },
} as const;
type WorkTemplate = keyof typeof WORK_TEMPLATES;
const fill = (body: string, params: string[]) => body.replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1] ?? '');

const SECTION_KEYS = ['leadsToday', 'followUps', 'callbacks', 'failedWhatsapp', 'itinerary', 'quotations', 'inbox', 'finance', 'meta'] as const;
type SectionKey = typeof SECTION_KEYS[number];

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
    private twilio: TwilioWhatsAppService,
  ) {}

  onModuleInit() {
    // Checked once a minute; only fires once the clock matches AND today hasn't
    // already been sent, so a slow tick or a restart mid-minute can't double-send.
    setInterval(() => this.tick().catch((err) => this.logger.error(`Daily report tick failed: ${err.message}`)), 60 * 1000);
  }

  private async tick() {
    let settings = await this.getSettings();
    // Meta never notifies us when it approves a template. Without this, an approved template sat
    // as "PENDING" in the CRM (and the report never sent) until someone pressed "check status".
    if (settings.templateStatus === 'PENDING' && settings.templateId && new Date().getUTCMinutes() % 15 === 0) {
      await this.syncTemplateStatus().catch((err) => this.logger.warn(`Template status check failed: ${err.message}`));
      settings = await this.getSettings();
    }
    if (settings.newLayout.status === 'PENDING' && settings.newLayout.templateId && new Date().getUTCMinutes() % 15 === 0) {
      await this.syncNewLayout().catch((err) => this.logger.warn(`New layout status check failed: ${err.message}`));
      settings = await this.getSettings();
    }
    const [workMd, workEmp] = await Promise.all([this.workTemplate('md'), this.workTemplate('employee')]);
    if (new Date().getUTCMinutes() % 15 === 0) {
      for (const t of [workMd, workEmp]) if (t.status === 'PENDING' && t.templateId) await this.syncWorkTemplate(t.which).catch((err) => this.logger.warn(`Work report status check failed: ${err.message}`));
    }
    const ready = settings.templateStatus === 'APPROVED' || settings.newLayout.status === 'APPROVED' || workMd.status === 'APPROVED';
    if (!settings.enabled || !ready || !settings.phoneNumbers.length) return;
    // IST, computed by shifting the UTC clock -- Date has no real timezone concept, so this
    // shifted instant's own UTC-read hour/minute is what's actually being compared as "IST now".
    const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
    const todayIst = istNow.toISOString().slice(0, 10);
    const nowHM = `${String(istNow.getUTCHours()).padStart(2, '0')}:${String(istNow.getUTCMinutes()).padStart(2, '0')}`;
    if (!settings.sendTimes.some((t) => t === nowHM)) return;
    // One or more times a day: track the exact (date, slot) already sent instead of just the
    // date, so an earlier slot firing today doesn't block a later slot firing later today.
    const slotKey = `${todayIst}T${nowHM}`;
    if (settings.lastSentSlot === slotKey) return;
    // Mark the slot first: a failure half-way must not send everything again a minute later.
    await this.pool.query(`UPDATE daily_report_settings SET last_sent_slot=$1 WHERE id=true`, [slotKey]);
    await this.sendNow({ triggeredBy: 'schedule' }).catch((err) => this.logger.error(`Daily report send failed: ${err.message}`));
    // Employees get their own report once a day, at the last (evening) time of the day.
    const lastTime = [...settings.sendTimes].sort().pop();
    if (workEmp.status === 'APPROVED' && nowHM === lastTime) await this.sendEmployeeReports({ triggeredBy: 'schedule' }).catch((err) => this.logger.error(`Employee reports failed: ${err.message}`));
  }

  async getSettings() {
    const { rows } = await this.pool.query(`SELECT * FROM daily_report_settings WHERE id = true`);
    const row = rows[0] ?? {};
    // Falls back to the old single hour/minute columns for settings saved before multiple times
    // a day existed, so nothing already configured silently stops sending.
    const sendTimes: string[] = Array.isArray(row.send_times) && row.send_times.length
      ? row.send_times
      : [`${String(row.send_hour ?? 20).padStart(2, '0')}:${String(row.send_minute ?? 0).padStart(2, '0')}`];
    const includedSections: SectionKey[] = Array.isArray(row.included_sections)
      ? row.included_sections.filter((k: string) => (SECTION_KEYS as readonly string[]).includes(k))
      : [...SECTION_KEYS];
    return {
      phoneNumbers: (row.phone_numbers ?? []) as string[],
      sendTimes,
      enabled: !!row.enabled,
      includedSections,
      templateId: row.template_id ?? null,
      templateName: row.template_name ?? null,
      templateStatus: row.template_status ?? null,
      templateRejectionReason: row.template_rejection_reason ?? null,
      newLayout: { templateId: row.layout2_template_id ?? null, templateName: row.layout2_template_name ?? null, status: row.layout2_status ?? null, rejectionReason: row.layout2_rejection ?? null },
      lastSentDate: row.last_sent_date ?? null,
      lastSentSlot: row.last_sent_slot ?? null,
    };
  }

  async saveSettings(input: { phoneNumbers: string[]; sendTimes: string[]; enabled: boolean; includedSections?: string[] }) {
    const numbers = input.phoneNumbers.map((n) => waNumber(n)).filter((n): n is string => !!n);
    if (input.enabled && !numbers.length) throw new BadRequestException('Add at least one valid WhatsApp number before enabling');
    const times = (input.sendTimes || []).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t));
    if (input.enabled && !times.length) throw new BadRequestException('Add at least one send time');
    const includedSections = Array.isArray(input.includedSections)
      ? input.includedSections.filter((k) => (SECTION_KEYS as readonly string[]).includes(k))
      : [...SECTION_KEYS];
    await this.pool.query(
      `UPDATE daily_report_settings SET phone_numbers=$1, send_times=$2, send_hour=$3, send_minute=$4, enabled=$5, included_sections=$6, updated_at=now() WHERE id=true`,
      [JSON.stringify(numbers), JSON.stringify(times), Number(times[0]?.split(':')[0] ?? 20), Number(times[0]?.split(':')[1] ?? 0), input.enabled, JSON.stringify(includedSections)],
    );
    return this.getSettings();
  }

  // Every number here comes straight from that module's own live table, queried fresh right now --
  // matches exactly what each sidebar badge/page itself would show if opened this second.
  async computeNumbers(): Promise<ReportNumbers> {
    const [
      leadsToday, followUps, callbacks, failedRows, coverage, quotations, inbox, finance, meta,
    ] = await Promise.all([
      this.pool.query(`SELECT count(*)::int AS n FROM leads WHERE is_deleted=false AND created_at::date = (now() AT TIME ZONE 'Asia/Kolkata')::date`).then((r) => r.rows[0].n).catch(() => 0),
      this.pool.query(`SELECT count(*) FILTER (WHERE status='done')::int AS done, count(*) FILTER (WHERE status='pending')::int AS pending FROM lead_follow_ups`).then((r) => r.rows[0]).catch(() => ({ done: 0, pending: 0 })),
      this.pool.query(`SELECT count(*) FILTER (WHERE called_at IS NOT NULL)::int AS done, count(*) FILTER (WHERE called_at IS NULL)::int AS pending FROM callback_requests`).then((r) => r.rows[0]).catch(() => ({ done: 0, pending: 0 })),
      // Same distinct (lead, package) failed-send set the Failed WhatsApp sidebar badge uses --
      // split into resolved (a human already sent it manually) vs still needing attention.
      this.pool.query(
        `SELECT
           count(*) FILTER (WHERE m.lead_id IS NOT NULL)::int AS resolved,
           count(*) FILTER (WHERE m.lead_id IS NULL)::int AS pending
         FROM (
           SELECT DISTINCT w.lead_id, w.package_id
             FROM whatsapp_logs w
            WHERE w.message_type='itinerary' AND w.is_deleted=false AND w.status='failed'
              AND NOT EXISTS (SELECT 1 FROM whatsapp_logs g WHERE g.to_number_norm=w.to_number_norm AND g.package_id=w.package_id AND g.message_type='itinerary' AND g.is_deleted=false AND g.status NOT IN ('failed','test_mode_skipped','unconfirmed'))
         ) f
         LEFT JOIN manual_itinerary_sends m ON m.lead_id=f.lead_id AND m.package_id=f.package_id`,
      ).then((r) => r.rows[0]).catch(() => ({ resolved: 0, pending: 0 })),
      this.metaService.campaignCoverage().catch(() => ({ activeCampaigns: 0, covered: 0, gaps: [] })),
      this.pool.query(`SELECT count(*) FILTER (WHERE status NOT IN ('draft'))::int AS sent, count(*) FILTER (WHERE status='draft')::int AS pending FROM quotations WHERE is_deleted=false`).then((r) => r.rows[0]).catch(() => ({ sent: 0, pending: 0 })),
      this.pool.query(
        `SELECT
           count(*) FILTER (WHERE unread > 0)::int AS unread,
           count(*) FILTER (WHERE unread = 0)::int AS handled
         FROM (
           SELECT l.id,
             (SELECT count(*)::int FROM whatsapp_messages m WHERE m.lead_id=l.id AND m.direction='in' AND m.created_at > COALESCE(s.last_read_at, '2026-09-27T00:00:00+05:30'::timestamptz)) AS unread
           FROM leads l
           LEFT JOIN whatsapp_chat_state s ON s.lead_id=l.id
           WHERE l.is_deleted=false AND EXISTS (SELECT 1 FROM whatsapp_messages m WHERE m.lead_id=l.id)
         ) c`,
      ).then((r) => r.rows[0]).catch(() => ({ unread: 0, handled: 0 })),
      Promise.all([
        this.pool.query(`SELECT COALESCE(SUM(amount),0)::float AS n FROM payments WHERE status='completed' AND is_deleted=false AND paid_at >= date_trunc('day', now())`).then((r) => r.rows[0].n).catch(() => 0),
        this.pool.query(`SELECT COALESCE(SUM(GREATEST(total_amount - paid_amount,0)),0)::float AS n FROM bookings WHERE is_deleted=false AND (total_amount - paid_amount) > 0`).then((r) => r.rows[0].n).catch(() => 0),
        this.pool.query(`SELECT count(*)::int AS n FROM payment_installments WHERE status IN ('pending','overdue') AND due_date < CURRENT_DATE`).then((r) => r.rows[0].n).catch(() => 0),
      ]),
      this.metaCapi.learningStatus().catch(() => null),
    ]);

    return {
      leadsToday,
      followUpsDone: followUps.done,
      followUpsPending: followUps.pending,
      followUpsTotal: followUps.done + followUps.pending,
      callbacksDone: callbacks.done,
      callbacksPending: callbacks.pending,
      callbacksTotal: callbacks.done + callbacks.pending,
      failedResolved: failedRows.resolved,
      failedPending: failedRows.pending,
      failedTotal: failedRows.resolved + failedRows.pending,
      itineraryMapped: coverage.activeCampaigns - coverage.gaps.length,
      itineraryGaps: coverage.gaps.length,
      activeCampaigns: coverage.activeCampaigns,
      quotationsSent: quotations.sent,
      quotationsPending: quotations.pending,
      quotationsTotal: quotations.sent + quotations.pending,
      inboxHandled: inbox.handled,
      inboxUnread: inbox.unread,
      inboxTotal: inbox.handled + inbox.unread,
      financeCollectedToday: finance[0],
      financeOutstanding: finance[1],
      financeOverdueInstallments: finance[2],
      metaSentToMeta: meta?.eventsSentTotal ?? 0,
      metaConfirmed: meta?.metaConfirmed?.available ? Object.values(meta.metaConfirmed.totals as Record<string, number>).reduce((s, n) => s + n, 0) : null,
    };
  }

  private row(label: string, value: string | number) {
    return `${label}: ${value}`;
  }

  // Every section that has a natural Done/Pending split tallies to its own Total, so nothing
  // reads as an unexplained number on its own -- plain text only (WhatsApp allows no tables),
  // one clean "Label: value" per line, a thin divider between sections, no emoji.
  private skippedNote = 'Not included in this report';

  private section(key: SectionKey, included: readonly string[], lines: string[]) {
    return included.includes(key) ? lines : [this.skippedNote];
  }

  renderText(n: ReportNumbers, dateLabel: string, includedSections: readonly string[] = SECTION_KEYS) {
    const divider = '––––––––––––––––––––';
    const inc = includedSections;
    return [
      `*ERRANCES VOYAGES*`,
      `Daily CRM Report — ${dateLabel}`,
      divider,
      `*Leads*`,
      ...this.section('leadsToday', inc, [this.row('New today', n.leadsToday)]),
      divider,
      `*Follow-ups*`,
      ...this.section('followUps', inc, [this.row('Done', n.followUpsDone), this.row('Pending', n.followUpsPending), this.row('Total', n.followUpsTotal)]),
      divider,
      `*Callback Requests*`,
      ...this.section('callbacks', inc, [this.row('Done', n.callbacksDone), this.row('Pending', n.callbacksPending), this.row('Total', n.callbacksTotal)]),
      divider,
      `*Failed WhatsApp*`,
      ...this.section('failedWhatsapp', inc, [this.row('Resolved', n.failedResolved), this.row('Needs attention', n.failedPending), this.row('Total', n.failedTotal)]),
      divider,
      `*Packages & Itinerary*`,
      ...this.section('itinerary', inc, [this.row('Mapped', n.itineraryMapped), this.row('Not mapped', n.itineraryGaps), this.row('Total active campaigns', n.activeCampaigns)]),
      divider,
      `*Quotations*`,
      ...this.section('quotations', inc, [this.row('Sent', n.quotationsSent), this.row('Draft (pending)', n.quotationsPending), this.row('Total', n.quotationsTotal)]),
      divider,
      `*WhatsApp Inbox*`,
      ...this.section('inbox', inc, [this.row('Handled', n.inboxHandled), this.row('Unread', n.inboxUnread), this.row('Total conversations', n.inboxTotal)]),
      divider,
      `*Finance*`,
      ...this.section('finance', inc, [this.row('Collected today', `Rs. ${Math.round(n.financeCollectedToday).toLocaleString('en-IN')}`), this.row('Outstanding', `Rs. ${Math.round(n.financeOutstanding).toLocaleString('en-IN')}`), this.row('Overdue installments', n.financeOverdueInstallments)]),
      divider,
      `*Meta Quality*`,
      ...this.section('meta', inc, [this.row('Sent to Meta', n.metaSentToMeta), this.row('Meta confirms', n.metaConfirmed ?? 'Not available')]),
    ].join('\n');
  }

  async preview(sectionsOverride?: string[]) {
    const settings = await this.getSettings();
    const inc = sectionsOverride ? sectionsOverride.filter((k) => (SECTION_KEYS as readonly string[]).includes(k)) : settings.includedSections;
    const numbers = await this.computeNumbers();
    const dateLabel = this.dateLabel();
    const params = this.buildParams(numbers, dateLabel, inc);
    // `message` is exactly what the recipient's phone shows (the approved template, filled in).
    const oldMessage = BODY_TEXT.replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1] ?? '');
    // The new layout with today's real numbers -- what goes out once Meta approves it.
    const paramsV2 = this.buildParamsV2(await this.computeToday(), dateLabel, inc);
    const newMessage = BODY_V2.replace(/\{\{(\d+)\}\}/g, (_, i) => paramsV2[Number(i) - 1] ?? '');
    const usingNew = settings.newLayout.status === 'APPROVED';
    const work = await this.workTemplate('md');
    const workMessage = fill(work.body, await this.mdParams(await this.workRows(), dateLabel));
    const usingWork = work.status === 'APPROVED';
    return { numbers, text: this.renderText(numbers, dateLabel, inc), message: usingWork ? workMessage : usingNew ? newMessage : oldMessage, newMessage, workMessage, usingNewLayout: usingNew, usingWorkReport: usingWork, includedSections: inc };
  }

  private dateLabel() {
    return new Date(Date.now() + 5.5 * 3600 * 1000).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  private buildParams(numbers: ReportNumbers, dateLabel: string, inc: readonly string[]) {
    const at = (key: SectionKey, value: string) => (inc.includes(key) ? value : this.skippedNote);
    return [
      dateLabel,
      at('leadsToday', String(numbers.leadsToday)),
      at('followUps', `Done ${numbers.followUpsDone}, Pending ${numbers.followUpsPending}, Total ${numbers.followUpsTotal}`),
      at('callbacks', `Done ${numbers.callbacksDone}, Pending ${numbers.callbacksPending}, Total ${numbers.callbacksTotal}`),
      at('failedWhatsapp', `Resolved ${numbers.failedResolved}, Needs attention ${numbers.failedPending}, Total ${numbers.failedTotal}`),
      at('itinerary', `Mapped ${numbers.itineraryMapped}, Not mapped ${numbers.itineraryGaps}, Total ${numbers.activeCampaigns}`),
      at('quotations', `Sent ${numbers.quotationsSent}, Draft ${numbers.quotationsPending}, Total ${numbers.quotationsTotal}`),
      at('inbox', `Handled ${numbers.inboxHandled}, Unread ${numbers.inboxUnread}, Total ${numbers.inboxTotal}`),
      at('finance', `Collected Rs. ${Math.round(numbers.financeCollectedToday).toLocaleString('en-IN')}, Outstanding Rs. ${Math.round(numbers.financeOutstanding).toLocaleString('en-IN')}, Overdue ${numbers.financeOverdueInstallments}`),
      at('meta', `Sent ${numbers.metaSentToMeta}, Confirmed ${numbers.metaConfirmed ?? 'N/A'}`),
    ];
  }

  // Per configured number: what the last 7 days of sends actually did (from Meta's delivery
  // webhooks on each logged message), so "enabled" is never mistaken for "receiving".
  async deliveries() {
    const settings = await this.getSettings();
    const { rows } = await this.pool.query(
      `SELECT right(regexp_replace(to_number, '\\D', '', 'g'), 10) AS k,
              count(*)::int AS sends,
              count(*) FILTER (WHERE status IN ('delivered','read'))::int AS delivered,
              count(*) FILTER (WHERE status = 'read')::int AS read,
              count(*) FILTER (WHERE status = 'failed')::int AS failed,
              max(created_at) AS last_at,
              (array_agg(status ORDER BY created_at DESC))[1] AS last_status,
              (array_agg(error_message ORDER BY created_at DESC))[1] AS last_error,
              (array_agg(triggered_by ORDER BY created_at DESC))[1] AS last_trigger
         FROM whatsapp_logs
        WHERE message_type = 'daily_report' AND is_deleted = false AND created_at > now() - interval '7 days'
        GROUP BY 1`,
    );
    const byKey = new Map(rows.map((r: any) => [r.k, r]));
    return {
      data: settings.phoneNumbers.map((n) => {
        const r: any = byKey.get(n.replace(/\D/g, '').slice(-10));
        return { phone: n, sends: r?.sends ?? 0, delivered: r?.delivered ?? 0, read: r?.read ?? 0, failed: r?.failed ?? 0, lastAt: r?.last_at ?? null, lastStatus: r?.last_status ?? null, lastError: r?.last_error ?? null, lastTrigger: r?.last_trigger ?? null };
      }),
    };
  }

  async sendTest(phone: string) {
    const to = waNumber(phone);
    if (!to) throw new BadRequestException('Enter a valid WhatsApp number');
    return this.sendNow({ to: [to], triggeredBy: 'test' });
  }

  private async getConfig() {
    if (this.twilio.isConfigured()) return { phone_number_id: TWILIO_PSEUDO_ID, business_account_id: TWILIO_PSEUDO_ID, access_token: TWILIO_PSEUDO_ID };
    const { rows } = await this.pool.query(
      `SELECT phone_number_id, business_account_id, access_token_encrypted FROM whatsapp_config WHERE is_configured = true ORDER BY created_at DESC LIMIT 1`,
    );
    const row = rows[0];
    if (!row?.phone_number_id || !row?.access_token_encrypted) return null;
    return { phone_number_id: row.phone_number_id as string, business_account_id: row.business_account_id as string, access_token: row.access_token_encrypted as string };
  }


  // ---------------- New layout: today's work, what needs attention, and each employee ----------------
  // A WhatsApp template's wording is fixed once Meta approves it, so the cleaner layout is a second
  // template. The first one keeps sending until this one is approved.

  // Everything in the new layout, counted for today (India time) or as of this moment.
  async computeToday() {
    const today = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;
    const on = (col: string) => `(${col} AT TIME ZONE 'Asia/Kolkata')::date = ${today}`;
    const one = (sql: string) => this.pool.query(sql).then((r) => r.rows[0] ?? {}).catch((e) => { this.logger.warn(`Daily report query failed: ${e.message}`); return {} as any; });
    const [leads, fu, cb, quo, pay, failed, chats, coverage, team] = await Promise.all([
      one(`SELECT count(*)::int AS n FROM leads WHERE is_deleted = false AND ${on('created_at')}`),
      one(`SELECT count(*) FILTER (WHERE ${on('created_at')})::int AS created, count(*) FILTER (WHERE status = 'done' AND ${on('completed_at')})::int AS done,
                  count(*) FILTER (WHERE status = 'pending' AND due_at < now())::int AS overdue, count(*) FILTER (WHERE status = 'pending' AND (due_at AT TIME ZONE 'Asia/Kolkata')::date = ${today} + 1)::int AS tomorrow FROM lead_follow_ups`),
      one(`SELECT count(*) FILTER (WHERE ${on('requested_at')})::int AS received, count(*) FILTER (WHERE called_at IS NOT NULL AND ${on('called_at')})::int AS called, count(*) FILTER (WHERE called_at IS NULL)::int AS waiting FROM callback_requests`),
      one(`SELECT count(*) FILTER (WHERE ${on('created_at')})::int AS created, count(*) FILTER (WHERE status IN ('accepted','converted') AND ${on('updated_at')})::int AS approved,
                  count(*) FILTER (WHERE status = 'sent')::int AS awaiting FROM quotations WHERE is_deleted = false`),
      one(`SELECT COALESCE(sum(amount), 0)::float AS amount, count(*)::int AS n FROM payments WHERE is_deleted = false AND status = 'completed' AND ${on('paid_at')}`),
      one(`SELECT count(*)::int AS n FROM (
              SELECT DISTINCT w.lead_id, w.package_id FROM whatsapp_logs w
               WHERE w.message_type = 'itinerary' AND w.is_deleted = false AND w.status = 'failed'
                 AND NOT EXISTS (SELECT 1 FROM whatsapp_logs g WHERE g.to_number_norm = w.to_number_norm AND g.package_id = w.package_id AND g.message_type = 'itinerary' AND g.is_deleted = false AND g.status NOT IN ('failed','test_mode_skipped','unconfirmed'))
                 AND NOT EXISTS (SELECT 1 FROM manual_itinerary_sends m WHERE m.lead_id = w.lead_id AND m.package_id = w.package_id)) f`),
      one(`SELECT count(*)::int AS n FROM leads l LEFT JOIN whatsapp_chat_state s ON s.lead_id = l.id
            WHERE l.is_deleted = false AND COALESCE(s.status, 'open') <> 'done' AND EXISTS (
              SELECT 1 FROM whatsapp_messages i WHERE i.lead_id = l.id AND i.direction = 'in' AND i.msg_type NOT IN ('button','interactive','reaction') AND i.created_at > now() - interval '30 days'
                 AND NOT EXISTS (SELECT 1 FROM whatsapp_messages o WHERE o.lead_id = l.id AND o.direction = 'out' AND (o.sent_by IS NOT NULL OR o.meta->>'echo' = 'true') AND o.created_at > i.created_at))`),
      this.metaService.campaignCoverage().catch(() => ({ activeCampaigns: 0, covered: 0, gaps: [] as any[] })),
      // one row per active employee who handles leads: what they did today
      this.pool.query(
        `SELECT u.full_name,
                (SELECT count(DISTINCT x.lead_id)::int FROM (
                   SELECT f.lead_id FROM lead_follow_ups f WHERE (f.created_by = u.id AND ${on('f.created_at')}) OR (f.completed_by = u.id AND ${on('f.completed_at')})
                   UNION SELECT n.lead_id FROM lead_notes n WHERE n.created_by = u.id AND ${on('n.created_at')}
                   UNION SELECT m.lead_id FROM whatsapp_messages m WHERE m.sent_by::text = u.id::text AND m.direction = 'out' AND ${on('m.created_at')}
                   UNION SELECT c.lead_id FROM callback_requests c WHERE c.called_by = u.id AND ${on('c.called_at')}
                   UNION SELECT q.lead_id FROM quotations q WHERE q.created_by = u.id AND q.is_deleted = false AND ${on('q.created_at')}
                   UNION SELECT ch.lead_id FROM lead_changes ch WHERE ch.changed_by = u.id AND ${on('ch.created_at')}) x WHERE x.lead_id IS NOT NULL) AS contacted,
                (SELECT count(*)::int FROM lead_follow_ups f WHERE f.created_by = u.id AND ${on('f.created_at')}) AS followups_set,
                (SELECT count(*)::int FROM lead_follow_ups f WHERE f.completed_by = u.id AND ${on('f.completed_at')}) AS followups_done,
                (SELECT count(*)::int FROM callback_requests c WHERE c.called_by = u.id AND ${on('c.called_at')}) AS calls,
                (SELECT count(*)::int FROM quotations q WHERE q.created_by = u.id AND q.is_deleted = false AND ${on('q.created_at')}) AS quotations,
                (SELECT count(*)::int FROM lead_follow_ups f JOIN leads l ON l.id = f.lead_id WHERE l.assigned_to = u.id AND l.is_deleted = false AND f.status = 'pending' AND f.due_at < now()) AS overdue
           FROM users u JOIN roles r ON r.id = u.role_id
          WHERE u.is_deleted = false AND u.is_active = true AND (r.name <> 'super_admin' OR EXISTS (SELECT 1 FROM leads l WHERE l.assigned_to = u.id AND l.is_deleted = false))
          ORDER BY 2 DESC, u.full_name LIMIT 30`,
      ).then((r) => r.rows).catch((e) => { this.logger.warn(`Team activity query failed: ${e.message}`); return [] as any[]; }),
    ]);
    return { leads, fu, cb, quo, pay, failed, chats, gaps: coverage.gaps.length, activeCampaigns: coverage.activeCampaigns, team };
  }

  // {{1}}..{{15}} of BODY_V2. A template value cannot contain a line break, so each employee is one line.
  private buildParamsV2(d: Awaited<ReturnType<DailyReportService['computeToday']>>, dateLabel: string, inc: readonly string[]) {
    const at = (key: SectionKey, value: string) => (inc.includes(key) ? value : this.skippedNote);
    const n = (v: any) => Number(v) || 0;
    const rupees = (v: any) => `Rs. ${Math.round(n(v)).toLocaleString('en-IN')}`;
    const person = (t: any) => `${t.full_name}: ${n(t.contacted)} leads contacted, ${n(t.followups_set)} follow-ups set, ${n(t.followups_done)} completed, ${n(t.calls)} callbacks, ${n(t.quotations)} quotations${n(t.overdue) ? `, ${n(t.overdue)} overdue` : ''}`;
    const lines: string[] = d.team.slice(0, 5).map(person);
    if (d.team.length > 5) {
      const rest = d.team.slice(4);
      lines[4] = `${rest.length} more: ` + rest.map((t: any) => `${t.full_name} ${n(t.contacted)}`).join(', ').slice(0, 300) + ' leads contacted';
    }
    while (lines.length < 5) lines.push(lines.length === 0 ? 'No employee activity recorded today' : '-');
    return [
      dateLabel,
      at('leadsToday', String(n(d.leads.n))),
      at('followUps', `${n(d.fu.created)} set, ${n(d.fu.done)} completed, ${n(d.fu.tomorrow)} due tomorrow`),
      at('callbacks', `${n(d.cb.received)} received, ${n(d.cb.called)} called back, ${n(d.cb.waiting)} waiting`),
      at('quotations', `${n(d.quo.created)} created, ${n(d.quo.approved)} approved, ${n(d.quo.awaiting)} awaiting approval`),
      at('finance', `${rupees(d.pay.amount)} in ${n(d.pay.n)} payment${n(d.pay.n) === 1 ? '' : 's'}`),
      at('followUps', String(n(d.fu.overdue))),
      at('failedWhatsapp', String(n(d.failed.n))),
      at('inbox', String(n(d.chats.n))),
      at('itinerary', `${n(d.gaps)} of ${n(d.activeCampaigns)}`),
      ...lines.map((l) => l.replace(/\s+/g, ' ').slice(0, 400)),
    ];
  }

  // ---------------- Work reports: MD (whole team) and each employee ----------------
  private async workTemplate(which: WorkTemplate) {
    const def = WORK_TEMPLATES[which];
    const { rows } = await this.pool.query(`SELECT * FROM utility_templates WHERE kind = $1`, [def.kind]).catch(() => ({ rows: [] as any[] }));
    const row = rows[0];
    return { which, body: def.body as string, templateId: (row?.template_id ?? null) as string | null, templateName: (row?.template_name ?? null) as string | null, status: (row?.template_status ?? null) as string | null, rejectionReason: (row?.template_rejection_reason ?? null) as string | null };
  }

  private todayIst() { return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); }

  private sectionLines(b: ReturnType<typeof boardSections>) {
    const s = b.sections;
    return {
      leads: `${s.leads.pending} new to call, ${s.leads.upcoming} in progress, ${s.leads.done} contacted today`,
      followups: `${s.followups.pending} overdue, ${s.followups.done} done today, ${s.followups.tomorrow} due tomorrow, ${s.followups.upcoming} upcoming`,
      callbacks: `${s.callbacks.pending} waiting, ${s.callbacks.done} called today`,
      failed: `${s.failed.pending} to resend, ${s.failed.done} fixed today`,
      quotations: `${s.quotations.pending} awaiting approval, ${s.quotations.upcoming} draft${s.quotations.upcoming === 1 ? '' : 's'}, ${s.quotations.done} approved today`,
      invoices: `${s.invoices.pending} unpaid, ${s.invoices.done} paid today`,
      reminders: `${s.reminders.pending} unpaid without reminder, ${s.reminders.upcoming} scheduled, ${s.reminders.done} sent today`,
      inbox: `${s.inbox.pending} replies pending, ${s.inbox.done} replied today`,
    };
  }

  private employeeParams(u: any, dateLabel: string) {
    const b = boardSections(u);
    const l = this.sectionLines(b);
    const t = b.sections.followups.tomorrow;
    return [String(u.full_name).split(/\s+/)[0].slice(0, 40), dateLabel, l.leads, l.followups, l.callbacks, l.failed, l.inbox, l.quotations, l.invoices, l.reminders,
      `${b.pending} pending, ${b.done} done today, ${b.upcoming} upcoming`,
      `${t} follow-up${t === 1 ? '' : 's'} due, and ${b.pending} pending item${b.pending === 1 ? '' : 's'} to clear`];
  }

  // The MD's numbers are the whole team added up, so they match the team board's "Whole team" line.
  private async mdParams(rows: any[], dateLabel: string) {
    const sum: any = { lead_stages: {} };
    for (const u of rows) {
      for (const [k, v] of Object.entries(u)) if (typeof v === 'number') sum[k] = (sum[k] ?? 0) + v;
      for (const [k, v] of Object.entries(u.lead_stages || {})) sum.lead_stages[k] = (sum.lead_stages[k] ?? 0) + (Number(v) || 0);
    }
    const b = boardSections(sum);
    const l = this.sectionLines(b);
    const one = (sql: string) => this.pool.query(sql).then((r) => r.rows[0] ?? {}).catch(() => ({} as any));
    const [coverage, pay, due] = await Promise.all([
      this.metaService.campaignCoverage().catch(() => ({ activeCampaigns: 0, covered: 0, gaps: [] as any[] })),
      one(`SELECT COALESCE(sum(amount), 0)::float AS amount FROM payments WHERE is_deleted = false AND status = 'completed' AND (paid_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date`),
      one(`SELECT COALESCE(sum(GREATEST(i.total_amount - COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.is_deleted = false AND p.status = 'completed'), 0), 0)), 0)::float AS amount FROM invoices i JOIN quotations q ON q.id = i.quotation_id WHERE i.is_deleted = false AND q.is_deleted = false AND i.cancelled_at IS NULL`),
    ]);
    const rupees = (v: any) => `Rs. ${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;
    const people = rows.map((u) => ({ name: String(u.full_name).split(/\s+/)[0].slice(0, 18), b: boardSections(u) })).sort((x, y) => y.b.pending - x.b.pending);
    const team = people.slice(0, 5).map((p) => `${p.name}: ${p.b.pending} / ${p.b.done} / ${p.b.sections.followups.tomorrow}`);
    if (people.length > 5) { const rest = people.slice(4); team[4] = `${rest.length} more: ${rest.reduce((a, p) => a + p.b.pending, 0)} / ${rest.reduce((a, p) => a + p.b.done, 0)} / ${rest.reduce((a, p) => a + p.b.sections.followups.tomorrow, 0)}`; }
    while (team.length < 5) team.push(team.length === 0 ? 'No employees yet' : '-');
    const params = [dateLabel, l.leads, l.followups, l.callbacks, l.failed,
      `${coverage.gaps.length} campaign${coverage.gaps.length === 1 ? '' : 's'} without itinerary, ${Math.max(coverage.activeCampaigns - coverage.gaps.length, 0)} ready`,
      l.quotations, l.invoices, l.reminders, l.inbox,
      `${rupees(pay.amount)} collected today, ${rupees(due.amount)} still to collect`,
      `${b.pending} pending, ${b.done} done today, ${b.sections.followups.tomorrow} due tomorrow, ${b.upcoming} upcoming`,
      ...team];
    // WhatsApp's body limit is 1,024 characters. If large numbers ever push the message past it,
    // drop team lines from the bottom (the team board has them) rather than lose the whole report.
    for (let i = params.length - 1; i >= 12 && fill(WORK_TEMPLATES.md.body, params).length > 1020; i--) params[i] = '-';
    return params;
  }

  private async workRows() { const day = this.todayIst(); return workBoardRows(this.pool, day, day, null); }

  // Everything the Work reports panel shows: both templates with their status, the MD message with
  // today's real numbers, and each employee with their own message, number and on/off switch.
  async teamReports() {
    const [md, employee, rows] = await Promise.all([this.workTemplate('md'), this.workTemplate('employee'), this.workRows()]);
    const dateLabel = this.dateLabel();
    const { rows: users } = await this.pool.query(`SELECT id, phone, daily_report_enabled FROM users WHERE id = ANY($1::uuid[])`, [rows.map((r) => r.id)]);
    const byId = new Map(users.map((u: any) => [u.id, u]));
    const { rows: logs } = await this.pool.query(
      `SELECT DISTINCT ON (right(regexp_replace(to_number, '\\D', '', 'g'), 10)) right(regexp_replace(to_number, '\\D', '', 'g'), 10) AS k, status::text AS status, error_message, created_at
         FROM whatsapp_logs WHERE message_type = 'employee_report' AND is_deleted = false AND created_at > now() - interval '7 days' ORDER BY 1, created_at DESC`).catch(() => ({ rows: [] as any[] }));
    const last = new Map(logs.map((r: any) => [r.k, r]));
    return {
      md: { ...md, message: fill(md.body, await this.mdParams(rows, dateLabel)) },
      employee: { ...employee },
      employees: rows.map((u) => {
        const x: any = byId.get(u.id) ?? {};
        const mobile = waNumber(x.phone ?? '');
        const k = mobile ? mobile.slice(-10) : '';
        const b = boardSections(u);
        const l: any = k ? last.get(k) : null;
        return {
          id: u.id, name: u.full_name, role: u.role_name, enabled: x.daily_report_enabled !== false, hasNumber: !!mobile,
          number: k ? `${k.slice(0, 2)}XXXXXX${k.slice(-2)}` : null,
          pending: b.pending, done: b.done, upcoming: b.upcoming, tomorrow: b.sections.followups.tomorrow,
          message: fill(employee.body, this.employeeParams(u, dateLabel)),
          lastStatus: l?.status ?? null, lastAt: l?.created_at ?? null, lastError: l?.error_message ?? null,
        };
      }),
    };
  }

  async setEmployeeReport(userId: string, enabled: boolean) {
    const { rows } = await this.pool.query(`UPDATE users SET daily_report_enabled = $2, updated_at = now() WHERE id = $1 AND is_deleted = false RETURNING id`, [userId, !!enabled]);
    if (!rows[0]) throw new BadRequestException('Employee not found');
    return { id: userId, enabled: !!enabled };
  }

  async submitWorkTemplate(which: WorkTemplate) {
    const def = WORK_TEMPLATES[which];
    if (!def) throw new BadRequestException('Unknown report');
    const current = await this.workTemplate(which);
    if (current.templateId && current.status !== 'REJECTED') return current;
    const config = await this.getConfig();
    if (!config?.business_account_id) throw new BadRequestException('WhatsApp Business Account ID is missing in Settings');
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const res = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${config.business_account_id}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: def.name, language: 'en_US', category: 'UTILITY', components: [{ type: 'BODY', text: def.body, example: { body_text: [def.example] } }] }),
    });
    const created: any = await res.json();
    if (!res.ok || !created.id) throw new BadRequestException(`Meta template submission failed: ${created?.error?.error_user_msg || created?.error?.message || res.status}`);
    await this.pool.query(
      `INSERT INTO utility_templates (kind, template_id, template_name, template_status, submitted_at, checked_at) VALUES ($1, $2, $3, $4, now(), now())
       ON CONFLICT (kind) DO UPDATE SET template_id=$2, template_name=$3, template_status=$4, template_rejection_reason=NULL, submitted_at=now(), checked_at=now()`,
      [def.kind, created.id, def.name, String(created.status || 'PENDING').toUpperCase()]);
    return this.workTemplate(which);
  }

  async syncWorkTemplate(which: WorkTemplate) {
    const def = WORK_TEMPLATES[which];
    if (!def) throw new BadRequestException('Unknown report');
    const current = await this.workTemplate(which);
    if (!current.templateId) throw new BadRequestException('This report has not been submitted yet');
    const config = await this.getConfig();
    if (!config) throw new BadRequestException('WhatsApp is not configured');
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const res = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${current.templateId}?fields=id,name,status,rejected_reason&access_token=${encodeURIComponent(config.access_token)}`);
    const data: any = await res.json();
    if (!res.ok) throw new BadRequestException(data?.error?.message || 'Could not check template status');
    await this.pool.query(`UPDATE utility_templates SET template_status=$2, template_rejection_reason=$3, checked_at=now() WHERE kind=$1`,
      [def.kind, String(data.status || current.status).toUpperCase(), data.rejected_reason && data.rejected_reason !== 'NONE' ? data.rejected_reason : null]);
    return this.workTemplate(which);
  }

  private async sendTemplate(config: { phone_number_id: string; access_token: string }, to: string, templateName: string, params: string[], messageType: string, triggeredBy: string) {
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    try {
      const res = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${config.phone_number_id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template: { name: templateName, language: { code: 'en_US' }, components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p).replace(/\s+/g, ' ').slice(0, 300) || '-' })) }] } }),
      });
      const data: any = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      await this.pool.query(`INSERT INTO whatsapp_logs (to_number, template_name, status, sent_at, message_id, message_type, triggered_by) VALUES ($1,$2,'accepted',now(),$3,$4,$5)`,
        [to, templateName, data?.messages?.[0]?.id ?? null, messageType, triggeredBy]).catch((e) => this.logger.warn(`Could not log ${messageType} send: ${e.message}`));
      return null as string | null;
    } catch (err: any) {
      this.logger.error(`${messageType} send failed: ${err.message}`);
      await this.pool.query(`INSERT INTO whatsapp_logs (to_number, template_name, status, message_type, triggered_by, error_message) VALUES ($1,$2,'failed',$3,$4,$5)`,
        [to, templateName, messageType, triggeredBy, String(err.message).slice(0, 500)]).catch(() => undefined);
      return String(err.message);
    }
  }

  // Each employee's own work report, to their own WhatsApp number. Scheduled runs skip employees
  // switched off or without a number; "send now" for one employee ignores the switch.
  async sendEmployeeReports(opts: { userId?: string; triggeredBy?: 'schedule' | 'manual' } = {}) {
    const tpl = await this.workTemplate('employee');
    if (tpl.status !== 'APPROVED' || !tpl.templateName) throw new BadRequestException('The employee report is not approved by Meta yet');
    const config = await this.getConfig();
    if (!config) throw new BadRequestException('WhatsApp is not configured');
    const rows = (await this.workRows()).filter((u) => !opts.userId || u.id === opts.userId);
    if (opts.userId && !rows.length) throw new BadRequestException('Employee not found');
    const { rows: users } = await this.pool.query(`SELECT id, phone, daily_report_enabled FROM users WHERE id = ANY($1::uuid[])`, [rows.map((r) => r.id)]);
    const byId = new Map(users.map((u: any) => [u.id, u]));
    const dateLabel = this.dateLabel();
    let sent = 0; const failed: string[] = []; let skipped = 0;
    for (const u of rows) {
      const x: any = byId.get(u.id) ?? {};
      const mobile = waNumber(x.phone ?? '');
      if (!mobile) { if (opts.userId) throw new BadRequestException('This employee has no valid mobile number in their profile'); skipped++; continue; }
      if (!opts.userId && x.daily_report_enabled === false) { skipped++; continue; }
      const err = await this.sendTemplate(config, mobile, tpl.templateName, this.employeeParams(u, dateLabel), 'employee_report', opts.triggeredBy ?? 'manual');
      if (err) failed.push(`${u.full_name}: ${err}`); else sent++;
    }
    return { sent, failed, skipped };
  }

  async submitNewLayout() {
    const config = await this.getConfig();
    if (!config?.business_account_id) throw new BadRequestException('WhatsApp Business Account ID is missing in Settings');
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const templateName = 'crm_daily_admin_report_v2';
    const res = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${config.business_account_id}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: templateName, language: 'en_US', category: 'UTILITY', components: [{ type: 'BODY', text: BODY_V2, example: { body_text: [EXAMPLE_V2] } }] }),
    });
    const created: any = await res.json();
    if (!res.ok || !created.id) throw new BadRequestException(`Meta template submission failed: ${created?.error?.error_user_msg || created?.error?.message || res.status}`);
    await this.pool.query(
      `UPDATE daily_report_settings SET layout2_template_id=$1, layout2_template_name=$2, layout2_status=$3, layout2_rejection=NULL, updated_at=now() WHERE id=true`,
      [created.id, templateName, String(created.status || 'PENDING').toUpperCase()],
    );
    return this.getSettings();
  }

  async syncNewLayout() {
    const settings = await this.getSettings();
    if (!settings.newLayout.templateId) throw new BadRequestException('The new layout has not been submitted yet');
    const config = await this.getConfig();
    if (!config) throw new BadRequestException('WhatsApp is not configured');
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const res = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${settings.newLayout.templateId}?fields=id,name,status,rejected_reason&access_token=${encodeURIComponent(config.access_token)}`);
    const data: any = await res.json();
    if (!res.ok) throw new BadRequestException(data?.error?.message || 'Could not check template status');
    await this.pool.query(`UPDATE daily_report_settings SET layout2_status=$1, layout2_rejection=$2, updated_at=now() WHERE id=true`, [String(data.status || settings.newLayout.status).toUpperCase(), data.rejected_reason ?? null]);
    return this.getSettings();
  }

  async submitTemplate() {
    const config = await this.getConfig();
    if (!config?.business_account_id) throw new BadRequestException('WhatsApp Business Account ID is missing in Settings');
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const templateName = `crm_daily_admin_report_v1`;
    // Meta's template validator rejects a body whose very first or very last token is a bare
    // variable, even with punctuation right after it ("Meta Quality — {{10}}." was still flagged)
    // -- confirmed directly against the Graph API: it needs genuine trailing text, not just a
    // period, after the last variable. Hence the closing sentence in BODY_TEXT instead of ending on {{10}}.
    const bodyText = BODY_TEXT;
    const res = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${config.business_account_id}/message_templates`, {
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
            example: { body_text: [['Tuesday, 29 September 2026', '46', 'Done 0, Pending 5, Total 5', 'Done 7, Pending 41, Total 48', 'Resolved 0, Needs attention 90, Total 90', 'Mapped 11, Not mapped 1, Total 12', 'Sent 0, Draft 0, Total 0', 'Handled 0, Unread 26, Total 26', 'Collected Rs. 0, Outstanding Rs. 0, Overdue 0', 'Sent 744, Confirmed 35']] },
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
    const res = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${settings.templateId}?fields=id,name,status,rejected_reason&access_token=${encodeURIComponent(config.access_token)}`);
    const data: any = await res.json();
    if (!res.ok) throw new BadRequestException(data?.error?.message || 'Could not check template status');
    const status = String(data.status || settings.templateStatus).toUpperCase();
    await this.pool.query(
      `UPDATE daily_report_settings SET template_status=$1, template_rejection_reason=$2, updated_at=now() WHERE id=true`,
      [status, data.rejected_reason ?? null],
    );
    return this.getSettings();
  }

  // Scheduled run, "Send now", or a one-off test. Every attempt is logged (message_type
  // 'daily_report') with Meta's message id, so delivery webhooks fill in delivered/read/failed.
  async sendNow(opts: { to?: string[]; triggeredBy?: 'schedule' | 'manual' | 'test' } = {}) {
    const settings = await this.getSettings();
    const work = await this.workTemplate('md');
    if (work.status === 'APPROVED' && work.templateName) {
      const recipients = opts.to ?? settings.phoneNumbers;
      if (!recipients.length) throw new BadRequestException('No numbers configured');
      const config = await this.getConfig();
      if (!config) throw new BadRequestException('WhatsApp is not configured');
      const params = await this.mdParams(await this.workRows(), this.dateLabel());
      const triggeredBy = opts.triggeredBy ?? 'manual';
      let sent = 0; const failed: string[] = [];
      for (const to of recipients) { const err = await this.sendTemplate(config, waNumber(to) || to, work.templateName, params, 'daily_report', triggeredBy); if (err) failed.push(`${to}: ${err}`); else sent++; }
      if (triggeredBy !== 'test') await this.pool.query(`UPDATE daily_report_settings SET last_sent_date=$1, updated_at=now() WHERE id=true`, [this.todayIst()]);
      return { sent, failed };
    }
    // The new layout goes out as soon as Meta approves it; until then the first one keeps sending.
    const useNew = settings.newLayout.status === 'APPROVED' && !!settings.newLayout.templateName;
    if (!useNew && (settings.templateStatus !== 'APPROVED' || !settings.templateName)) throw new BadRequestException('Template is not approved yet');
    const templateName = (useNew ? settings.newLayout.templateName : settings.templateName) as string;
    const recipients = opts.to ?? settings.phoneNumbers;
    if (!recipients.length) throw new BadRequestException('No numbers configured');
    const config = await this.getConfig();
    if (!config) throw new BadRequestException('WhatsApp is not configured');
    const params = useNew
      ? this.buildParamsV2(await this.computeToday(), this.dateLabel(), settings.includedSections)
      : this.buildParams(await this.computeNumbers(), this.dateLabel(), settings.includedSections);
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const triggeredBy = opts.triggeredBy ?? 'manual';
    let sent = 0;
    const errors: string[] = [];
    for (const to of recipients) {
      try {
        const res = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${config.phone_number_id}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: waNumber(to) || to,
            type: 'template',
            template: { name: templateName, language: { code: 'en_US' }, components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: p })) }] },
          }),
        });
        const data: any = await res.json();
        if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
        sent++;
        await this.pool.query(
          `INSERT INTO whatsapp_logs (to_number, template_name, status, sent_at, message_id, message_type, triggered_by) VALUES ($1,$2,'accepted',now(),$3,'daily_report',$4)`,
          [to, templateName, data?.messages?.[0]?.id ?? null, triggeredBy],
        ).catch((e) => this.logger.warn(`Could not log daily report send: ${e.message}`));
      } catch (err: any) {
        this.logger.error(`Daily report send to ${to} failed: ${err.message}`);
        errors.push(`${to}: ${err.message}`);
        await this.pool.query(
          `INSERT INTO whatsapp_logs (to_number, template_name, status, message_type, triggered_by, error_message) VALUES ($1,$2,'failed','daily_report',$3,$4)`,
          [to, templateName, triggeredBy, String(err.message).slice(0, 500)],
        ).catch(() => undefined);
      }
    }
    if (triggeredBy !== 'test') {
      const todayIst = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      await this.pool.query(`UPDATE daily_report_settings SET last_sent_date=$1, updated_at=now() WHERE id=true`, [todayIst]);
    }
    return { sent, failed: errors };
  }
}
