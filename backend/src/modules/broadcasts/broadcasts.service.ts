import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { TwilioWhatsAppService } from '../integrations/whatsapp/twilio-whatsapp.service';
import { waNumber } from '../integrations/whatsapp/whatsapp-bot.service';

export interface Audience {
  statuses?: string[];
  sources?: string[];
  destination?: string;
  assignedTo?: string[];
  createdFrom?: string;
  createdTo?: string;
  // Only leads who have written to us on WhatsApp at least once.
  onlyChatted?: boolean;
}
// Where each template variable's value comes from, per recipient.
export type VariableSource = { source: 'name' | 'destination' | 'text'; value?: string };

// Meta's charge per template message by the recipient's country code, in USD (approximate,
// from Meta's 2025 rate card -- for a cost preview only; Twilio's bill is the real figure).
const META_RATES: Record<'MARKETING' | 'UTILITY', Record<string, number>> = {
  MARKETING: { '33': 0.0859, '91': 0.0118, '1': 0.025, '44': 0.0529, '49': 0.1365, '34': 0.0615, '39': 0.0691, '32': 0.0703, '41': 0.0703, '971': 0.0384, default: 0.0604 },
  UTILITY: { '33': 0.03, '91': 0.0014, '1': 0.004, '44': 0.022, '49': 0.0456, '34': 0.02, '39': 0.03, '32': 0.0283, '41': 0.0283, '971': 0.0157, default: 0.0113 },
};
const TWILIO_FEE = 0.005;
const PER_TICK = 3;

function metaRate(category: string, phone: string) {
  const table = META_RATES[category === 'UTILITY' ? 'UTILITY' : 'MARKETING'];
  const code = ['971', '33', '91', '44', '49', '34', '39', '32', '41', '1'].find((c) => phone.startsWith(c));
  return code ? table[code] : table.default;
}

// Bulk WhatsApp: one approved template to a filtered list of leads. Sends go out a few per second
// in the background, stop at WhatsApp's 24-hour customer limit and carry on when it frees up, and
// never reach anyone who replied STOP. Delivery status comes back through Twilio's status webhook.
@Injectable()
export class BroadcastsService implements OnModuleInit {
  private logger = new Logger('Broadcasts');
  private ticking = false;

  constructor(@Inject(PG_POOL) private pool: Pool, private twilio: TwilioWhatsAppService) {}

  onModuleInit() {
    setInterval(() => {
      if (this.ticking) return;
      this.ticking = true;
      this.tick().catch((e) => this.logger.error(`Bulk send tick failed: ${e.message}`)).finally(() => { this.ticking = false; });
    }, 3000);
  }

  private assertTwilio() {
    if (!this.twilio.isConfigured()) throw new BadRequestException('Bulk WhatsApp needs the Twilio WhatsApp sender to be configured');
  }

  templates() {
    this.assertTwilio();
    return this.twilio.approvedTemplates();
  }

  async filters() {
    const [statuses, sources, users] = await Promise.all([
      this.pool.query(`SELECT status::text AS v, count(*)::int AS n FROM leads WHERE is_deleted = false GROUP BY 1 ORDER BY 2 DESC`),
      this.pool.query(`SELECT COALESCE(source::text, 'other') AS v, count(*)::int AS n FROM leads WHERE is_deleted = false GROUP BY 1 ORDER BY 2 DESC`),
      this.pool.query(`SELECT id, full_name FROM users WHERE is_active = true AND COALESCE(is_deleted, false) = false ORDER BY full_name`),
    ]);
    return { statuses: statuses.rows, sources: sources.rows, users: users.rows };
  }

