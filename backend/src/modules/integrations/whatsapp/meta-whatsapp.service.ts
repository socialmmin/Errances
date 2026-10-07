import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PG_POOL } from '../../../common/db/pool.module';
import { R2Service } from '../../../common/r2/r2.service';
import { ApprovedTemplate } from './twilio-whatsapp.service';

interface MetaConfig { phoneNumberId: string; wabaId: string; token: string }
export interface MetaStatus {
  configured: boolean;
  tokenValid: boolean;
  number: string | null;
  name: string | null;
  quality: string | null;
  // Customers per 24 hours for business-initiated messages; null = unlimited or unknown.
  dailyLimit: number | null;
  // Whether this app is allowed to send from the number at all, and Meta's reason when not.
  canSend: boolean;
  sendProblem: string | null;
  // Things Meta itself reports as blocking or limiting the account (payment method, verification...).
  warnings: string[];
  webhookOk: boolean;
}

const TIER_LIMITS: Record<string, number | null> = { TIER_50: 50, TIER_250: 250, TIER_1K: 1000, TIER_2K: 2000, TIER_10K: 10000, TIER_100K: 100000, TIER_UNLIMITED: null };

// WhatsApp through Meta's own Cloud API, for the parts of the CRM that are not already written
// against it: the Bulk WhatsApp page (templates, test, bulk sends) and the connection check in
// Settings. The bot, inbox, itinerary, payment and report code call the Cloud API directly, using
// the same saved connection (Settings > WhatsApp: phone number id, business account id, token).
@Injectable()
export class MetaWhatsAppService {
  private logger = new Logger('MetaWhatsApp');
  private statusCache: { at: number; value: MetaStatus | null } = { at: 0, value: null };

  constructor(private config: ConfigService, @Inject(PG_POOL) private pool: Pool, private r2: R2Service) {}

  private get version() { return this.config.get<string>('META_GRAPH_API_VERSION') || 'v23.0'; }
  private webhookUrl() { return `${(this.config.get<string>('PUBLIC_API_BASE') || 'https://api-errances.socialmm.in').replace(/\/+$/, '')}/api/integrations/meta/webhook`; }

  async connection(): Promise<MetaConfig | null> {
    const { rows } = await this.pool.query(
      `SELECT phone_number_id, business_account_id, access_token_encrypted FROM whatsapp_config WHERE is_configured = true ORDER BY created_at DESC LIMIT 1`);
    const r = rows[0];
    if (!r?.phone_number_id || !r?.business_account_id || !r?.access_token_encrypted) return null;
    return { phoneNumberId: r.phone_number_id, wabaId: r.business_account_id, token: r.access_token_encrypted };
  }

  private async need(): Promise<MetaConfig> {
    const c = await this.connection();
    if (!c) throw new Error('The Meta WhatsApp connection is not set up (Settings > WhatsApp)');
    return c;
  }

