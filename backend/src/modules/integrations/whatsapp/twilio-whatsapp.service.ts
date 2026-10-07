import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { Pool } from 'pg';
import { PG_POOL } from '../../../common/db/pool.module';
import { R2Service } from '../../../common/r2/r2.service';

type Params = Record<string, string>;
type CloudPayload = Record<string, any>;

// The ids the CRM's WhatsApp settings carry while Twilio is the sender (in place of Meta's phone
// number id, business account id and token); graphFetch recognises calls addressed to them.
export const TWILIO_PSEUDO_ID = 'twilio';

export interface TemplateStatusEvent { contentSid: string; name: string; status: string; reason: string | null }
// How a CRM template's parameters (Meta's numbering) land on the Twilio Content variables.
interface TemplateMap { bodyVars: number; mediaVar: number | null; headerFormat: string | null; buttonVars: Record<string, number>; def: any }

// Twilio approval states in the CRM's (Meta's) wording.
const APPROVAL_STATUS: Record<string, string> = {
  approved: 'APPROVED', rejected: 'REJECTED', paused: 'PAUSED', disabled: 'DISABLED',
  pending: 'PENDING', received: 'PENDING', submitted: 'PENDING', unsubmitted: 'PENDING',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// WhatsApp messages through Twilio are capped at 1,600 characters per message.
const TWILIO_BODY_LIMIT = 1600;
// Twilio error codes a person needs to understand, in the CRM's own words.
const TWILIO_ERRORS: Record<number, string> = {
  63016: '24-hour reply window is closed - the customer must message first, or send an approved template',
  63003: 'This number is not on WhatsApp',
  63024: 'Invalid WhatsApp recipient',
  63018: 'WhatsApp rate limit reached - try again shortly',
  63049: 'Meta did not deliver this marketing message (per-customer marketing limit)',
  63032: "Meta did not deliver this message (the customer's region or account restricts it)",
  63112: 'The WhatsApp sender is disabled - check the Twilio console',
};

// WhatsApp through Twilio. The CRM's WhatsApp code speaks the WhatsApp Cloud API's message shapes;
// this turns those outgoing payloads into Twilio Messages / Content API calls, and Twilio's inbound
// and status webhooks back into the Cloud API's webhook shape, so leads, the inbox, menus and the
// itinerary logic all run unchanged.
@Injectable()
export class TwilioWhatsAppService implements OnModuleInit {
  private logger = new Logger('TwilioWhatsApp');
  private contentCache = new Map<string, string>();
  private healthCache: { at: number; value: TwilioHealth | null } = { at: 0, value: null };
  private statusListeners: ((e: TemplateStatusEvent) => void | Promise<void>)[] = [];

  constructor(private config: ConfigService, @Inject(PG_POOL) private pool: Pool, private r2: R2Service) {}

  // Which provider WhatsApp runs through: 'twilio' or 'meta' (Meta's own Cloud API), chosen in
  // Settings > WhatsApp and kept in whatsapp_automation_settings. Held here in memory because
  // every send asks; re-read every 15 seconds so a change made on one screen reaches everything.
  private provider: 'twilio' | 'meta' = 'twilio';

  // Meta pushes template decisions by webhook; Twilio does not, so pending templates are checked
  // every 5 minutes and a decision is announced to the CRM the same way (see onTemplateStatus).
  async onModuleInit() {
    await this.loadProvider();
    setInterval(() => this.loadProvider(), 15 * 1000);
    setInterval(() => { if (this.isActive()) this.checkPendingTemplates().catch((e) => this.logger.warn(`Template status check failed: ${e.message}`)); }, 5 * 60 * 1000);
  }

  private async loadProvider() {
    const { rows } = await this.pool.query(`SELECT provider FROM whatsapp_automation_settings WHERE id = true`).catch(() => ({ rows: [] as any[] }));
    const next = rows[0]?.provider === 'meta' ? 'meta' : 'twilio';
    if (next !== this.provider) this.logger.log(`WhatsApp provider is now ${next}`);
    this.provider = next;
  }

  // True while WhatsApp runs through Twilio: its settings are present and it is the chosen
  // provider. Everything that decides "Twilio or Meta?" asks this, not isConfigured().
  isActive() { return this.isConfigured() && this.provider === 'twilio'; }

  // 'twilio' while it is active, otherwise Meta's Cloud API (also when Twilio is not set up).
  activeProvider(): 'twilio' | 'meta' { return this.isActive() ? 'twilio' : 'meta'; }

  async setProvider(provider: 'twilio' | 'meta', userId?: string | null) {
    await this.pool.query(`UPDATE whatsapp_automation_settings SET provider = $1, updated_at = now(), updated_by = $2 WHERE id = true`, [provider, userId ?? null]);
    this.provider = provider;
    this.healthCache = { at: 0, value: null };
    this.logger.log(`WhatsApp provider switched to ${provider}`);
  }

  onTemplateStatus(listener: (e: TemplateStatusEvent) => void | Promise<void>) {
    this.statusListeners.push(listener);
  }

  private get sid() { return (this.config.get<string>('TWILIO_ACCOUNT_SID') || '').trim(); }
  private get token() { return (this.config.get<string>('TWILIO_AUTH_TOKEN') || '').trim(); }
  get from() {
    const n = (this.config.get<string>('TWILIO_WHATSAPP_NUMBER') || '').trim();
    if (!n) return '';
    return n.startsWith('whatsapp:') ? n : `whatsapp:+${n.replace(/\D/g, '')}`;
  }
  isConfigured() { return !!(this.sid && this.token && this.from); }
  private authHeader() { return 'Basic ' + Buffer.from(`${this.sid}:${this.token}`).toString('base64'); }
  apiBase() { return (this.config.get<string>('PUBLIC_API_BASE') || 'https://api-errances.socialmm.in').replace(/\/+$/, ''); }
  inboundUrl() { return `${this.apiBase()}/api/webhooks/twilio`; }
  statusUrl() { return `${this.apiBase()}/api/webhooks/twilio/status`; }

  // X-Twilio-Signature = base64(HMAC-SHA1(auth token, full URL + each POST param name+value sorted by name)).
  validSignature(url: string, params: Params, signature: string | undefined) {
    if (!signature || !this.token) return false;
    const data = url + Object.keys(params).sort().map((k) => k + (params[k] ?? '')).join('');
    const expected = Buffer.from(createHmac('sha1', this.token).update(Buffer.from(data, 'utf-8')).digest('base64'));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  // ---------------------------------------------------------------- outgoing

  // One Cloud-API-shaped payload out through Twilio. Returns the Cloud API's response shape
  // ({ messages: [{ id }] }) so callers that keep the message id work unchanged.
  async send(payload: CloudPayload): Promise<any> {
    const to = String(payload?.to || '').replace(/\D/g, '');
    if (!to) throw new Error('WhatsApp send has no recipient');
    const type = String(payload?.type || 'text');
    if (type === 'text') return this.sendText(to, String(payload.text?.body ?? ''));
    if (['document', 'image', 'video', 'audio'].includes(type)) {
      const m = payload[type] || {};
      if (!m.link) throw new Error('WhatsApp media send has no file link');
      // Through our own short link, whose last part is the file name the customer sees.
      const media = this.mediaUrl(await this.mediaLink({ url: String(m.link) }, m.filename || defaultFileName(type, String(m.link))));
      return this.postMessage(to, { body: m.caption ? String(m.caption).slice(0, TWILIO_BODY_LIMIT) : undefined, media: [media] });
    }
    if (type === 'interactive') {
      const { contentSid, vars } = await this.interactiveContent(payload.interactive);
      return this.postMessage(to, { contentSid, vars });
    }
    if (type === 'template') {
      const mapped = await this.mappedTemplate(String(payload.template?.name || ''));
      if (!mapped) throw new Error(`The WhatsApp template "${payload.template?.name}" is not set up in Twilio yet`);
      return this.postMessage(to, { contentSid: mapped.sid, vars: await this.templateVariables(payload.template, mapped.map) });
    }
    throw new Error(`Unsupported WhatsApp message type for Twilio: ${type}`);
  }

  // Long texts are split on paragraph/line boundaries into messages Twilio accepts.
  private async sendText(to: string, body: string) {
    const parts: string[] = [];
    let rest = body.trim() || ' ';
    while (rest.length > TWILIO_BODY_LIMIT) {
      const cut = Math.max(rest.lastIndexOf('\n\n', TWILIO_BODY_LIMIT), rest.lastIndexOf('\n', TWILIO_BODY_LIMIT), rest.lastIndexOf(' ', TWILIO_BODY_LIMIT));
      const at = cut > TWILIO_BODY_LIMIT / 2 ? cut : TWILIO_BODY_LIMIT;
      parts.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    parts.push(rest);
    let last: any;
    for (const part of parts) last = await this.postMessage(to, { body: part });
    return last;
  }

  private async postMessage(toDigits: string, o: { body?: string; media?: string[]; contentSid?: string; vars?: Record<string, string> }) {
    const form = new URLSearchParams();
    form.set('From', this.from);
    form.set('To', `whatsapp:+${toDigits}`);
    if (o.contentSid) {
      form.set('ContentSid', o.contentSid);
      if (o.vars && Object.keys(o.vars).length) form.set('ContentVariables', JSON.stringify(o.vars));
    } else if (o.body) {
      form.set('Body', o.body);
    }
    for (const m of o.media ?? []) form.append('MediaUrl', m);
    form.set('StatusCallback', this.statusUrl());
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: this.authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reason = TWILIO_ERRORS[Number(data?.code)] || data?.message || 'unknown error';
      this.logger.error(`Twilio send to ${toDigits} failed: ${res.status} ${data?.code ?? ''} ${data?.message ?? ''}`);
      throw new Error(`WhatsApp send failed - ${reason}`);
    }
    return { messaging_product: 'whatsapp', contacts: [{ input: toDigits, wa_id: toDigits }], messages: [{ id: data.sid, message_status: data.status }] };
  }

  // Reply buttons / lists inside the customer's 24-hour window: one reusable Twilio Content per
  // shape (1-3 buttons, 1-10 list items), filled with variables -- these never need approval.
  private async interactiveContent(ia: any): Promise<{ contentSid: string; vars: Record<string, string> }> {
    const bodyText = String(ia?.body?.text || '').slice(0, 1024).trim() || '-';
    if (ia?.type === 'button') {
      const buttons = (ia.action?.buttons || []).slice(0, 3).map((b: any) => ({
        title: String(b.reply?.title || '').slice(0, 20).trim() || 'OK',
        id: String(b.reply?.id || b.reply?.title || 'ok'),
      }));
      if (!buttons.length) throw new Error('Reply buttons message has no buttons');
      const n = buttons.length;
      const contentSid = await this.sessionContent(`qr${n}`, {
        'twilio/quick-reply': { body: '{{1}}', actions: buttons.map((_: any, i: number) => ({ title: `{{${2 + i * 2}}}`, id: `{{${3 + i * 2}}}` })) },
      }, this.sampleVars(1 + n * 2));
      const vars: Record<string, string> = { '1': bodyText };
      buttons.forEach((b: any, i: number) => { vars[String(2 + i * 2)] = b.title; vars[String(3 + i * 2)] = b.id; });
      return { contentSid, vars };
    }
    if (ia?.type === 'list') {
      const rows = (ia.action?.sections || []).flatMap((s: any) => s.rows || []).slice(0, 10);
      if (!rows.length) throw new Error('List message has no rows');
      const n = rows.length;
      // Twilio needs every list item's description filled or none at all.
      const withDesc = rows.every((r: any) => String(r.description || '').trim());
      const per = withDesc ? 3 : 2;
      const items = rows.map((_: any, i: number) => {
        const base = 3 + i * per;
        return withDesc ? { item: `{{${base}}}`, id: `{{${base + 1}}}`, description: `{{${base + 2}}}` } : { item: `{{${base}}}`, id: `{{${base + 1}}}` };
      });
      const contentSid = await this.sessionContent(`list${n}${withDesc ? 'd' : ''}`, {
        'twilio/list-picker': { body: '{{1}}', button: '{{2}}', items },
      }, this.sampleVars(2 + n * per));
      const vars: Record<string, string> = { '1': bodyText, '2': String(ia.action?.button || 'View').slice(0, 20) };
      rows.forEach((r: any, i: number) => {
        const base = 3 + i * per;
        vars[String(base)] = String(r.title || '-').slice(0, 24);
        vars[String(base + 1)] = String(r.id || r.title || i);
        if (withDesc) vars[String(base + 2)] = String(r.description).slice(0, 72);
      });
      return { contentSid, vars };
    }
    throw new Error(`Unsupported interactive message type for Twilio: ${ia?.type}`);
  }

  private sampleVars(count: number) {
    const out: Record<string, string> = {};
    for (let i = 1; i <= count; i++) out[String(i)] = `value ${i}`;
    return out;
  }

  private async sessionContent(shape: string, types: Record<string, unknown>, variables: Record<string, string>): Promise<string> {
    const key = `session:${shape}:v1`;
    const cached = this.contentCache.get(key);
    if (cached) return cached;
    const { rows } = await this.pool.query(`SELECT content_sid FROM twilio_contents WHERE key = $1`, [key]);
    if (rows[0]) { this.contentCache.set(key, rows[0].content_sid); return rows[0].content_sid; }
    const friendlyName = `crm_session_${shape}_v1`;
    let sid = await this.findContent(friendlyName);
    if (!sid) {
      const res = await fetch('https://content.twilio.com/v1/Content', {
        method: 'POST',
        headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendly_name: friendlyName, language: 'en', variables, types }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok || !data?.sid) throw new Error(`Could not create the Twilio message layout (${shape}): ${data?.message || res.status}`);
      sid = data.sid as string;
    }
    await this.pool.query(`INSERT INTO twilio_contents (key, content_sid) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [key, sid]);
    const { rows: saved } = await this.pool.query(`SELECT content_sid FROM twilio_contents WHERE key = $1`, [key]);
    this.contentCache.set(key, saved[0].content_sid);
    return saved[0].content_sid;
  }

  // A Content already in the Twilio account under this name (made earlier, e.g. by another environment).
  private async findContent(friendlyName: string): Promise<string | null> {
    let url = 'https://content.twilio.com/v1/Content?PageSize=500';
    for (let page = 0; url && page < 10; page++) {
      const res = await fetch(url, { headers: { Authorization: this.authHeader() } });
      if (!res.ok) return null;
      const data: any = await res.json().catch(() => ({}));
      const hit = (data?.contents || []).find((c: any) => c?.friendly_name === friendlyName);
      if (hit?.sid) return hit.sid;
      url = data?.meta?.next_page_url || '';
    }
    return null;
  }

  // Business-initiated templates: a CRM template name -> its Twilio Content and variable layout.
  private async mappedTemplate(name: string): Promise<{ sid: string; map: TemplateMap | null } | null> {
    if (!name) return null;
    const { rows } = await this.pool.query(`SELECT content_sid, meta FROM twilio_contents WHERE key = $1`, [`template:${name}`]);
    return rows[0] ? { sid: rows[0].content_sid, map: rows[0].meta ?? null } : null;
  }

  // Cloud API template components -> Twilio content variables: body parameters keep their numbers
  // {{1}}..{{n}}; the header file and dynamic link buttons go to the variables recorded for them
  // when the template was created (see createTemplate).
  private async templateVariables(t: any, map: TemplateMap | null): Promise<Record<string, string>> {
    const vars: Record<string, string> = {};
    let i = 1;
    for (const c of t?.components ?? []) {
      if (c.type === 'body') for (const p of c.parameters ?? []) vars[String(i++)] = String(p.text ?? '');
    }
    for (const c of t?.components ?? []) {
      if (c.type === 'header') for (const p of c.parameters ?? []) {
        const file = p.document || p.image || p.video;
        if (!file?.link) continue;
        const kind = p.document ? 'document' : p.image ? 'image' : 'video';
        vars[String(map?.mediaVar ?? i++)] = await this.mediaLink({ url: String(file.link) }, file.filename || defaultFileName(kind, String(file.link)));
      }
      if (c.type === 'button' && c.sub_type === 'url' && map?.buttonVars?.[String(c.index)]) {
        vars[String(map.buttonVars[String(c.index)])] = String(c.parameters?.[0]?.text ?? '');
      }
    }
    return vars;
  }

  // ---------------------------------------------------------------- media links

  mediaUrl(suffix: string) { return `${this.apiBase()}/api/wa-media/${suffix}`; }

  // A short public link to a file, for Twilio to fetch when it sends it: "<id>/<file name>".
  // Files kept by the CRM are linked by object key (never expires while kept); other links are
  // fetched when Twilio asks. Links stop working after 30 days unless kept (template samples).
  async mediaLink(source: { objectKey?: string; url?: string }, filename: string, keep = false): Promise<string> {
    let objectKey = source.objectKey ?? null;
    let url = source.url ?? null;
    const prefix = `${this.apiBase()}/api/wa-media/`;
    if (url?.startsWith(prefix)) return url.slice(prefix.length);
    if (url && !objectKey) {
      const own = /\/api\/files\/builtin\/([^/?#]+)\//.exec(url);
      const key = own ? this.r2.verifyLink(own[1], 'get')?.key : null;
      if (key) { objectKey = key; url = null; }
    }
    const id = randomBytes(12).toString('base64url');
    const name = safeFileName(filename);
    await this.pool.query(`INSERT INTO wa_media_links (id, object_key, url, filename, keep) VALUES ($1, $2, $3, $4, $5)`, [id, objectKey, url, name, keep]);
    return `${id}/${encodeURIComponent(name)}`;
  }

  async mediaFile(id: string): Promise<{ body: Buffer; contentType: string; filename: string } | null> {
    const { rows } = await this.pool.query(
      `SELECT object_key, url, filename, content_type FROM wa_media_links WHERE id = $1 AND (keep OR created_at > now() - interval '30 days')`, [id]);
    const link = rows[0];
    if (!link) return null;
    if (link.object_key) {
      const obj = await this.r2.getObject(link.object_key);
      return obj ? { body: obj.body, contentType: link.content_type || obj.contentType, filename: link.filename } : null;
    }
    const res = await fetch(link.url).catch(() => null);
    if (!res?.ok) return null;
    return { body: Buffer.from(await res.arrayBuffer()), contentType: link.content_type || res.headers.get('content-type') || 'application/octet-stream', filename: link.filename };
  }

  // ---------------------------------------------------------------- templates

  // A CRM template definition in Meta's format -> a Twilio Content, submitted to WhatsApp for
  // approval. Body text and its examples carry over as they are; a document/image header becomes
  // the Content's media (a fixed address on this API plus a variable); link buttons with a dynamic
  // ending get a variable of their own; quick replies answer with their own text.
  async createTemplate(def: any): Promise<{ id: string; status: string; category: string }> {
    const name = String(def?.name || '').trim();
    if (!/^[a-z0-9_]+$/.test(name)) throw new Error('Template names may only use lowercase letters, digits and _');
    const category = String(def?.category || 'UTILITY').toUpperCase();
    const components: any[] = def?.components ?? [];
    const header = components.find((c) => c.type === 'HEADER');
    const bodyPart = components.find((c) => c.type === 'BODY');
    const footer = components.find((c) => c.type === 'FOOTER');
    const buttons: any[] = components.filter((c) => c.type === 'BUTTONS').flatMap((c) => c.buttons ?? []);

    let body = String(bodyPart?.text || '').trim();
    if (!body) throw new Error('The template has no message text');
    const variables: Record<string, string> = {};
    const bodyVars = Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
    const bodyExample: any[] = bodyPart?.example?.body_text?.[0] ?? [];
    for (let i = 1; i <= bodyVars; i++) variables[String(i)] = String(bodyExample[i - 1] ?? '').trim() || `sample ${i}`;
    let next = bodyVars + 1;

    if (header?.format === 'TEXT' && header.text) {
      if (/\{\{/.test(header.text)) throw new Error('Template headers with variables are not supported');
      body = `*${header.text}*\n\n${body}`;
    }
    let media: string[] | undefined;
    let mediaVar: number | null = null;
    const headerFormat = header && ['DOCUMENT', 'IMAGE', 'VIDEO'].includes(header.format) ? String(header.format) : null;
    if (headerFormat) {
      const handle = String(header.example?.header_handle?.[0] || '');
      if (!handle.startsWith('twsample:')) throw new Error('The template sample file is missing');
      const sampleKey = handle.slice('twsample:'.length);
      mediaVar = next++;
      variables[String(mediaVar)] = await this.mediaLink({ objectKey: sampleKey }, String(header.example?.file_name || '') || defaultFileName(headerFormat.toLowerCase(), sampleKey), true);
      media = [`${this.apiBase()}/api/wa-media/{{${mediaVar}}}`];
    }

    const buttonVars: Record<string, number> = {};
    const actions = buttons.map((b, index) => {
      const title = String(b.text || '').slice(0, 25);
      if (b.type === 'QUICK_REPLY') return { type: 'QUICK_REPLY', title, id: title };
      if (b.type === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER', title, phone: String(b.phone_number) };
      if (b.type === 'URL') {
        let url = String(b.url || '');
        if (url.includes('{{1}}')) {
          const v = next++;
          const staticPart = url.split('{{1}}')[0];
          const example = String(b.example?.[0] || '');
          buttonVars[String(index)] = v;
          variables[String(v)] = (example.startsWith(staticPart) ? example.slice(staticPart.length) : '') || 'sample';
          url = url.replace('{{1}}', `{{${v}}}`);
        }
        return { type: 'URL', title, url };
      }
      throw new Error(`Button type ${b.type} is not supported`);
    });

    const quickReplies = actions.filter((a) => a.type === 'QUICK_REPLY');
    const links = actions.filter((a) => a.type !== 'QUICK_REPLY');
    let types: Record<string, unknown>;
    if (media || (quickReplies.length && links.length)) {
      types = { 'twilio/card': { title: body, ...(footer?.text ? { subtitle: String(footer.text).slice(0, 60) } : {}), ...(media ? { media } : {}), ...(actions.length ? { actions } : {}) } };
    } else if (quickReplies.length) {
      types = { 'twilio/quick-reply': { body, actions: quickReplies.map((a: any) => ({ title: a.title, id: a.id })) } };
    } else if (links.length) {
      types = { 'twilio/call-to-action': { body, actions: links } };
    } else {
      types = { 'twilio/text': { body } };
    }

    const language = String(def?.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';
    const createRes = await fetch('https://content.twilio.com/v1/Content', {
      method: 'POST',
      headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ friendly_name: name, language, variables, types }),
    });
    const created: any = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !created?.sid) throw new Error(`Twilio did not accept the template: ${created?.message || createRes.status}`);
    const approvalRes = await fetch(`https://content.twilio.com/v1/Content/${created.sid}/ApprovalRequests/whatsapp`, {
      method: 'POST',
      headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, category }),
    });
    const approval: any = await approvalRes.json().catch(() => ({}));
    if (!approvalRes.ok) {
      await fetch(`https://content.twilio.com/v1/Content/${created.sid}`, { method: 'DELETE', headers: { Authorization: this.authHeader() } }).catch(() => undefined);
      throw new Error(`WhatsApp approval request failed: ${approval?.message || approvalRes.status}`);
    }
    const map: TemplateMap = { bodyVars, mediaVar, headerFormat, buttonVars, def: { name, language: def?.language || 'en_US', category, components } };
    const status = APPROVAL_STATUS[String(approval?.status || 'pending').toLowerCase()] || 'PENDING';
    await this.pool.query(
      `INSERT INTO twilio_contents (key, content_sid, name, status, category, meta, checked_at) VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (key) DO UPDATE SET content_sid = $2, name = $3, status = $4, category = $5, meta = $6, rejection_reason = NULL, checked_at = now(), created_at = now()`,
      [`template:${name}`, created.sid, name, status, category, JSON.stringify(map)],
    );
    this.logger.log(`Template ${name} submitted to WhatsApp through Twilio (${created.sid})`);
    return { id: created.sid, status, category };
  }

  // Approval state of a template's Content, kept in twilio_contents; a change is announced.
  async templateStatus(contentSid: string) {
    const res = await fetch(`https://content.twilio.com/v1/Content/${contentSid}/ApprovalRequests`, { headers: { Authorization: this.authHeader() } });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Could not read the template status: ${data?.message || res.status}`);
    const wa = data?.whatsapp ?? {};
    const status = APPROVAL_STATUS[String(wa.status || 'pending').toLowerCase()] || 'PENDING';
    const reason = wa.rejection_reason ? String(wa.rejection_reason) : null;
    const { rows } = await this.pool.query(`SELECT name, status, category FROM twilio_contents WHERE content_sid = $1`, [contentSid]);
    const known = rows[0];
    if (known) {
      await this.pool.query(`UPDATE twilio_contents SET status = $2, rejection_reason = $3, category = COALESCE($4, category), checked_at = now() WHERE content_sid = $1`, [contentSid, status, reason, wa.category ? String(wa.category).toUpperCase() : null]);
      if (known.status !== status) {
        for (const listener of this.statusListeners) await Promise.resolve(listener({ contentSid, name: known.name, status, reason })).catch((e) => this.logger.warn(`Template status listener failed: ${e.message}`));
      }
    }
    return { id: contentSid, name: wa.name || known?.name || null, status, category: wa.category ? String(wa.category).toUpperCase() : known?.category ?? null, language: 'en_US', rejected_reason: reason || 'NONE', quality_score: null, last_updated_time: new Date().toISOString() };
  }

  private async checkPendingTemplates() {
    const { rows } = await this.pool.query(`SELECT content_sid FROM twilio_contents WHERE key LIKE 'template:%' AND COALESCE(status, 'PENDING') = 'PENDING'`);
    for (const r of rows) await this.templateStatus(r.content_sid).catch((e) => this.logger.warn(`Status check for ${r.content_sid} failed: ${e.message}`));
  }

  private async templatesByName(name: string) {
    const { rows } = await this.pool.query(`SELECT content_sid, name, meta FROM twilio_contents WHERE key = $1`, [`template:${name}`]);
    if (!rows[0]) return [];
    const s = await this.templateStatus(rows[0].content_sid);
    return [{ ...s, name: rows[0].name, language: rows[0].meta?.def?.language || 'en_US', components: rows[0].meta?.def?.components ?? [] }];
  }

  async deleteTemplate(name: string) {
    const { rows } = await this.pool.query(`DELETE FROM twilio_contents WHERE key = $1 RETURNING content_sid`, [`template:${name}`]);
    for (const r of rows) await fetch(`https://content.twilio.com/v1/Content/${r.content_sid}`, { method: 'DELETE', headers: { Authorization: this.authHeader() } }).catch(() => undefined);
    return { success: true };
  }

  // ---------------------------------------------------------------- Meta Graph API stand-in

  private uploadSessions = new Map<string, string>();

  // The CRM's modules call Meta's WhatsApp API (graph.facebook.com) directly: send a message, upload
  // a template sample, create / look up / delete a template, read a template's status. While Twilio
  // is the sender their settings carry TWILIO_PSEUDO_ID in place of Meta's ids, and this answers
  // those calls through Twilio in Meta's response format. Every other call (ads, lead forms) goes
  // to Meta unchanged.
  async graphFetch(url: string, init?: { method?: string; headers?: any; body?: any }): Promise<Response> {
    let u: URL;
    try { u = new URL(url); } catch { return fetch(url, init as any); }
    if (u.hostname !== 'graph.facebook.com' || !this.isConfigured()) return fetch(url, init as any);
    const [first = '', second = ''] = u.pathname.split('/').filter(Boolean).slice(1);
    const method = String(init?.method || 'GET').toUpperCase();
    const ours = first === TWILIO_PSEUDO_ID || first.startsWith('twupload_') || /^HX[0-9a-f]{32}$/i.test(first)
      || (first === 'debug_token' && u.searchParams.get('input_token') === TWILIO_PSEUDO_ID);
    if (!ours) return fetch(url, init as any);
    try {
      if (first === 'debug_token') {
        return jsonResponse(200, { data: { app_id: TWILIO_PSEUDO_ID, is_valid: true, type: 'SYSTEM_USER', scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'] } });
      }
      if (second === 'messages' && method === 'POST') return jsonResponse(200, await this.send(JSON.parse(String(init?.body || '{}'))));
      if (second === 'uploads' && method === 'POST') {
        const id = `twupload_${randomUUID().replace(/-/g, '')}`;
        this.uploadSessions.set(id, u.searchParams.get('file_type') || 'application/octet-stream');
        return jsonResponse(200, { id });
      }
      if (first.startsWith('twupload_') && method === 'POST') {
        const contentType = this.uploadSessions.get(first) || headerValue(init?.headers, 'content-type') || 'application/octet-stream';
        this.uploadSessions.delete(first);
        const bytes = Buffer.isBuffer(init?.body) ? init!.body : Buffer.from(init?.body ?? '');
        const ext = extensionFor(contentType);
        const { objectKey } = await this.r2.uploadBuffer(bytes, 'whatsapp-template-samples', `sample.${ext}`, contentType);
        return jsonResponse(200, { h: `twsample:${objectKey}` });
      }
      if (second === 'message_templates') {
        if (method === 'POST') return jsonResponse(200, await this.createTemplate(JSON.parse(String(init?.body || '{}'))));
        if (method === 'DELETE') return jsonResponse(200, await this.deleteTemplate(u.searchParams.get('name') || ''));
        return jsonResponse(200, { data: await this.templatesByName(u.searchParams.get('name') || '') });
      }
      if (/^HX[0-9a-f]{32}$/i.test(first) && !second && method === 'GET') return jsonResponse(200, await this.templateStatus(first));
      return jsonResponse(400, { error: { message: 'Not available for a Twilio WhatsApp sender' } });
    } catch (e: any) {
      const message = String(e?.message || e);
      return jsonResponse(400, { error: { message, error_user_msg: message, error_data: { details: message } } });
    }
  }

  // ---------------------------------------------------------------- incoming

  // Twilio's inbound webhook -> the Cloud API webhook payload the bot already handles.
  toCloudInbound(p: Params, opts: { recovered?: boolean; timestamp?: number } = {}): CloudPayload {
    const from = String(p.WaId || p.From || '').replace(/\D/g, '');
    const message: any = { from, id: p.MessageSid || p.SmsMessageSid, timestamp: String(opts.timestamp ?? Math.floor(Date.now() / 1000)) };
    if (opts.recovered) message.recovered = true;
    if (p.OriginalRepliedMessageSid) message.context = { id: p.OriginalRepliedMessageSid };
    if (p.ReferralSourceId || p.ReferralCtwaClid) {
      message.referral = { source_id: p.ReferralSourceId, source_type: p.ReferralSourceType, source_url: p.ReferralSourceUrl, headline: p.ReferralHeadline, body: p.ReferralBody, ctwa_clid: p.ReferralCtwaClid };
    }
    const listId = p.ListId || this.listIdFromInteractive(p.InteractiveData);
    const payload = p.ButtonPayload;
    const numMedia = Number(p.NumMedia || 0);
    if (listId || (payload && UUID_RE.test(payload))) {
      message.type = 'interactive';
      message.interactive = { type: 'list_reply', list_reply: { id: listId || payload, title: p.ListTitle || p.ButtonText || p.Body || '' } };
    } else if (payload || p.ButtonText) {
      const id = payload || p.ButtonText;
      const title = p.ButtonText || p.Body || '';
      message.type = 'interactive';
      message.interactive = { type: 'button_reply', button_reply: { id, title } };
      message.button = { payload: id, text: title };
    } else if (numMedia > 0) {
      const mime = String(p.MediaContentType0 || 'application/octet-stream');
      const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'document';
      message.type = kind;
      message[kind] = { id: p.MediaUrl0, mime_type: mime, ...(p.Body ? { caption: p.Body } : {}) };
    } else if (p.Latitude && p.Longitude) {
      message.type = 'location';
      message.location = { latitude: Number(p.Latitude), longitude: Number(p.Longitude) };
    } else {
      message.type = 'text';
      message.text = { body: String(p.Body ?? '') };
    }
    return {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', contacts: [{ wa_id: from, profile: { name: p.ProfileName || undefined } }], messages: [message] } }] }],
    };
  }

  private listIdFromInteractive(raw?: string): string | undefined {
    if (!raw) return undefined;
    try {
      const d = JSON.parse(raw);
      return d?.list_reply?.id || d?.interactive?.list_reply?.id || undefined;
    } catch { return undefined; }
  }

  // Twilio's status callback -> the Cloud API "statuses" webhook payload.
  toCloudStatus(p: Params): CloudPayload | null {
    const map: Record<string, string> = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed', undelivered: 'failed' };
    const status = map[String(p.MessageStatus || p.SmsStatus || '').toLowerCase()];
    if (!status || !p.MessageSid) return null;
    const code = p.ErrorCode ? Number(p.ErrorCode) : null;
    const reason = code ? (TWILIO_ERRORS[code] || p.ErrorMessage || `Twilio error ${code}`) : (p.ErrorMessage || 'Delivery failed');
    const statusRow: any = { id: p.MessageSid, recipient_id: String(p.To || '').replace(/\D/g, ''), status };
    if (status === 'failed') statusRow.errors = [{ code: code === 63016 ? 131047 : code ?? 0, title: reason, error_data: { details: reason } }];
    return { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [statusRow] } }] }] };
  }

  isTwilioMediaUrl(url: string) { return /^https:\/\/api\.twilio\.com\//.test(String(url || '')); }

  // Twilio media URLs answer with a redirect to storage; the auth header must not follow it there.
  async fetchMedia(url: string): Promise<{ body: Buffer; contentType: string } | null> {
    const first = await fetch(url, { headers: { Authorization: this.authHeader() }, redirect: 'manual' });
    const location = first.headers.get('location');
    const res = first.status >= 300 && first.status < 400 && location ? await fetch(location) : first;
    if (!res.ok) return null;
    return { body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'application/octet-stream' };
  }

  // Inbound messages to our number since a date, oldest first -- for recovering ones that never reached the CRM.
  async listInboundSince(sinceIsoDate: string): Promise<{ sid: string; from: string; body: string; dateSent: string; media: { url: string; contentType: string }[] }[]> {
    const out: any[] = [];
    let url = `https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json?To=${encodeURIComponent(this.from)}&DateSent%3E=${encodeURIComponent(sinceIsoDate.slice(0, 10))}&PageSize=200`;
    while (url && out.length < 5000) {
      const res = await fetch(url, { headers: { Authorization: this.authHeader() } });
      const data: any = await res.json();
      if (!res.ok) throw new Error(`Twilio message list failed: ${data?.message || res.status}`);
      out.push(...(data.messages || []).filter((m: any) => m.direction === 'inbound'));
      url = data.next_page_uri ? `https://api.twilio.com${data.next_page_uri}` : '';
    }
    const rows: { sid: string; from: string; body: string; dateSent: string; media: { url: string; contentType: string }[] }[] = [];
    for (const m of out) {
      const media: { url: string; contentType: string }[] = [];
      if (Number(m.num_media) > 0) {
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages/${m.sid}/Media.json`, { headers: { Authorization: this.authHeader() } });
        const d: any = await r.json().catch(() => ({}));
        for (const md of d.media_list || []) media.push({ url: `https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages/${m.sid}/Media/${md.sid}`, contentType: md.content_type });
      }
      rows.push({ sid: m.sid, from: m.from, body: m.body || '', dateSent: m.date_sent, media });
    }
    return rows.sort((a, b) => new Date(a.dateSent).getTime() - new Date(b.dateSent).getTime());
  }

  // ---------------------------------------------------------------- bulk sending

  // One approved Content to one number (bulk WhatsApp). Returns the Twilio message SID.
  async sendContent(toDigits: string, contentSid: string, vars: Record<string, string>): Promise<string> {
    const result = await this.postMessage(toDigits, { contentSid, vars });
    return result.messages[0].id;
  }

  // Where one sent message stands right now, straight from Twilio (for a test send, which has no
  // lead or bulk row to follow its status webhook).
  async messageStatus(messageSid: string): Promise<{ status: string; error: string | null }> {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages/${messageSid}.json`, { headers: { Authorization: this.authHeader() } });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || `Twilio ${res.status}`);
    const failed = ['failed', 'undelivered'].includes(String(data.status));
    const code = data.error_code ? Number(data.error_code) : null;
    return { status: failed ? 'failed' : String(data.status || 'queued'), error: failed ? (code ? TWILIO_ERRORS[code] || data.error_message || `Twilio error ${code}` : data.error_message || 'Delivery failed') : null };
  }

  // The WhatsApp-approved templates, for choosing one to send in bulk.
  async approvedTemplates(): Promise<ApprovedTemplate[]> {
    return (await this.listTemplates()).filter((t) => t.status === 'APPROVED');
  }

  // Every template in the Twilio account that was submitted to WhatsApp (the CRM's and any made
  // in the Twilio console), with its approval state, text and variable numbers.
  async listTemplates(): Promise<ApprovedTemplate[]> {
    const out: ApprovedTemplate[] = [];
    let url = 'https://content.twilio.com/v1/ContentAndApprovals?PageSize=500';
    for (let page = 0; url && page < 10; page++) {
      const res = await fetch(url, { headers: { Authorization: this.authHeader() } });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Could not list Twilio templates: ${data?.message || res.status}`);
      for (const c of data?.contents ?? []) {
        const approval = String(c?.approval_requests?.status || 'unsubmitted').toLowerCase();
        if (approval === 'unsubmitted') continue;
        const types = c.types || {};
        const kind = Object.keys(types)[0] || '';
        const t = types[kind] || {};
        const body = String(t.body ?? t.title ?? '');
        const numbers = [...new Set([...JSON.stringify(types).matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
        out.push({
          sid: c.sid, name: c.approval_requests?.name || c.friendly_name, category: String(c.approval_requests?.category || '').toUpperCase(),
          language: c.language, kind, body, footer: t.subtitle ? String(t.subtitle) : null,
          hasMedia: !!(t.media?.length), buttons: (t.actions ?? []).map((a: any) => String(a.title || '')).filter(Boolean),
          variables: numbers.map((n) => ({ number: n, sample: String(c.variables?.[String(n)] ?? ''), inBody: body.includes(`{{${n}}}`) })),
          status: APPROVAL_STATUS[approval] || 'PENDING', rejectionReason: c.approval_requests?.rejection_reason ? readableRejection(String(c.approval_requests.rejection_reason)) : null,
          createdAt: c.date_created ?? null,
        });
      }
      url = data?.meta?.next_page_url || '';
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------------------------------------------------------------- billing

  // This month's WhatsApp cost from Twilio's usage records: Twilio's own per-message fee plus
  // Meta's charge per template message, in the account currency, with the prepaid balance.
  async billing() {
    const now = new Date();
    const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const today = now.toISOString().slice(0, 10);
    const base = `https://api.twilio.com/2010-04-01/Accounts/${this.sid}`;
    const get = async (path: string) => {
      const res = await fetch(`${base}${path}`, { headers: { Authorization: this.authHeader() } });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || `Twilio ${res.status}`);
      return data;
    };
    const [month, daily, balance] = await Promise.all([
      get('/Usage/Records/ThisMonth.json?PageSize=1000'),
      get(`/Usage/Records/Daily.json?Category=channels&StartDate=${monthStart}&EndDate=${today}&PageSize=100`),
      get('/Balance.json'),
    ]);
    const LABELS: Record<string, string> = {
      'channels-messaging-outbound': 'Twilio fee - messages sent',
      'channels-messaging-inbound': 'Twilio fee - messages received',
      'channels-whatsapp-template-marketing': 'WhatsApp marketing templates',
      'channels-whatsapp-template-utility': 'WhatsApp utility templates',
      'channels-whatsapp-template-authentication': 'WhatsApp authentication templates',
      'channels-whatsapp-template-service': 'Replies within 24 hours (free)',
    };
    const round = (n: number) => Math.round(n * 100) / 100;
    const records: any[] = month?.usage_records ?? [];
    const byCategory = Object.keys(LABELS).map((key) => {
      const r = records.find((x) => x.category === key);
      return { category: LABELS[key], volume: Number(r?.usage || 0), cost: round(Number(r?.price || 0)) };
    });
    const totalCost = round(byCategory.reduce((sum, c) => sum + c.cost, 0));
    const days = (daily?.usage_records ?? []).map((r: any) => ({ date: String(r.start_date), volume: Number(r.usage || 0), cost: round(Number(r.price || 0)) }))
      .sort((a: any, b: any) => b.date.localeCompare(a.date));
    return {
      provider: 'twilio', currency: String(balance?.currency || records[0]?.price_unit || 'USD').toUpperCase(), monthStart: `${monthStart}T00:00:00.000Z`,
      totalCost, gstRate: 0, estimatedGst: 0, estimatedTotal: totalCost, todayCost: days.find((d: any) => d.date === today)?.cost ?? 0,
      balance: round(Number(balance?.balance || 0)), byCategory, days, updatedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------- health

  async health(): Promise<TwilioHealth> {
    if (this.healthCache.value && Date.now() - this.healthCache.at < 60000) return this.healthCache.value;
    const out: TwilioHealth = { tokenValid: false, accountName: null, senderStatus: null, senderName: null, webhookOk: false, quality: null, throughput: null };
    try {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.sid}.json`, { headers: { Authorization: this.authHeader() } });
      const d: any = await r.json();
      out.tokenValid = r.ok && d?.status === 'active';
      out.accountName = d?.friendly_name ?? null;
    } catch { /* leave defaults */ }
    try {
      const r = await fetch('https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp&PageSize=50', { headers: { Authorization: this.authHeader() } });
      const d: any = await r.json();
      const s = (d?.senders || []).find((x: any) => x?.sender_id === this.from);
      if (s) {
        out.senderStatus = s.status ?? null;
        out.senderName = s.profile?.name ?? null;
        out.webhookOk = String(s.webhook?.callback_url || '') === this.inboundUrl();
        out.quality = s.properties?.quality_rating ?? null;
        out.throughput = s.properties?.messaging_limit ?? null;
      }
    } catch { /* leave defaults */ }
    this.healthCache = { at: Date.now(), value: out };
    return out;
  }
}

// WhatsApp's rejection text often arrives wrapped in an API error dump ("Problem: ..., Reason:
// type=OAuthException, code=100, ..., userMessage=<the sentence a person needs>, message=...").
function readableRejection(raw: string) {
  const user = /userMessage=(.+?)(?:,\s*message=|$)/.exec(raw)?.[1]?.trim();
  return (user || raw).replace(/\.+$/, '') + '.';
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function headerValue(headers: any, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? String(headers[key]) : undefined;
}

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
function extensionFor(contentType: string) {
  return EXTENSIONS[String(contentType).split(';')[0].trim().toLowerCase()] || 'bin';
}

// A name for a file the CRM did not name: the extension of its link or key, else by kind.
function defaultFileName(kind: string, linkOrKey: string) {
  const ext = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(String(linkOrKey).split('?')[0])?.[1]?.toLowerCase();
  const base = kind === 'image' ? 'image' : kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : 'document';
  return `${base}.${ext || (kind === 'image' ? 'jpg' : kind === 'video' ? 'mp4' : kind === 'audio' ? 'ogg' : 'pdf')}`;
}

// File name as the customer will see it: letters, digits and simple punctuation, extension kept.
function safeFileName(name: string) {
  const cleaned = String(name || 'document').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._()-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|-+$/g, '');
  const dot = cleaned.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [cleaned.slice(0, dot), cleaned.slice(dot)] : [cleaned, ''];
  return (base.slice(0, 80) || 'document') + ext.slice(0, 6);
}

export interface ApprovedTemplate {
  sid: string; name: string; category: string; language: string; kind: string; body: string; footer: string | null;
  hasMedia: boolean; buttons: string[]; variables: { number: number; sample: string; inBody: boolean }[];
  // APPROVED | PENDING | REJECTED | PAUSED | DISABLED
  status: string; rejectionReason: string | null; createdAt: string | null;
}

export interface TwilioHealth {
  tokenValid: boolean;
  accountName: string | null;
  senderStatus: string | null;
  senderName: string | null;
  webhookOk: boolean;
  quality: string | null;
  throughput: string | null;
}