  // The leads a filter selects, one per WhatsApp number, without anyone who opted out.
  private async audience(a: Audience) {
    const where: string[] = ['l.is_deleted = false'];
    const params: any[] = [];
    const add = (sql: string, value: any) => { params.push(value); where.push(sql.replace('$?', `$${params.length}`)); };
    // Unless someone picks them on purpose, never market to leads already closed off.
    if (a.statuses?.length) add('l.status::text = ANY($?)', a.statuses);
    else add('NOT (l.status::text = ANY($?))', ['lost', 'not_interested', 'invalid_number', 'duplicate']);
    if (a.sources?.length) add(`COALESCE(l.source::text, 'other') = ANY($?)`, a.sources);
    if (a.destination?.trim()) add('l.destination ILIKE $?', `%${a.destination.trim()}%`);
    if (a.assignedTo?.length) add('l.assigned_to::text = ANY($?)', a.assignedTo);
    if (a.createdFrom) add('l.created_at >= $?::date', a.createdFrom);
    if (a.createdTo) add(`l.created_at < ($?::date + interval '1 day')`, a.createdTo);
    if (a.onlyChatted) where.push(`EXISTS (SELECT 1 FROM whatsapp_messages m WHERE m.lead_id = l.id AND m.direction = 'in')`);
    const { rows } = await this.pool.query(
      `SELECT l.id, l.customer_name, l.destination, COALESCE(NULLIF(l.whatsapp_number, ''), l.phone) AS raw
         FROM leads l WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC LIMIT 20000`, params);
    const { rows: out } = await this.pool.query(`SELECT phone FROM whatsapp_opt_outs`);
    const optedOut = new Set(out.map((r) => r.phone));
    const seen = new Set<string>();
    const recipients: { leadId: string; name: string; destination: string; phone: string }[] = [];
    let invalid = 0; let stopped = 0; let duplicate = 0;
    for (const r of rows) {
      const phone = waNumber(r.raw);
      if (!phone) { invalid++; continue; }
      if (optedOut.has(phone)) { stopped++; continue; }
      if (seen.has(phone)) { duplicate++; continue; }
      seen.add(phone);
      recipients.push({ leadId: r.id, name: String(r.customer_name || ''), destination: String(r.destination || ''), phone });
    }
    return { recipients, matched: rows.length, invalid, stopped, duplicate };
  }

  private async dailyLimit() {
    const health = await this.twilio.health().catch(() => null);
    const m = /(\d[\d,]*)/.exec(String(health?.throughput || ''));
    const limit = m ? Number(m[1].replace(/,/g, '')) : /unlimited/i.test(String(health?.throughput || '')) ? null : 250;
    const { rows } = await this.pool.query(
      `SELECT count(DISTINCT phone)::int AS n FROM whatsapp_broadcast_recipients WHERE sent_at > now() - interval '24 hours' AND status <> 'failed'`);
    return { limit, usedLast24h: rows[0].n as number };
  }

  async preview(input: { audience: Audience; contentSid?: string }) {
    this.assertTwilio();
    const found = await this.audience(input.audience || {});
    const template = input.contentSid ? (await this.twilio.approvedTemplates()).find((t) => t.sid === input.contentSid) : null;
    const category = template?.category || 'MARKETING';
    const cost = found.recipients.reduce((sum, r) => sum + metaRate(category, r.phone) + TWILIO_FEE, 0);
    const billing = await this.twilio.billing().catch(() => null);
    const { limit, usedLast24h } = await this.dailyLimit();
    return {
      count: found.recipients.length, matched: found.matched, invalid: found.invalid, optedOut: found.stopped, duplicates: found.duplicate,
      sample: found.recipients.slice(0, 8).map((r) => ({ name: r.name, phone: r.phone, destination: r.destination })),
      estimate: { currency: 'USD', total: Math.round(cost * 100) / 100, category },
      balance: billing ? { amount: billing.balance, currency: billing.currency } : null,
      dailyLimit: limit, usedLast24h,
    };
  }