  private async call(c: MetaConfig, path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
    const res = await fetch(`https://graph.facebook.com/${this.version}/${path}`, {
      method: init.method || 'GET',
      headers: { Authorization: `Bearer ${c.token}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = data?.error ?? {};
      const err: any = new Error(e.error_user_msg || e.error_data?.details || e.message || `Meta ${res.status}`);
      err.code = e.code; err.subcode = e.error_subcode;
      throw err;
    }
    return data;
  }

  async hasAppSecret() {
    const { rows } = await this.pool.query(`SELECT app_secret FROM whatsapp_config WHERE is_configured = true ORDER BY created_at DESC LIMIT 1`).catch(() => ({ rows: [] as any[] }));
    return !!String(rows[0]?.app_secret || this.config.get<string>('META_APP_SECRET') || '').trim();
  }

  // Saves the Meta connection after checking each part with Meta itself: the token can read the
  // number, the number belongs to that WhatsApp Business Account, and (when given) the App Secret
  // is the secret of the app the token comes from. Works whichever provider is switched on.
  async saveConnection(input: { phoneNumberId: string; businessAccountId: string; accessToken: string; appSecret?: string }, userId: string | null) {
    const c: MetaConfig = { phoneNumberId: String(input.phoneNumberId || '').trim(), wabaId: String(input.businessAccountId || '').trim(), token: String(input.accessToken || '').trim() };
    if (!/^\d{6,}$/.test(c.phoneNumberId)) throw new Error('The Phone Number ID is a number, e.g. 1122537490948666');
    if (!/^\d{6,}$/.test(c.wabaId)) throw new Error('The WhatsApp Business Account ID is a number, e.g. 1461053502615965');
    if (c.token.length < 50) throw new Error('Paste the full access token');
    const number = await this.call(c, `${c.phoneNumberId}?fields=display_phone_number,verified_name`).catch((e) => { throw new Error(`Meta does not accept this token for that Phone Number ID: ${e.message}`); });
    const numbers = await this.call(c, `${c.wabaId}/phone_numbers?fields=id&limit=100`).catch((e) => { throw new Error(`Meta does not accept this token for that WhatsApp Business Account ID: ${e.message}`); });
    if (!(numbers?.data ?? []).some((n: any) => String(n.id) === c.phoneNumberId)) throw new Error('That phone number is not in that WhatsApp Business Account');
    const secret = String(input.appSecret || '').trim();
    if (secret) {
      if (!/^[0-9a-f]{32}$/i.test(secret)) throw new Error('An App Secret is 32 letters and numbers (0-9, a-f)');
      const app = await this.call(c, `debug_token?input_token=${encodeURIComponent(c.token)}`);
      const appId = app?.data?.app_id;
      const check = await fetch(`https://graph.facebook.com/${this.version}/app?access_token=${encodeURIComponent(`${appId}|${secret}`)}`);
      const checked: any = await check.json().catch(() => ({}));
      if (!check.ok || String(checked?.id) !== String(appId)) throw new Error('Meta says this is not the App Secret of the app this token belongs to');
    }
    const { rows } = await this.pool.query(`SELECT id FROM whatsapp_config WHERE is_configured = true ORDER BY created_at DESC LIMIT 1`);
    if (rows[0]) {
      await this.pool.query(
        `UPDATE whatsapp_config SET phone_number_id = $2, business_account_id = $3, access_token_encrypted = $4, app_secret = COALESCE($5, app_secret), configured_at = now(), configured_by = $6, updated_at = now() WHERE id = $1`,
        [rows[0].id, c.phoneNumberId, c.wabaId, c.token, secret || null, userId]);
    } else {
      await this.pool.query(
        `INSERT INTO whatsapp_config (phone_number_id, business_account_id, access_token_encrypted, app_secret, is_configured, configured_at, configured_by) VALUES ($1, $2, $3, $4, true, now(), $5)`,
        [c.phoneNumberId, c.wabaId, c.token, secret || null, userId]);
    }
    this.statusCache = { at: 0, value: null };
    this.logger.log(`Meta WhatsApp connection saved for ${number.display_phone_number}`);
    return { number: number.display_phone_number as string, name: (number.verified_name ?? null) as string | null };
  }

  // ---------------------------------------------------------------- connection check

  // Asks Meta for the number's state and tries a send to a recipient that cannot exist: nothing
  // is delivered, but Meta's answer tells whether this app may send from the number (it complains
  // about the recipient) or not (it refuses the request itself -- e.g. the number is still hosted
  // by another provider). Cached for a minute.
  async status(fresh = false): Promise<MetaStatus> {
    if (!fresh && this.statusCache.value && Date.now() - this.statusCache.at < 60000) return this.statusCache.value;
    const out: MetaStatus = { configured: false, tokenValid: false, number: null, name: null, quality: null, dailyLimit: null, canSend: false, sendProblem: null, warnings: [], webhookOk: false };
    const c = await this.connection();
    if (!c) { out.sendProblem = 'The Meta connection has not been saved yet'; return out; }
    out.configured = true;
    try {
      const n = await this.call(c, `${c.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier,status,health_status,webhook_configuration`);
      out.tokenValid = true;
      out.number = n.display_phone_number ?? null;
      out.name = n.verified_name ?? null;
      out.quality = n.quality_rating ?? null;
      out.dailyLimit = n.messaging_limit_tier in TIER_LIMITS ? TIER_LIMITS[n.messaging_limit_tier] : 250;
      out.webhookOk = Object.values(n.webhook_configuration ?? {}).some((u) => String(u) === this.webhookUrl());
      if (!out.webhookOk) {
        const subs = await this.call(c, `${c.wabaId}/subscribed_apps`).catch(() => null);
        out.webhookOk = !!subs?.data?.length;
      }
      for (const entity of n.health_status?.entities ?? []) {
        // Calling (SIP) is a separate WhatsApp feature the CRM does not use.
        for (const e of entity.errors ?? []) if (![138024, 138025].includes(e.error_code)) out.warnings.push(String(e.error_description));
        for (const info of entity.additional_info ?? []) out.warnings.push(String(info));
      }
    } catch (e: any) {
      out.sendProblem = `Meta does not accept the saved token or number: ${e.message}`;
      this.statusCache = { at: Date.now(), value: out };
      return out;
    }
    try {
      await this.call(c, `${c.phoneNumberId}/messages`, { method: 'POST', body: { messaging_product: 'whatsapp', to: '0', type: 'text', text: { body: 'connection check' } } });
      out.canSend = true; // not expected for recipient "0", but it would mean sending works
    } catch (e: any) {
      const refused = /unsupported (post )?request/i.test(e.message) || e.code === 10 || e.code === 200 || e.code === 190 || e.code === 133010;
      out.canSend = !refused;
      if (refused) {
        out.sendProblem = e.code === 133010
          ? 'The number is not registered for the Cloud API with this app yet.'
          : `Meta refuses to send from this number with this app (${e.message}). The number is usually still hosted by another provider (Twilio), or the app has not been given the WhatsApp account.`;
      }
    }
    this.statusCache = { at: Date.now(), value: out };
    return out;
  }

  // ---------------------------------------------------------------- templates

  // Every template in the WhatsApp Business Account, in the shape the Bulk WhatsApp page uses.
  async listTemplates(): Promise<ApprovedTemplate[]> {
    const c = await this.need();
    const out: ApprovedTemplate[] = [];
    let path = `${c.wabaId}/message_templates?fields=id,name,status,category,language,components,rejected_reason&limit=100`;
    for (let page = 0; path && page < 20; page++) {
      const data = await this.call(c, path);
      for (const t of data?.data ?? []) {
        const components: any[] = t.components ?? [];
        const body = String(components.find((x) => x.type === 'BODY')?.text ?? '');
        const header = components.find((x) => x.type === 'HEADER');
        const buttons: any[] = components.filter((x) => x.type === 'BUTTONS').flatMap((x) => x.buttons ?? []);
        const numbers = [...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
        const examples: any[] = components.find((x) => x.type === 'BODY')?.example?.body_text?.[0] ?? [];
        const status = String(t.status || 'PENDING').toUpperCase();
        out.push({
          sid: String(t.id), name: t.name, category: String(t.category || '').toUpperCase(), language: t.language, kind: 'meta', body,
          footer: components.find((x) => x.type === 'FOOTER')?.text ?? null,
          hasMedia: !!header && ['IMAGE', 'DOCUMENT', 'VIDEO'].includes(header.format),
          buttons: buttons.map((b) => String(b.text || '')).filter(Boolean),
          variables: numbers.map((n) => ({ number: n, sample: String(examples[n - 1] ?? ''), inBody: true })),
          status: ['APPROVED', 'REJECTED', 'PAUSED', 'DISABLED'].includes(status) ? status : 'PENDING',
          rejectionReason: t.rejected_reason && t.rejected_reason !== 'NONE' ? String(t.rejected_reason).replace(/_/g, ' ').toLowerCase() : null,
          createdAt: null,
        });
      }
      const next: string | undefined = data?.paging?.next;
      path = next ? next.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+\//, '') : '';
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Creates a template (Meta's own format) and so submits it for review. An image or PDF header
  // is given as a stored file: Meta first wants it uploaded as the sample.
  async createTemplate(def: { name: string; language: string; category: string; components: any[] }, header?: { objectKey: string; filename: string }): Promise<{ id: string; status: string }> {
    const c = await this.need();
    const components = [...def.components];
    if (header) {
      const file = await this.r2.getObject(header.objectKey);
      if (!file) throw new Error('The uploaded image or document could not be found');
      const app = await this.call(c, `debug_token?input_token=${encodeURIComponent(c.token)}`);
      const appId = this.config.get<string>('META_APP_ID') || app?.data?.app_id;
      if (!appId) throw new Error('Could not work out the Meta app for this token');
      const session = await this.call(c, `${appId}/uploads?file_length=${file.body.length}&file_type=${encodeURIComponent(file.contentType)}&file_name=${encodeURIComponent(header.filename)}`, { method: 'POST' });
      const up = await fetch(`https://graph.facebook.com/${this.version}/${session.id}`, { method: 'POST', headers: { Authorization: `OAuth ${c.token}`, file_offset: '0', 'Content-Type': file.contentType }, body: file.body as any });
      const uploaded: any = await up.json().catch(() => ({}));
      if (!up.ok || !uploaded.h) throw new Error(`Meta did not accept the sample file: ${uploaded?.error?.message || up.status}`);
      components.unshift({ type: 'HEADER', format: file.contentType.startsWith('image/') ? 'IMAGE' : 'DOCUMENT', example: { header_handle: [uploaded.h] } });
    }
    const created = await this.call(c, `${c.wabaId}/message_templates`, { method: 'POST', body: { name: def.name, language: def.language, category: def.category, components } });
    this.logger.log(`Template ${def.name} submitted to WhatsApp through Meta (${created.id})`);
    return { id: String(created.id), status: String(created.status || 'PENDING').toUpperCase() };
  }

  async deleteTemplate(name: string) {
    const c = await this.need();
    await this.call(c, `${c.wabaId}/message_templates?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
  }

  // ---------------------------------------------------------------- sending

  // One approved template to one number. `bodyValues` fill {{1}}, {{2}}... in order; a template
  // with an image or PDF above it needs that file's link again with every send. Returns Meta's
  // message id, which the delivery receipts on the webhook refer to.
  async sendTemplate(toDigits: string, template: { name: string; language: string }, bodyValues: string[], header?: { format: string; link: string; filename?: string }): Promise<string> {
    const c = await this.need();
    const components: any[] = [];
    if (header) {
      components.push({ type: 'header', parameters: [header.format === 'IMAGE' ? { type: 'image', image: { link: header.link } } : { type: 'document', document: { link: header.link, filename: header.filename } }] });
    }
    // Meta rejects a value with line breaks, tabs or long runs of spaces.
    if (bodyValues.length) components.push({ type: 'body', parameters: bodyValues.map((v) => ({ type: 'text', text: String(v).replace(/\s+/g, ' ').trim() || '-' })) });
    const sent = await this.call(c, `${c.phoneNumberId}/messages`, {
      method: 'POST',
      body: { messaging_product: 'whatsapp', to: toDigits, type: 'template', template: { name: template.name, language: { code: template.language }, ...(components.length ? { components } : {}) } },
    });
    return String(sent?.messages?.[0]?.id);
  }
}
