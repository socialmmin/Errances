import { BadRequestException, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PG_POOL } from '../../../common/db/pool.module';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

// Statuses that count as a customer having reached each funnel stage (cumulative: a booked lead
// has also been qualified, quoted and paid).
const RANK_SQL = `CASE l.status::text
  WHEN 'qualified' THEN 1 WHEN 'quotation_sent' THEN 2 WHEN 'negotiation' THEN 2
  WHEN 'advance_paid' THEN 3 WHEN 'booking_confirmed' THEN 4 WHEN 'won' THEN 4 ELSE 0 END`;

/**
 * CRM outcomes -> Meta (Conversions API), plus the lead-quality funnel report and the audience exports.
 * Sending is OFF until switched to test or live in meta_capi_settings, so nothing reaches Meta by accident.
 */
@Injectable()
export class MetaCapiService implements OnModuleInit {
  private logger = new Logger('MetaCapiService');
  private running = false;

  constructor(@Inject(PG_POOL) private pool: Pool, private config: ConfigService) {}

  onModuleInit() {
    setInterval(() => this.processQueue().catch((e) => this.logger.error(`queue: ${e.message}`)), 2 * 60_000);
  }

  private get token() { return this.config.get<string>('META_SYSTEM_USER_ACCESS_TOKEN'); }
  private get version() { return this.config.get<string>('META_GRAPH_API_VERSION') || 'v23.0'; }
  private get account() { const a = this.config.get<string>('META_AD_ACCOUNT_ID') || ''; return a.startsWith('act_') ? a : `act_${a}`; }

  async settings() {
    const { rows } = await this.pool.query(`SELECT mode, dataset_id, test_event_code FROM meta_capi_settings WHERE id = true`);
    return rows[0] as { mode: 'off' | 'test' | 'live'; dataset_id: string | null; test_event_code: string | null };
  }

  async status() {
    const s = await this.settings();
    const { rows } = await this.pool.query(`SELECT event_name, status, count(*)::int AS n FROM meta_conversion_events GROUP BY 1,2 ORDER BY 1,2`);
    const { rows: err } = await this.pool.query(`SELECT event_name, response, created_at FROM meta_conversion_events WHERE status='failed' ORDER BY created_at DESC LIMIT 5`);
    return { mode: s.mode, datasetId: s.dataset_id, testEventCode: s.test_event_code, events: rows, recentErrors: err };
  }

  // Actually calls Meta right now -- never a cached/stored flag. If this says connected, Meta itself
  // just confirmed the token is valid and the dataset is reachable at this moment.
  async liveConnectionCheck() {
    const s = await this.settings();
    if (!this.token) return { connected: false, reason: 'No Meta access token is configured on the server.' };
    if (!s.dataset_id) return { connected: false, reason: 'No dataset ID is set.' };
    try {
      const u = new URL(`https://graph.facebook.com/${this.version}/${s.dataset_id}`);
      u.searchParams.set('fields', 'id,name,last_fired_time');
      u.searchParams.set('access_token', this.token);
      const res = await fetch(u);
      const j: any = await res.json();
      if (!res.ok) return { connected: false, reason: j?.error?.message || `Meta returned HTTP ${res.status}`, checkedAt: new Date().toISOString() };
      return { connected: true, datasetName: j.name as string, lastFiredTime: j.last_fired_time as string | null, checkedAt: new Date().toISOString() };
    } catch (e: any) {
      return { connected: false, reason: e.message, checkedAt: new Date().toISOString() };
    }
  }

  // What Meta's own dataset actually recorded, per event name, for the last N days -- the real
  // confirmation that an event we sent was received and counted, not just that our POST returned 200.
  async metaSideStats(days = 14) {
    const s = await this.settings();
    if (!this.token || !s.dataset_id) return { available: false, reason: 'Meta is not configured', totals: {} as Record<string, number> };
    try {
      const u = new URL(`https://graph.facebook.com/${this.version}/${s.dataset_id}/stats`);
      u.searchParams.set('aggregation', 'event');
      u.searchParams.set('start_time', String(Math.floor(Date.now() / 1000) - days * 86400));
      u.searchParams.set('end_time', String(Math.floor(Date.now() / 1000)));
      u.searchParams.set('access_token', this.token);
      const res = await fetch(u);
      const j: any = await res.json();
      if (!res.ok) return { available: false, reason: j?.error?.message || `HTTP ${res.status}`, totals: {} };
      const totals: Record<string, number> = {};
      for (const bucket of j.data ?? []) for (const row of bucket.data ?? []) totals[row.value] = (totals[row.value] || 0) + Number(row.count || 0);
      return { available: true, totals, days };
    } catch (e: any) {
      return { available: false, reason: e.message, totals: {} };
    }
  }

