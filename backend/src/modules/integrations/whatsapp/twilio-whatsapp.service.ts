import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Pool } from 'pg';
import { PG_POOL } from '../../../common/db/pool.module';

type Params = Record<string, string>;
type CloudPayload = Record<string, any>;

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
export class TwilioWhatsAppService {
  private logger = new Logger('TwilioWhatsApp');
  private contentCache = new Map<string, string>();
  private healthCache: { at: number; value: TwilioHealth | null } = { at: 0, value: null };

  constructor(private config: ConfigService, @Inject(PG_POOL) private pool: Pool) {}

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
      return this.postMessage(to, { body: m.caption ? String(m.caption).slice(0, TWILIO_BODY_LIMIT) : undefined, media: [String(m.link)] });
    }
    if (type === 'interactive') {
      const { contentSid, vars } = await this.interactiveContent(payload.interactive);
      return this.postMessage(to, { contentSid, vars });
    }
    if (type === 'template') {
      const mapped = await this.mappedTemplate(String(payload.template?.name || ''));
      if (!mapped) throw new Error(`The WhatsApp template "${payload.template?.name}" is not set up in Twilio yet`);
      return this.postMessage(to, { contentSid: mapped, vars: this.templateVariables(payload.template) });
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

  // Business-initiated templates: a CRM template name -> its approved Twilio Content.
  private async mappedTemplate(name: string): Promise<string | null> {
    if (!name) return null;
    const { rows } = await this.pool.query(`SELECT content_sid FROM twilio_contents WHERE key = $1`, [`template:${name}`]);
    return rows[0]?.content_sid ?? null;
  }

  // Cloud API template components -> Twilio content variables: body text parameters become {{1}}..{{n}}
  // in order, a header document/image link is passed as the next variable.
  private templateVariables(t: any): Record<string, string> {
    const vars: Record<string, string> = {};
    let i = 1;
    for (const c of t?.components ?? []) {
      if (c.type === 'body') for (const p of c.parameters ?? []) vars[String(i++)] = String(p.text ?? '');
    }
    for (const c of t?.components ?? []) {
      if (c.type === 'header') for (const p of c.parameters ?? []) {
        const link = p.document?.link || p.image?.link || p.video?.link;
        if (link) vars[String(i++)] = String(link);
      }
    }
    return vars;
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

export interface TwilioHealth {
  tokenValid: boolean;
  accountName: string | null;
  senderStatus: string | null;
  senderName: string | null;
  webhookOk: boolean;
  quality: string | null;
  throughput: string | null;
}
