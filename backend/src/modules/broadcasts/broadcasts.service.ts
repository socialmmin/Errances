import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { ApprovedTemplate, TwilioWhatsAppService } from '../integrations/whatsapp/twilio-whatsapp.service';
import { MetaWhatsAppService } from '../integrations/whatsapp/meta-whatsapp.service';
import { waNumber } from '../integrations/whatsapp/whatsapp-bot.service';
import { R2Service } from '../../common/r2/r2.service';

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
// A template written on the Bulk WhatsApp page, before it is submitted to WhatsApp.
export interface NewTemplate {
  name: string;
  category: 'MARKETING' | 'UTILITY';
  language: 'en' | 'fr';
  body: string;
  // Example value for each blank {{1}}, {{2}}... in order -- WhatsApp's reviewers see these.
  samples: string[];
  footer?: string;
  buttons?: { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url?: string; phone?: string }[];
  // An uploaded image or PDF shown above the message.
  headerObjectKey?: string;
  headerFileName?: string;
}

// Meta's charge per template message by the recipient's country code, in USD (approximate,
// from Meta's 2025 rate card -- for a cost preview only; Twilio's bill is the real figure).
const META_RATES: Record<'MARKETING' | 'UTILITY', Record<string, number>> = {
  MARKETING: { '33': 0.1432, '91': 0.0118, '1': 0.025, '44': 0.0529, '49': 0.1365, '34': 0.0615, '39': 0.0691, '32': 0.0703, '41': 0.0703, '971': 0.0384, default: 0.0604 },
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
// never reach anyone who replied STOP. Works through whichever provider is switched on (Twilio or
// Meta's Cloud API); delivery status comes back through that provider's webhook.
@Injectable()
export class BroadcastsService implements OnModuleInit {
  private logger = new Logger('Broadcasts');
  private ticking = false;

  constructor(@Inject(PG_POOL) private pool: Pool, private twilio: TwilioWhatsAppService, private meta: MetaWhatsAppService, private r2: R2Service) {}

  onModuleInit() {
    setInterval(() => {
      if (this.ticking) return;
      this.ticking = true;
      this.tick().catch((e) => this.logger.error(`Bulk send tick failed: ${e.message}`)).finally(() => { this.ticking = false; });
    }, 3000);
  }

  private provider() { return this.twilio.activeProvider(); }

  private async assertReady() {
    if (this.provider() === 'meta' && !(await this.meta.connection())) throw new BadRequestException('WhatsApp is not connected yet (Settings > WhatsApp)');
  }

  private async allTemplates(): Promise<ApprovedTemplate[]> {
    try {
      return this.provider() === 'twilio' ? await this.twilio.listTemplates() : await this.meta.listTemplates();
    } catch (e: any) {
      throw new BadRequestException(`Could not read the WhatsApp templates: ${e.message}`);
    }
  }

  private async approvedTemplates() {
    return (await this.allTemplates()).filter((t) => t.status === 'APPROVED');
  }

  // Sends one approved template through the active provider and returns the message id its
  // delivery receipts will carry. `vars` are the values for {{1}}, {{2}}... by number.
  private async deliver(t: { sid: string; name: string; language: string | null }, phone: string, vars: Record<string, string>): Promise<string> {
    if (this.provider() === 'twilio') return this.twilio.sendContent(phone, t.sid, vars);
    // Meta wants the image or PDF above the message sent again each time; it is the file the
    // template was written with on this page.
    const { rows } = await this.pool.query(`SELECT header_format, header_object_key, header_filename FROM meta_templates_local WHERE name = $1 ORDER BY (language = $2) DESC LIMIT 1`, [t.name, t.language]);
    const file = rows[0]?.header_object_key ? rows[0] : null;
    const header = file ? { format: String(file.header_format), filename: String(file.header_filename), link: this.twilio.mediaUrl(await this.twilio.mediaLink({ objectKey: file.header_object_key }, file.header_filename)) } : undefined;
    const values = Object.keys(vars).map(Number).sort((a, b) => a - b).map((n) => vars[String(n)]);
    return this.meta.sendTemplate(phone, { name: t.name, language: t.language || 'en_US' }, values, header);
  }

  // Every template submitted to WhatsApp with its approval state; the ones written on this page
  // (and so safe to delete here) are marked.
  async templates() {
    await this.assertReady();
    const [all, { rows }] = await Promise.all([
      this.allTemplates(),
      this.provider() === 'twilio'
        ? this.pool.query(`SELECT content_sid AS id FROM twilio_contents WHERE meta->>'origin' = 'bulk'`)
        : this.pool.query(`SELECT template_id AS id FROM meta_templates_local WHERE template_id IS NOT NULL`),
    ]);
    const mine = new Set(rows.map((r) => r.id));
    return all.map((t) => ({ ...t, createdHere: mine.has(t.sid) }));
  }

  // Checks a template the way WhatsApp will, so mistakes are explained here and not by a
  // rejection hours later; then creates it with the active provider, which submits it for approval.
  async createTemplate(input: NewTemplate) {
    await this.assertReady();
    const name = String(input?.name || '').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
    if (!name) throw new BadRequestException('Give the template a name');
    const category = input.category === 'UTILITY' ? 'UTILITY' : 'MARKETING';
    const body = String(input.body || '').trim();
    if (!body) throw new BadRequestException('Write the message text');
    if (body.length > 1024) throw new BadRequestException('The message text can be at most 1,024 characters');
    const numbers = [...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
    if (/\{\{(?!\d+\}\})/.test(body)) throw new BadRequestException('Blanks must be written {{1}}, {{2}}... with a number inside');
    if (numbers.some((n, i) => n !== i + 1)) throw new BadRequestException('Number the blanks in order without gaps: {{1}}, {{2}}, {{3}}...');
    if (/^\{\{\d+\}\}/.test(body) || /\{\{\d+\}\}$/.test(body)) throw new BadRequestException('WhatsApp does not accept a message that starts or ends with a blank -- add some words before the first and after the last one');
    if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(body)) throw new BadRequestException('Put some words between two blanks');
    const samples = numbers.map((n) => String(input.samples?.[n - 1] || '').trim());
    if (samples.some((v) => !v)) throw new BadRequestException('Give an example for every blank -- WhatsApp needs them to review the template');
    const footer = String(input.footer || '').trim();
    if (footer.length > 60) throw new BadRequestException('The footer can be at most 60 characters');

    const buttons = (input.buttons ?? []).filter((b) => String(b?.text || '').trim());
    if (buttons.length > 3) throw new BadRequestException('A template can have up to 3 buttons');
    const metaButtons = buttons.map((b) => {
      const text = String(b.text).trim();
      if (text.length > 25) throw new BadRequestException(`Button text "${text}" is longer than 25 characters`);
      if (b.type === 'URL') {
        const url = String(b.url || '').trim();
        if (!/^https:\/\/\S+\.\S+$/.test(url)) throw new BadRequestException(`The "${text}" button needs a full link starting with https://`);
        return { type: 'URL', text, url };
      }
      if (b.type === 'PHONE_NUMBER') {
        const number = waNumber(b.phone);
        if (!number) throw new BadRequestException(`The "${text}" button needs a valid phone number, for example 06 12 34 56 78 or +33 6 12 34 56 78`);
        return { type: 'PHONE_NUMBER', text, phone_number: '+' + number };
      }
      return { type: 'QUICK_REPLY', text };
    });

    const components: any[] = [];
    let header: { objectKey: string; filename: string; format: string } | null = null;
    if (input.headerObjectKey) {
      const file = await this.r2.getObject(input.headerObjectKey);
      if (!file) throw new BadRequestException('The uploaded image or document could not be found -- upload it again');
      const isImage = /^image\/(jpeg|png)$/.test(file.contentType);
      if (!isImage && file.contentType !== 'application/pdf') throw new BadRequestException('The header must be a JPG or PNG image, or a PDF');
      if (file.body.length > (isImage ? 5 : 16) * 1024 * 1024) throw new BadRequestException(isImage ? 'The image must be under 5 MB' : 'The PDF must be under 16 MB');
      header = { objectKey: input.headerObjectKey, filename: String(input.headerFileName || '').trim() || (isImage ? 'image.jpg' : 'document.pdf'), format: isImage ? 'IMAGE' : 'DOCUMENT' };
    }
    components.push({ type: 'BODY', text: body, ...(samples.length ? { example: { body_text: [samples] } } : {}) });
    if (footer) components.push({ type: 'FOOTER', text: footer });
    if (metaButtons.length) components.push({ type: 'BUTTONS', buttons: metaButtons });

    const existing = await this.allTemplates();
    if (existing.some((t) => t.name === name)) throw new BadRequestException(`A template called "${name}" already exists -- choose another name`);
    const language = input.language === 'fr' ? 'fr' : 'en_US';
    let created: { id: string; status: string };
    try {
      if (this.provider() === 'twilio') {
        // Twilio takes the sample file as part of the template definition.
        const withHeader = header ? [{ type: 'HEADER', format: header.format, example: { header_handle: [`twsample:${header.objectKey}`], file_name: header.filename } }, ...components] : components;
        created = await this.twilio.createTemplate({ name, language, category, components: withHeader });
        await this.pool.query(`UPDATE twilio_contents SET meta = COALESCE(meta, '{}'::jsonb) || '{"origin":"bulk"}'::jsonb WHERE content_sid = $1`, [created.id]);
      } else {
        created = await this.meta.createTemplate({ name, language, category, components }, header ?? undefined);
        await this.pool.query(
          `INSERT INTO meta_templates_local (name, language, template_id, header_format, header_object_key, header_filename) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (name, language) DO UPDATE SET template_id = $3, header_format = $4, header_object_key = $5, header_filename = $6, created_at = now()`,
          [name, language, created.id, header?.format ?? null, header?.objectKey ?? null, header?.filename ?? null]);
      }
    } catch (e: any) {
      throw new BadRequestException(String(e.message || e));
    }
    this.logger.log(`Template ${name} written on the Bulk WhatsApp page and submitted (${created.id})`);
    return { sid: created.id, name, status: created.status };
  }

  // Only templates written on this page: the itinerary, payment and report templates belong to
  // their own screens, and deleting one of those here would break what sends it.
  async deleteTemplate(sid: string) {
    await this.assertReady();
    const twilio = this.provider() === 'twilio';
    const { rows } = twilio
      ? await this.pool.query(`SELECT name FROM twilio_contents WHERE content_sid = $1 AND meta->>'origin' = 'bulk'`, [sid])
      : await this.pool.query(`SELECT name FROM meta_templates_local WHERE template_id = $1`, [sid]);
    if (!rows[0]) throw new BadRequestException('Only templates created on this page can be deleted here');
    const { rows: busy } = await this.pool.query(`SELECT 1 FROM whatsapp_broadcasts WHERE content_sid = $1 AND status IN ('sending', 'waiting', 'paused') LIMIT 1`, [sid]);
    if (busy.length) throw new BadRequestException('A bulk send is still using this template -- cancel it or let it finish first');
    try {
      if (twilio) await this.twilio.deleteTemplate(rows[0].name);
      else { await this.meta.deleteTemplate(rows[0].name); await this.pool.query(`DELETE FROM meta_templates_local WHERE template_id = $1`, [sid]); }
    } catch (e: any) {
      throw new BadRequestException(String(e.message || e));
    }
    return { ok: true };
  }

  private resolveVariables(variables: Record<string, VariableSource>, customerName: string, leadDestination: string) {
    const first = String(customerName || '').trim();
    // A lead saved under its phone number, or as ".", has no real name to greet.
    const name = /\p{L}/u.test(first) ? first.slice(0, 60) : 'there';
    const destination = String(leadDestination || '').trim();
    const vars: Record<string, string> = {};
    for (const [n, src] of Object.entries(variables || {})) {
      vars[n] = src.source === 'name' ? name
        : src.source === 'destination' ? (destination && !/to be confirmed/i.test(destination) ? destination : 'your next trip')
        : String(src.value || '').trim() || '-';
    }
    return vars;
  }

  // One message to one number typed in by hand, to see the template on a real phone before a bulk
  // send. If the number belongs to a lead, that lead's name and destination fill the blanks and
  // the message is kept in their chat.
  async testSend(input: { contentSid: string; variables: Record<string, VariableSource>; phone: string }) {
    await this.assertReady();
    const phone = waNumber(input?.phone);
    if (!phone) throw new BadRequestException('Enter a valid WhatsApp number, for example 06 12 34 56 78 or +33 6 12 34 56 78');
    const template = (await this.approvedTemplates()).find((t) => t.sid === input.contentSid);
    if (!template) throw new BadRequestException('Choose an approved WhatsApp template');
    for (const v of template.variables) {
      const src = input.variables?.[String(v.number)];
      if (!src || (src.source === 'text' && !String(src.value || '').trim())) throw new BadRequestException(`Fill in {{${v.number}}} first`);
    }
    const { rows: lead } = await this.pool.query(
      `SELECT id, customer_name, destination FROM leads WHERE is_deleted = false
          AND right(regexp_replace(COALESCE(NULLIF(whatsapp_number, ''), phone, ''), '[^0-9]', '', 'g'), 9) = $1 ORDER BY created_at DESC LIMIT 1`, [phone.slice(-9)]);
    const vars = this.resolveVariables(input.variables, lead[0]?.customer_name || '', lead[0]?.destination || '');
    let sid: string;
    try {
      sid = await this.deliver(template, phone, vars);
    } catch (e: any) {
      throw new BadRequestException(String(e.message || e));
    }
    const text = String(template.body || template.name).replace(/\{\{(\d+)\}\}/g, (_m: string, k: string) => vars[k] ?? '');
    await this.pool.query(
      `INSERT INTO whatsapp_messages (phone_number, lead_id, direction, msg_type, body, wa_message_id, meta) VALUES ($1, $2, 'out', 'text', $3, $4, $5)`,
      [phone, lead[0]?.id ?? null, text, sid, JSON.stringify({ waId: sid, template: template.name, test: true })],
    ).catch(() => undefined);
    return { sid, to: phone, leadId: lead[0]?.id ?? null };
  }

  async testStatus(sid: string) {
    if (/^(SM|MM)[0-9a-f]{32}$/i.test(sid)) return this.twilio.messageStatus(sid).catch((e) => { throw new BadRequestException(String(e.message || e)); });
    // Through Meta the state arrives on the webhook and is kept with the message.
    const { rows } = await this.pool.query(`SELECT meta->>'status' AS status, meta->>'error' AS error FROM whatsapp_messages WHERE wa_message_id = $1 LIMIT 1`, [sid]);
    if (!rows[0]) throw new BadRequestException('Unknown message');
    return { status: rows[0].status || 'sent', error: rows[0].error || null };
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
    let limit: number | null;
    if (this.provider() === 'twilio') {
      const health = await this.twilio.health().catch(() => null);
      const m = /(\d[\d,]*)/.exec(String(health?.throughput || ''));
      limit = m ? Number(m[1].replace(/,/g, '')) : /unlimited/i.test(String(health?.throughput || '')) ? null : 250;
    } else {
      const status = await this.meta.status().catch(() => null);
      limit = status ? status.dailyLimit : 250;
    }
    const { rows } = await this.pool.query(
      `SELECT count(DISTINCT phone)::int AS n FROM whatsapp_broadcast_recipients WHERE sent_at > now() - interval '24 hours' AND status <> 'failed'`);
    return { limit, usedLast24h: rows[0].n as number };
  }

  async preview(input: { audience: Audience; contentSid?: string }) {
    await this.assertReady();
    const twilio = this.provider() === 'twilio';
    const found = await this.audience(input.audience || {});
    const template = input.contentSid ? (await this.approvedTemplates().catch(() => [])).find((t) => t.sid === input.contentSid) : null;
    const category = template?.category || 'MARKETING';
    const cost = found.recipients.reduce((sum, r) => sum + metaRate(category, r.phone) + (twilio ? TWILIO_FEE : 0), 0);
    // Twilio is prepaid (a balance that can run out); Meta bills the payment method on the account.
    const billing = twilio ? await this.twilio.billing().catch(() => null) : null;
    const { limit, usedLast24h } = await this.dailyLimit();
    return {
      count: found.recipients.length, matched: found.matched, invalid: found.invalid, optedOut: found.stopped, duplicates: found.duplicate,
      sample: found.recipients.slice(0, 8).map((r) => ({ name: r.name, phone: r.phone, destination: r.destination })),
      estimate: { currency: 'USD', total: Math.round(cost * 100) / 100, category },
      balance: billing ? { amount: billing.balance, currency: billing.currency } : null,
      dailyLimit: limit, usedLast24h, provider: this.provider(),
    };
  }

  async create(input: { name: string; contentSid: string; variables: Record<string, VariableSource>; audience: Audience }, userId: string | null) {
    await this.assertReady();
    const twilio = this.provider() === 'twilio';
    const name = String(input.name || '').trim();
    if (!name) throw new BadRequestException('Give this bulk send a name');
    const template = (await this.approvedTemplates()).find((t) => t.sid === input.contentSid);
    if (!template) throw new BadRequestException('Choose an approved WhatsApp template');
    for (const v of template.variables) {
      const src = input.variables?.[String(v.number)];
      if (!src || !['name', 'destination', 'text'].includes(src.source)) throw new BadRequestException(`Choose what goes in {{${v.number}}}`);
      if (src.source === 'text' && !String(src.value || '').trim()) throw new BadRequestException(`Type the text for {{${v.number}}}`);
    }
    const found = await this.audience(input.audience || {});
    if (!found.recipients.length) throw new BadRequestException('No one to send to with these filters');
    const cost = found.recipients.reduce((sum, r) => sum + metaRate(template.category, r.phone) + (twilio ? TWILIO_FEE : 0), 0);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO whatsapp_broadcasts (name, content_sid, template_name, template_body, variables, audience, status, total, estimated_cost, currency, created_by, provider, template_language)
         VALUES ($1, $2, $3, $4, $5, $6, 'sending', $7, $8, 'USD', $9, $10, $11) RETURNING id`,
        [name, template.sid, template.name, template.body, JSON.stringify(input.variables), JSON.stringify(input.audience || {}), found.recipients.length, Math.round(cost * 100) / 100, userId, this.provider(), template.language],
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
    // A bulk send goes out only through the provider it was started with (its template lives there).
    const { rows: active } = await this.pool.query(`SELECT * FROM whatsapp_broadcasts WHERE status IN ('sending', 'waiting') AND provider = $1 ORDER BY created_at LIMIT 1`, [this.provider()]);
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
    const vars = this.resolveVariables(b.variables, lead[0]?.customer_name || r.name || '', lead[0]?.destination || '');
    try {
      const sid = await this.deliver({ sid: b.content_sid, name: b.template_name, language: b.template_language }, r.phone, vars);
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