  async setMode(mode: string, testEventCode?: string, datasetId?: string) {
    if (!['off', 'test', 'live'].includes(mode)) throw new BadRequestException('mode must be off, test or live');
    if (mode === 'test' && !String(testEventCode || '').trim()) throw new BadRequestException('Test mode needs the test event code from Events Manager > Test events');
    await this.pool.query(
      `UPDATE meta_capi_settings SET mode=$1, test_event_code=COALESCE($2, test_event_code), dataset_id=COALESCE($3, dataset_id), updated_at=now() WHERE id = true`,
      [mode, testEventCode?.trim() || null, datasetId?.trim() || null],
    );
    // Events that were only test-delivered still have to go out for real when going live.
    if (mode === 'live') await this.pool.query(`UPDATE meta_conversion_events SET status='pending', attempts=0 WHERE status='test_sent'`);
    return this.status();
  }

  // ---- the value of a conversion: the booking, else the latest quotation
  private async valueFor(leadId: string): Promise<number | null> {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(
                (SELECT b.total_amount FROM bookings b JOIN quotations q ON q.id = b.quotation_id WHERE q.lead_id = $1 AND b.is_deleted = false ORDER BY b.created_at DESC LIMIT 1),
                (SELECT q.final_amount FROM quotations q WHERE q.lead_id = $1 AND q.is_deleted = false ORDER BY q.created_at DESC LIMIT 1)) AS v`,
      [leadId],
    );
    const v = Number(rows[0]?.v);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  private async sendOne(ev: any, s: { mode: string; dataset_id: string | null; test_event_code: string | null }) {
    const leadDigits = String(ev.meta_leadgen_id || '').replace(/\D/g, '');
    if (!leadDigits) return { ok: false, skipped: true, msg: 'lead has no Meta lead ID' };
    if (!this.token || !s.dataset_id) return { ok: false, msg: 'Meta token or dataset is not configured' };
    const phoneDigits = String(ev.phone || '').replace(/\D/g, '');
    const local = phoneDigits.slice(-10);
    const ph = /^[6-9]\d{9}$/.test(local) ? `91${local}` : phoneDigits;
    const value = ['AdvancePaid', 'Booked'].includes(ev.event_name) ? await this.valueFor(ev.lead_id) : null;
    const at = Math.floor(new Date(ev.event_time).getTime() / 1000);
    const event: any = {
      event_name: ev.event_name,
      event_time: Math.floor(Date.now() / 1000) - at > 6 * 86400 ? Math.floor(Date.now() / 1000) : at, // Meta refuses events older than 7 days
      event_id: ev.id,
      action_source: 'system_generated',
      user_data: { lead_id: '__LEAD__', ...(ph ? { ph: [sha(ph)] } : {}), ...(ev.email ? { em: [sha(String(ev.email).trim().toLowerCase())] } : {}) },
      custom_data: { event_source: 'crm', lead_event_source: 'Errances Voyages CRM', ...(value ? { value, currency: 'INR' } : {}) },
    };
    // Meta wants the lead id as a whole number; a 16-digit id would lose precision as a JS number, so it is spliced in as text.
    const body = JSON.stringify({ data: [event], ...(s.mode === 'test' ? { test_event_code: s.test_event_code } : {}) }).replace('"__LEAD__"', leadDigits);
    const res = await fetch(`https://graph.facebook.com/${this.version}/${s.dataset_id}/events?access_token=${encodeURIComponent(this.token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || !(json.events_received >= 1)) return { ok: false, msg: json?.error?.message || `HTTP ${res.status}`, value };
    return { ok: true, msg: `received ${json.events_received} (trace ${json.fbtrace_id})`, value };
  }