  async create(input: { name: string; contentSid: string; variables: Record<string, VariableSource>; audience: Audience }, userId: string | null) {
    this.assertTwilio();
    const name = String(input.name || '').trim();
    if (!name) throw new BadRequestException('Give this bulk send a name');
    const template = (await this.twilio.approvedTemplates()).find((t) => t.sid === input.contentSid);
    if (!template) throw new BadRequestException('Choose an approved WhatsApp template');
    for (const v of template.variables) {
      const src = input.variables?.[String(v.number)];
      if (!src || !['name', 'destination', 'text'].includes(src.source)) throw new BadRequestException(`Choose what goes in {{${v.number}}}`);
      if (src.source === 'text' && !String(src.value || '').trim()) throw new BadRequestException(`Type the text for {{${v.number}}}`);
    }
    const found = await this.audience(input.audience || {});
    if (!found.recipients.length) throw new BadRequestException('No one to send to with these filters');
    const cost = found.recipients.reduce((sum, r) => sum + metaRate(template.category, r.phone) + TWILIO_FEE, 0);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO whatsapp_broadcasts (name, content_sid, template_name, template_body, variables, audience, status, total, estimated_cost, currency, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'sending', $7, $8, 'USD', $9) RETURNING id`,
        [name, template.sid, template.name, template.body, JSON.stringify(input.variables), JSON.stringify(input.audience || {}), found.recipients.length, Math.round(cost * 100) / 100, userId],
      );
      const id = rows[0].id;
      for (let i = 0; i < found.recipients.length; i += 500) {
        const chunk = found.recipients.slice(i, i + 500);
        await client.query(
          `INSERT INTO whatsapp_broadcast_recipients (broadcast_id, lead_id, phone, name)
           SELECT $1, x.lead_id::uuid, x.phone, x.name FROM unnest($2::text[], $3::text[], $4::text[]) AS x(lead_id, phone, name)
           ON CONFLICT DO NOTHING`,
          [id, chunk.map((r) => r.leadId), chunk.map((r) => r.phone), chunk.map((r) => r.name)],
        );
      }
      await client.query('COMMIT');
      this.logger.log(`Bulk send "${name}" queued for ${found.recipients.length} numbers`);
      return this.get(id);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async list() {
    const { rows } = await this.pool.query(
      `SELECT b.id, b.name, b.template_name, b.status, b.total, b.estimated_cost, b.currency, b.created_at, b.finished_at, u.full_name AS created_by_name,
              count(r.id) FILTER (WHERE r.status IN ('sent','delivered','read'))::int AS sent,
              count(r.id) FILTER (WHERE r.status IN ('delivered','read'))::int AS delivered,
              count(r.id) FILTER (WHERE r.status = 'read')::int AS read,
              count(r.id) FILTER (WHERE r.status = 'failed')::int AS failed,
              count(r.id) FILTER (WHERE r.status = 'skipped')::int AS skipped,
              count(r.id) FILTER (WHERE r.status = 'queued')::int AS queued
         FROM whatsapp_broadcasts b
         LEFT JOIN whatsapp_broadcast_recipients r ON r.broadcast_id = b.id
         LEFT JOIN users u ON u.id = b.created_by
        GROUP BY b.id, u.full_name ORDER BY b.created_at DESC LIMIT 100`);
    return rows;
  }

  async get(id: string) {
    const all = await this.list();
    const summary = all.find((b: any) => b.id === id);
    if (!summary) throw new NotFoundException('Bulk send not found');
    const { rows: b } = await this.pool.query(`SELECT template_body, variables, audience FROM whatsapp_broadcasts WHERE id = $1`, [id]);
    const { rows: recipients } = await this.pool.query(
      `SELECT r.lead_id, r.phone, r.name, r.status, r.error, r.sent_at, r.updated_at
         FROM whatsapp_broadcast_recipients r WHERE r.broadcast_id = $1
        ORDER BY CASE r.status WHEN 'failed' THEN 0 WHEN 'queued' THEN 2 ELSE 1 END, r.id LIMIT 2000`, [id]);
    return { ...summary, ...b[0], recipients };
  }

  async setStatus(id: string, action: 'pause' | 'resume' | 'cancel') {
    const next = { pause: 'paused', resume: 'sending', cancel: 'cancelled' }[action];
    const allowed = { pause: ['sending', 'waiting'], resume: ['paused'], cancel: ['sending', 'waiting', 'paused'] }[action];
    const { rowCount } = await this.pool.query(
      `UPDATE whatsapp_broadcasts SET status = $2, finished_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE finished_at END WHERE id = $1 AND status = ANY($3)`,
      [id, next, allowed]);
    if (!rowCount) throw new BadRequestException(`This bulk send cannot be ${action === 'cancel' ? 'cancelled' : action + 'd'} now`);
    if (action === 'cancel') await this.pool.query(`UPDATE whatsapp_broadcast_recipients SET status = 'skipped', error = 'Cancelled', updated_at = now() WHERE broadcast_id = $1 AND status = 'queued'`, [id]);
    return this.get(id);
  }

  // ---------------------------------------------------------------- sender

  private async tick() {
    if (!this.twilio.isConfigured()) return;
    const { rows: active } = await this.pool.query(`SELECT * FROM whatsapp_broadcasts WHERE status IN ('sending', 'waiting') ORDER BY created_at LIMIT 1`);
    const b = active[0];
    if (!b) return;
    const { limit, usedLast24h } = await this.dailyLimit();
    // Leave a tenth of WhatsApp's 24-hour customer limit for itineraries and other messages.
    if (limit !== null && usedLast24h >= Math.floor(limit * 0.9)) {
      if (b.status !== 'waiting') {
        await this.pool.query(`UPDATE whatsapp_broadcasts SET status = 'waiting' WHERE id = $1 AND status = 'sending'`, [b.id]);
        this.logger.warn(`Bulk send "${b.name}" waiting: WhatsApp 24-hour limit (${limit} customers) reached`);
      }
      return;
    }
    if (b.status === 'waiting') await this.pool.query(`UPDATE whatsapp_broadcasts SET status = 'sending' WHERE id = $1 AND status = 'waiting'`, [b.id]);

    // A send cut short by a restart: unknown whether WhatsApp got it, so it is not sent twice.
    await this.pool.query(
      `UPDATE whatsapp_broadcast_recipients SET status = 'failed', error = 'Interrupted by a restart - may not have been sent', updated_at = now()
        WHERE broadcast_id = $1 AND status = 'sending' AND updated_at < now() - interval '2 minutes'`, [b.id]);
    const { rows: batch } = await this.pool.query(
      `UPDATE whatsapp_broadcast_recipients SET status = 'sending', updated_at = now()
        WHERE id IN (SELECT r.id FROM whatsapp_broadcast_recipients r WHERE r.broadcast_id = $1 AND r.status = 'queued' ORDER BY r.id LIMIT $2 FOR UPDATE SKIP LOCKED)
        RETURNING id, lead_id, phone, name`,
      [b.id, PER_TICK]);
    if (!batch.length) {
      const { rows: left } = await this.pool.query(`SELECT 1 FROM whatsapp_broadcast_recipients WHERE broadcast_id = $1 AND status IN ('queued', 'sending') LIMIT 1`, [b.id]);
      if (!left.length) {
        await this.pool.query(`UPDATE whatsapp_broadcasts SET status = 'done', finished_at = now() WHERE id = $1 AND status IN ('sending', 'waiting')`, [b.id]);
        this.logger.log(`Bulk send "${b.name}" finished`);
      }
      return;
    }
    for (const r of batch) await this.sendOne(b, r);
  }

  private async sendOne(b: any, r: { id: number; lead_id: string | null; phone: string; name: string | null }) {
    const { rows: stop } = await this.pool.query(`SELECT 1 FROM whatsapp_opt_outs WHERE phone = $1`, [r.phone]);
    if (stop.length) {
      await this.pool.query(`UPDATE whatsapp_broadcast_recipients SET status = 'skipped', error = 'Replied STOP', updated_at = now() WHERE id = $1`, [r.id]);
      return;
    }
    const { rows: lead } = r.lead_id ? await this.pool.query(`SELECT customer_name, destination FROM leads WHERE id = $1`, [r.lead_id]) : { rows: [] as any[] };
    const firstName = String(lead[0]?.customer_name || r.name || '').trim();
    // A lead saved under its phone number has no real name to greet.
    const name = firstName && !/^\+?\d[\d\s]+$/.test(firstName) ? firstName.slice(0, 60) : 'there';
    const destination = String(lead[0]?.destination || '').trim();
    const vars: Record<string, string> = {};
    for (const [n, src] of Object.entries((b.variables || {}) as Record<string, VariableSource>)) {
      vars[n] = src.source === 'name' ? name
        : src.source === 'destination' ? (destination && !/to be confirmed/i.test(destination) ? destination : 'your next trip')
        : String(src.value || '').trim() || '-';
    }
    try {
      const sid = await this.twilio.sendContent(r.phone, b.content_sid, vars);
      await this.pool.query(`UPDATE whatsapp_broadcast_recipients SET status = 'sent', message_sid = $2, sent_at = now(), error = NULL, updated_at = now() WHERE id = $1`, [r.id, sid]);
      const text = String(b.template_body || b.template_name).replace(/\{\{(\d+)\}\}/g, (_m: string, k: string) => vars[k] ?? '');
      await this.pool.query(
        `INSERT INTO whatsapp_messages (phone_number, lead_id, direction, msg_type, body, wa_message_id, meta) VALUES ($1, $2, 'out', 'text', $3, $4, $5)`,
        [r.phone, r.lead_id, text, sid, JSON.stringify({ waId: sid, template: b.template_name, broadcastId: b.id, broadcastName: b.name })],
      ).catch(() => undefined);
    } catch (e: any) {
      await this.pool.query(`UPDATE whatsapp_broadcast_recipients SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`, [r.id, String(e.message || e).slice(0, 300)]);
    }
  }
}