  // Sends one Qualified event for a real Meta lead to Events Manager > Test events. Only works in test mode.
  async sendTestEvent(leadId: string) {
    const s = await this.settings();
    if (s.mode !== 'test') throw new BadRequestException('Switch to test mode first (with your test event code)');
    const { rows } = await this.pool.query(
      `SELECT id AS lead_id, meta_leadgen_id, email, COALESCE(NULLIF(whatsapp_number,''), phone) AS phone FROM leads WHERE id = $1 AND is_deleted = false`, [leadId]);
    if (!rows[0]) throw new BadRequestException('Lead not found');
    const r: any = await this.sendOne({ ...rows[0], id: randomUUID(), event_name: 'Qualified', event_time: new Date() }, s);
    return { ok: !!r.ok, message: r.msg };
  }

  async processQueue() {
    if (this.running) return;
    const s = await this.settings();
    if (!s || s.mode === 'off') return;
    this.running = true;
    try {
      const { rows } = await this.pool.query(
        `SELECT e.id, e.lead_id, e.event_name, e.event_time, l.meta_leadgen_id, l.email,
                COALESCE(NULLIF(l.whatsapp_number,''), l.phone) AS phone
           FROM meta_conversion_events e JOIN leads l ON l.id = e.lead_id
          WHERE e.status = 'pending' AND e.attempts < 5 ORDER BY e.created_at LIMIT 50`,
      );
      for (const ev of rows) {
        const r: any = await this.sendOne(ev, s).catch((err) => ({ ok: false, msg: err.message }));
        await this.pool.query(
          `UPDATE meta_conversion_events SET status=$2, attempts=attempts+1, response=$3, value=$4, sent_at=CASE WHEN $2 IN ('sent','test_sent') THEN now() ELSE sent_at END WHERE id=$1`,
          [ev.id, r.ok ? (s.mode === 'live' ? 'sent' : 'test_sent') : r.skipped ? 'skipped' : 'failed', r.msg ?? null, r.value ?? null],
        );
        if (!r.ok) this.logger.warn(`Meta event ${ev.event_name} for lead ${ev.lead_id}: ${r.msg}`);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (rows.length) this.logger.log(`Meta events processed: ${rows.length} (mode ${s.mode})`);
    } finally { this.running = false; }
  }

  // ---- manual override of the automatic quality (and the reason a lead was lost)
  async setQuality(leadId: string, quality: string | null, lostReason?: string | null) {
    if (quality !== null && !['GOOD', 'NEUTRAL', 'BAD'].includes(quality)) throw new BadRequestException('quality must be GOOD, NEUTRAL, BAD or null');
    await this.pool.query(
      `UPDATE leads SET quality_override = $2, lost_reason = COALESCE($3, lost_reason), updated_at = now() WHERE id = $1`,
      [leadId, quality, lostReason === undefined ? null : lostReason],
    );
    return { ok: true };
  }

  // ---- fill the Meta IDs for leads that came in before they were stored as columns
  async backfillIds() {
    await this.pool.query(
      `UPDATE leads l SET meta_leadgen_id = lr.meta_leadgen_id FROM lead_requirements lr WHERE lr.lead_id = l.id AND l.meta_leadgen_id IS NULL AND lr.meta_leadgen_id IS NOT NULL`,
    );
    const { rows } = await this.pool.query(
      `SELECT id, meta_leadgen_id FROM leads WHERE meta_leadgen_id IS NOT NULL AND is_deleted = false AND (meta_campaign_id IS NULL OR meta_adset_id IS NULL OR meta_ad_id IS NULL OR meta_form_id IS NULL)`,
    );
    let filled = 0, failed = 0;
    for (const r of rows) {
      try {
        const u = new URL(`https://graph.facebook.com/${this.version}/${r.meta_leadgen_id}`);
        u.searchParams.set('fields', 'ad_id,adset_id,adset_name,campaign_id,campaign_name,form_id');
        u.searchParams.set('access_token', this.token || '');
        const res = await fetch(u);
        const j: any = await res.json();
        if (!res.ok) { failed++; continue; }
        await this.pool.query(
          `UPDATE leads SET meta_campaign_id = COALESCE(meta_campaign_id, $2), meta_adset_id = COALESCE(meta_adset_id, $3), meta_adset_name = COALESCE(meta_adset_name, $4),
                  meta_ad_id = COALESCE(meta_ad_id, $5), meta_form_id = COALESCE(meta_form_id, $6), campaign_name = COALESCE(campaign_name, $7) WHERE id = $1`,
          [r.id, j.campaign_id ?? null, j.adset_id ?? null, j.adset_name ?? null, j.ad_id ?? null, j.form_id ?? null, j.campaign_name ?? null],
        );
        filled++;
      } catch { failed++; }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return { candidates: rows.length, filled, failed };
  }

  async idCoverage() {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS meta_leads,
              count(meta_leadgen_id)::int AS with_lead_id, count(*) FILTER (WHERE meta_leadgen_id IS NULL)::int AS missing_lead_id,
              count(meta_campaign_id)::int AS with_campaign, count(meta_adset_id)::int AS with_adset, count(meta_ad_id)::int AS with_ad, count(meta_form_id)::int AS with_form
         FROM leads WHERE source = 'meta_ads' AND is_deleted = false`,
    );
    return rows[0];
  }

  // ---- the learning-loop status: what stage we're at, and what evidence backs each stage
  async learningStatus() {
    const conn = await this.liveConnectionCheck();
    const s = await this.settings();
    const { rows: qRows } = await this.pool.query(`SELECT quality, count(*)::int AS n FROM lead_quality_v GROUP BY 1`);
    const quality = { GOOD: 0, NEUTRAL: 0, BAD: 0 } as Record<string, number>;
    for (const r of qRows) quality[r.quality] = r.n;
    const { rows: qed } = await this.pool.query(`SELECT event_name, count(*)::int AS n FROM meta_conversion_events WHERE status IN ('sent','test_sent') GROUP BY 1`);
    const sentByEvent = Object.fromEntries(qed.map((r) => [r.event_name, r.n]));
    const totalSent = qed.reduce((s2, r) => s2 + r.n, 0);
    const metaStats = await this.metaSideStats(30);
    // Meta needs a working minimum of real conversion events (roughly 15-25 in a 7-day window, per
    // event) before an ad set can reliably optimize toward that event. We surface our own count
    // honestly rather than claim a number Meta hasn't confirmed.
    const meaningfulEvents = ['Qualified', 'QuotationSent', 'AdvancePaid', 'Booked', 'Disqualified'];
    const readiness = meaningfulEvents.map((name) => ({ event: name, sentByCrm: sentByEvent[name] || 0, confirmedByMeta: metaStats.totals?.[name] || 0, readyToOptimize: (metaStats.totals?.[name] || 0) >= 15 }));
    return {
      connection: conn,
      mode: s.mode,
      leadClassification: quality,
      eventsSentTotal: totalSent,
      eventsByType: sentByEvent,
      metaConfirmed: metaStats,
      readiness,
      stage: !conn.connected ? 'not_connected' : s.mode === 'off' ? 'off' : totalSent === 0 ? 'connected_no_events' : (metaStats.available && Object.values(metaStats.totals || {}).some((n: number) => n > 0)) ? 'meta_receiving' : 'sent_unconfirmed',
    };
  }

  // ---- funnel report: campaign -> leads -> valid -> good -> qualified -> quotation -> advance -> booked -> revenue
  async funnel() {
    const { rows } = await this.pool.query(
      `WITH j AS (
         SELECT l.id, COALESCE(NULLIF(regexp_replace(COALESCE(l.campaign_name,''), ' – Lead Form$', ''), ''), '(no campaign)') AS camp,
                q.quality, q.reason, l.status::text AS st, ${RANK_SQL} AS rank,
                (SELECT COALESCE(b.total_amount, 0) FROM bookings b JOIN quotations qq ON qq.id = b.quotation_id
                  WHERE qq.lead_id = l.id AND b.is_deleted = false ORDER BY b.created_at DESC LIMIT 1) AS revenue
           FROM leads l JOIN lead_quality_v q ON q.lead_id = l.id
          WHERE l.is_deleted = false AND l.source = 'meta_ads')
       SELECT camp AS campaign,
              count(*)::int AS leads,
              count(*) FILTER (WHERE NOT (COALESCE(reason,'') IN ('invalid_or_missing_phone','duplicate_phone') OR st IN ('invalid_number','wrong_number','duplicate')))::int AS valid,
              count(*) FILTER (WHERE quality = 'GOOD')::int AS good,
              count(*) FILTER (WHERE quality = 'BAD')::int AS bad,
              count(*) FILTER (WHERE rank >= 1)::int AS qualified,
              count(*) FILTER (WHERE rank >= 2)::int AS quotation,
              count(*) FILTER (WHERE rank >= 3)::int AS advance,
              count(*) FILTER (WHERE rank >= 4)::int AS booked,
              COALESCE(sum(revenue) FILTER (WHERE rank >= 3), 0)::float AS revenue
         FROM j GROUP BY camp ORDER BY leads DESC`,
    );
    // Spend per campaign, straight from Meta.
    const spend = new Map<string, number>();
    let spendError: string | null = null;
    try {
      if (!this.token) throw new Error('Meta is not configured');
      const u = new URL(`https://graph.facebook.com/${this.version}/${this.account}/insights`);
      u.searchParams.set('fields', 'campaign_name,spend'); u.searchParams.set('level', 'campaign'); u.searchParams.set('date_preset', 'maximum'); u.searchParams.set('limit', '200');
      u.searchParams.set('access_token', this.token);
      const res = await fetch(u); const j: any = await res.json();
      if (!res.ok) throw new Error(j?.error?.message || `HTTP ${res.status}`);
      for (const r of j.data ?? []) {
        const name = String(r.campaign_name || '').replace(/ – Lead Form$/, '');
        spend.set(name, (spend.get(name) ?? 0) + Number(r.spend || 0));
      }
    } catch (e: any) { spendError = e.message; }
    const div = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) / 100 : null);
    const data = rows.map((r: any) => {
      const sp = spend.get(r.campaign) ?? null;
      return {
        ...r, spend: sp,
        cpl: sp != null ? div(sp, r.leads) : null,
        costPerValid: sp != null ? div(sp, r.valid) : null,
        costPerGood: sp != null ? div(sp, r.good) : null,
        costPerQualified: sp != null ? div(sp, r.qualified) : null,
        costPerBooking: sp != null ? div(sp, r.booked) : null,
        roas: sp != null && sp > 0 ? Math.round((r.revenue / sp) * 100) / 100 : null,
      };
    });
    const known = new Set(rows.map((r: any) => r.campaign));
    const otherSpend = Array.from(spend.entries()).filter(([n]) => !known.has(n)).reduce((s, [, v]) => s + v, 0);
    return { data, spendWithoutCrmLeads: Math.round(otherSpend), spendError };
  }

  // ---- audience segments (CSV for Ads Manager > Audiences > Customer list)
  private segmentWhere(segment: string) {
    switch (segment) {
      case 'booked': return `l.status::text IN ('booking_confirmed','won')`;
      case 'advance': return `l.status::text IN ('advance_paid','booking_confirmed','won')`;
      case 'qualified': return `l.status::text IN ('qualified','quotation_sent','negotiation','advance_paid','booking_confirmed','won')`;
      case 'bad': return `q.quality = 'BAD'`;
      case 'invalid': return `(COALESCE(q.reason,'') IN ('invalid_or_missing_phone','duplicate_phone') OR l.status::text IN ('invalid_number','wrong_number','duplicate'))`;
      default: throw new BadRequestException('Unknown segment');
    }
  }

  async audienceCounts() {
    const out: Record<string, number> = {};
    for (const seg of ['booked', 'advance', 'qualified', 'bad', 'invalid']) {
      const { rows } = await this.pool.query(`SELECT count(*)::int AS n FROM leads l JOIN lead_quality_v q ON q.lead_id = l.id WHERE l.is_deleted = false AND ${this.segmentWhere(seg)}`);
      out[seg] = rows[0].n;
    }
    return out;
  }

  async audienceCsv(segment: string) {
    const { rows } = await this.pool.query(
      `SELECT l.customer_name, l.email, COALESCE(NULLIF(l.whatsapp_number,''), l.phone) AS phone
         FROM leads l JOIN lead_quality_v q ON q.lead_id = l.id WHERE l.is_deleted = false AND ${this.segmentWhere(segment)} ORDER BY l.created_at`,
    );
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = ['phone,email,fn,ln,country'];
    for (const r of rows) {
      const digits = String(r.phone || '').replace(/\D/g, '');
      const local = digits.slice(-10);
      const phone = /^[6-9]\d{9}$/.test(local) ? `+91${local}` : digits ? `+${digits}` : '';
      const [fn, ...rest] = String(r.customer_name || '').trim().split(/\s+/);
      lines.push([phone, r.email || '', fn || '', rest.join(' '), 'IN'].map(esc).join(','));
    }
    return lines.join('\n');
  }
}
