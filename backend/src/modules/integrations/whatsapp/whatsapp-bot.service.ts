import { BadRequestException, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { promises as fsp } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { createHmac, timingSafeEqual } from 'crypto';
import { PG_POOL } from '../../../common/db/pool.module';
import { R2Service } from '../../../common/r2/r2.service';
import { LeadsService } from '../../leads/leads.service';
import { CreateLeadDto } from '../../leads/dto/create-lead.dto';
import { RealtimeGateway } from '../../../common/realtime/realtime.gateway';
import { PackagesService } from '../../packages/packages.service';
import { PushService } from '../../../common/push/push.service';

interface WhatsAppReferral {
  source_url?: string;
  source_type?: string;
  source_id?: string;
  headline?: string;
  body?: string;
  media_type?: string;
  ctwa_clid?: string;
}

// Itinerary templates that carry a tap-to-call button (the number is fixed
// inside the template, so there is one template per distinct number) plus a
// "Request a call back" quick-reply button.
// WhatsApp does not allow line breaks inside a template variable, so the
// message is split into two paragraphs (hook + offer) that the template body
// places on separate lines with a blank line between them.
export function splitItineraryMessage(message: string): [string, string] {
  const clean = String(message || '').replace(/\r/g, '').trim();
  const parts = clean.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts.slice(1).join(' ')];
  const one = (parts[0] || clean).replace(/\s+/g, ' ');
  const match = one.match(/^(.+?[?!.])\s+(.+)$/);
  if (match) return [match[1], match[2]];
  return [one, 'Tap a button below to reach our expert.'];
}

const V2_TEMPLATE_PREFIX = 'campaign_itinerary_v9_';

const MALE_NAMES = new Set('ramesh suresh kumar arun murugan natarajan sankar shankar ganesh prabhakar anand babu raja rajan ravi senthil karthik karthick vijay vinoth mani selvam siva sivakumar kannan balaji gopal gopalakrishnan hari mohan naveen prakash rajesh ramasamy saravanan sathish satish sundar venkat venkatesh abhishek abdul azizur mounish prabin muruga chandrasakaran chandru baskar baskaran dinesh manoj mahesh ramkumar santhosh sivaraman subramanian sekar selvaraj thiru vignesh vasanth vishnu yogesh ashok ajay amit rahul rohit sanjay sachin nagarajan nataraj manikandan elango ilango kalyan krishnan lokesh magesh mohamed muhammad nandha nithin paras parthiban pradeep raghu rajkumar ramachandran sabari sakthivel sathya sudhakar surya tamil udhaya velmurugan vetri'.split(' '));
const FEMALE_NAMES = new Set('lakshmi priya kavitha meena divya anitha anita sangeetha deepa revathi sumathi vasanthi uma radha geetha gita sasikala jayanthi malathi pooja nithya mythili saranya sowmya shanthi latha kala banu fathima ayesha nisha sneha anjali rekha sudha vimala kalpana kousalya lalitha malini nirmala padma parvathi poornima ramya rani renuka sandhya selvi shobana sridevi sujatha sumitha swathi tamilselvi vidya vani yamuna bharathi'.split(' ').filter((n) => n !== 'bharathi'));

// "Hello Mr. Sankar," -- a title is added only for well-known first names; anything
// uncertain gets the plain first name so nobody is mislabelled.
export function greetingFor(rawName?: string | null): string {
  const cleaned = String(rawName || '').replace(/<[^>]*>/g, ' ').replace(/test lead|dummy data|full_name/gi, ' ').replace(/[^\p{L}\p{M}\s.'-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const tokens = cleaned.split(' ').filter((t) => t.replace(/\./g, '').length > 2);
  if (!tokens.length) return 'Traveller';
  const first = tokens[0].replace(/\./g, '');
  const latin = /^[A-Za-z'-]+$/.test(first);
  const display = latin ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : first;
  const key = first.toLowerCase();
  const title = latin ? (MALE_NAMES.has(key) ? 'Mr. ' : FEMALE_NAMES.has(key) ? 'Ms. ' : '') : '';
  return `${title}${display}`.slice(0, 40);
}
// Meta blocks wa.me links on buttons, so Chat buttons point at our own redirect,
// which forwards the customer to WhatsApp with the starting message filled in.
const PUBLIC_API_BASE = process.env.PUBLIC_API_BASE || 'https://api-errances.socialmm.in';

export interface PackageButton { type: 'call' | 'url' | 'chat'; text: string; phone?: string; url?: string; reply?: string }

// The buttons an itinerary sends: what the user configured, or the classic
// call + chat pair for older itineraries.
export function resolveButtons(pkg: any): PackageButton[] {
  let list: any = pkg?.buttons;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = null; } }
  if (!Array.isArray(list) || !list.length) {
    list = [];
    if (String(pkg?.contact_number || '').trim()) list.push({ type: 'call', text: pkg?.contact_button_text || 'Call our experts' });
    list.push({ type: 'chat', text: 'Chat with us' });
  }
  return list.filter((b: any) => b && ['call', 'url', 'chat'].includes(b.type));
}

// Meta wants call/link buttons first and quick replies grouped after them.
export function buildMetaButtons(pkg: any): { meta: any[]; quickReplyIndexes: number[]; signature: string; ordered: PackageButton[] } {
  const all = resolveButtons(pkg);
  const ordered = [...all.filter((b) => b.type === 'call').slice(0, 1), ...all.filter((b) => b.type === 'url' || b.type === 'chat').slice(0, 2)];
  const meta: any[] = [];
  const quickReplyIndexes: number[] = [];
  ordered.forEach((b, index) => {
    const text = String(b.text || '').trim().slice(0, 25);
    if (!text) throw new BadRequestException('Every button needs some text');
    if (b.type === 'call') {
      const mobile = normalizeIndianMobile(b.phone || pkg?.contact_number);
      if (!mobile) throw new BadRequestException('The Call button needs a valid 10-digit Indian mobile number, for example 9443146955');
      meta.push({ type: 'PHONE_NUMBER', text, phone_number: '+91' + mobile });
    } else if (b.type === 'url') {
      const url = String(b.url || '').trim();
      if (!/^https?:\/\/\S+\.\S+/.test(url)) throw new BadRequestException('Website buttons need a full link starting with https://');
      meta.push({ type: 'URL', text, url });
    } else {
      const callFallback = all.find((c) => c.type === 'call')?.phone;
      if (!normalizeIndianMobile(b.phone || callFallback || pkg?.contact_number)) throw new BadRequestException('The Chat button needs a valid 10-digit WhatsApp number, for example 9443146955');
      // dynamic link: the per-send suffix is <itineraryId>.<buttonPosition>
      meta.push({ type: 'URL', text, url: `${PUBLIC_API_BASE}/api/integrations/whatsapp/chat/{{1}}`, example: [`${PUBLIC_API_BASE}/api/integrations/whatsapp/chat/00000000-0000-0000-0000-000000000000.1`] });
      quickReplyIndexes.push(index);
    }
  });
  const signature = createHash('sha1').update(JSON.stringify(meta)).digest('hex').slice(0, 10);
  return { meta, quickReplyIndexes, signature, ordered };
}
const isButtonTemplate = (name: string) => /^campaign_itinerary_v\d+_/.test(String(name || ''));

// Indian mobile numbers only: 10 digits, optionally prefixed by 0, 91 or +91.
export function normalizeIndianMobile(value: string): string | null {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  // Meta lead forms sometimes prepend a wrong "+1" to an Indian mobile
  // (+1 9843780129) -- the welcome then goes to a dead number and the whole
  // itinerary chain silently never starts. An Indian-format mobile behind a +1
  // is treated as Indian.
  if (digits.length === 11 && digits.startsWith('1') && /^[6-9]/.test(digits.slice(1))) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}
const CALLBACK_PAYLOAD = 'CALLBACK_REQUEST';

const GREETING =
  "Hi! 👋 Welcome to Errances Voyages. Tap \"View Packages\" below to browse our tour packages — we'll send you the full itinerary for whichever one you pick.";

interface WhatsAppConfig {
  phone_number_id: string;
  business_account_id: string;
  access_token: string;
}

@Injectable()
export class WhatsAppBotService implements OnModuleInit {
  private logger = new Logger('WhatsAppBotService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private config: ConfigService,
    private r2: R2Service,
    private leadsService: LeadsService,
    private realtime: RealtimeGateway,
    private packagesService: PackagesService,
    private push: PushService,
  ) {}

  // Safety net for the other failure mode: a lead that never even got an attempt
  // (the auto-trigger didn't fire at all -- e.g. it arrived on a new WhatsApp
  // contact whose lead record only appeared after the package went active).
  // Every 20 minutes, for every active+approved package, find leads matching its
  // destination with zero itinerary log rows ever, try sending to them now
  // (sendItineraryForLead's own dedup guard makes this safe to run repeatedly),
  // and alert with a tally either way so a missed lead is never just silence.
  onModuleInit() {
    // The old "sweep never-attempted leads" job stays OFF (it sent 161 messages
    // unattended). Only this narrow, slow, approved retry queue runs: it retries
    // Meta-throttled failures a few at a time, well spaced, in daytime only.
    const run = () => this.retryThrottledQueue().catch((err) => this.logger.error(`retryThrottledQueue crashed: ${err.message}`));
    setInterval(run, 60 * 60 * 1000);
    setTimeout(run, 2 * 60 * 1000); // first pass shortly after each start, so nothing waits a full hour

    // WhatsApp's Cloud API has no "check status" endpoint -- Meta only tells us delivery status by
    // pushing a webhook. If that webhook never arrives, an itinerary silently sits at "accepted"
    // forever and the CRM would keep showing it as sent, which is exactly the false-confidence bug
    // that caused real customers to be told "it's sent" when it never reached them. This sweep finds
    // those, relabels them honestly as unconfirmed, retries them, and alerts a human either way.
    const reconcile = () => this.reconcileUnconfirmedSends().catch((err) => this.logger.error(`reconcileUnconfirmedSends crashed: ${err.message}`));
    setInterval(reconcile, 30 * 60 * 1000);
    setTimeout(reconcile, 90 * 1000);
  }

  // Anything still sitting at 'accepted' 2+ hours after we sent it has had more than enough time for
  // Meta's normal delivery webhook (which usually lands in seconds). Relabel it 'unconfirmed' --
  // never "sent", because we genuinely do not know -- free it up for a retry, and alert staff by name
  // so nobody has to be told by an angry customer that "the CRM said it was sent."
  private async reconcileUnconfirmedSends() {
    const { rows } = await this.pool.query(
      `UPDATE whatsapp_logs SET status = 'unconfirmed',
              error_message = 'Meta accepted this message but never confirmed delivery within 2 hours. We cannot verify whether it reached the customer -- WhatsApp gives no way to check after the fact, only automatic webhooks, which did not arrive for this one.'
        WHERE message_type = 'itinerary' AND status = 'accepted' AND is_deleted = false AND created_at < now() - interval '2 hours'
        RETURNING id, lead_id, package_id, to_number`,
    );
    if (!rows.length) return;
    const { rows: named } = await this.pool.query(
      `SELECT w.id, l.customer_name, l.destination FROM whatsapp_logs w JOIN leads l ON l.id = w.lead_id WHERE w.id = ANY($1::uuid[])`,
      [rows.map((r: any) => r.id)],
    );
    this.logger.warn(`reconcileUnconfirmedSends: ${rows.length} itinerary sends never got a delivery confirmation from Meta -- relabelled unconfirmed, queued for retry: ${named.map((n: any) => n.customer_name).slice(0, 5).join(', ')}`);
    this.push.notifyAll({
      title: `${rows.length} WhatsApp itinerar${rows.length > 1 ? 'ies never' : 'y never'} confirmed delivered`,
      body: `Meta accepted ${rows.length > 1 ? 'these sends' : 'this send'} but never confirmed delivery -- the CRM cannot claim they were sent. Check Failed WhatsApp: ${named.slice(0, 3).map((n: any) => n.customer_name).join(', ')}${named.length > 3 ? '…' : ''}`,
      url: '/failed-whatsapp',
    }).catch(() => undefined);
    for (const row of rows) {
      try { await this.resendItineraryToLead(row.package_id, row.lead_id); }
      catch (err: any) { this.logger.warn(`reconcileUnconfirmedSends: retry failed for lead ${row.lead_id}: ${err.message}`); }
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
  }

  // Meta's per-customer marketing throttle is temporary and usually clears after a
  // day, so a few failures per hour, retried only once they're 24h+ old, succeed far
  // more often than one big burst. At most 10 per run, 09:00-19:59 IST, live mode
  // only, max 3 failed attempts per person -- after that a human is alerted to send
  // it by hand (WhatsApp Web). Every send still passes the duplicate-proof claim.
  private async retryThrottledQueue() {
    const istHour = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCHours();
    if (istHour < 9 || istHour > 19) return;
    const { data: failed } = await this.listFailedItineraries();
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    // Never-attempted leads go first and need no 24h wait (nothing has been throttled yet).
    const candidates = [
      ...failed.filter((f) => (f.fault as string) === 'queued' && !f.manualAt),
      ...failed
        .filter((f) => f.fault === 'meta' && f.retryable && new Date(f.failedAt).getTime() < dayAgo)
        .sort((a, b) => new Date(a.failedAt).getTime() - new Date(b.failedAt).getTime()),
    ];
    let tried = 0, sent = 0;
    const exhausted: string[] = [];
    for (const item of candidates) {
      if (tried >= 10) break;
      const { rows } = await this.pool.query(
        `SELECT count(*)::int AS n FROM whatsapp_logs WHERE lead_id=$1 AND package_id=$2 AND message_type='itinerary' AND status='failed' AND is_deleted=false`,
        [item.leadId, item.packageId],
      );
      if (rows[0].n >= 3) continue; // already handed to a human
      tried++;
      try {
        const r = await this.resendItineraryToLead(item.packageId, item.leadId);
        if (r.sent) sent++;
      } catch { /* logged as a failed attempt by the dispatcher */ }
      const { rows: after } = await this.pool.query(
        `SELECT count(*)::int AS n FROM whatsapp_logs WHERE lead_id=$1 AND package_id=$2 AND message_type='itinerary' AND status='failed' AND is_deleted=false`,
        [item.leadId, item.packageId],
      );
      if (after[0].n >= 3) exhausted.push(item.customerName);
      await new Promise((resolve) => setTimeout(resolve, 6000));
    }
    if (exhausted.length) {
      this.push.notifyAll({
        title: `${exhausted.length} itinerar${exhausted.length > 1 ? 'ies' : 'y'} still blocked after 3 tries`,
        body: `Send by hand via WhatsApp Web: ${exhausted.slice(0, 3).join(', ')}${exhausted.length > 3 ? '…' : ''}`,
        url: '/packages',
      }).catch(() => undefined);
    }
    if (tried) this.logger.log(`retryThrottledQueue: tried ${tried}, accepted by Meta ${sent} (delivery confirmed later by webhook), ${exhausted.length} handed to a human`);
  }

  private async sweepUntriedLeads() {
    const config = await this.getConfig();
    if (!config) return;
    const { rows: packages } = await this.pool.query(
      `SELECT * FROM tour_packages WHERE is_deleted = false AND is_active = true AND whatsapp_template_status = 'APPROVED' AND itinerary_pdf_object_key IS NOT NULL`,
    );
    let sent = 0, failed = 0;
    const failedNames: string[] = [];
    for (const pkg of packages) {
      const leads = (await this.leadsForPackage(pkg)).filter((l: any) => !l.sent_at);
      for (const lead of leads) {
        const to = this.toWaNumber(lead.phone);
        if (!to) continue;
        try {
          // sendItineraryForLead catches its own send errors and returns false
          // (already logged + alerted internally) rather than throwing -- count
          // that as a failure too, not just an unexpected thrown exception.
          const ok = await this.sendItineraryForLead(config, to, lead.id);
          if (ok) sent++; else { failed++; failedNames.push(lead.customer_name); }
        } catch (err: any) {
          failed++;
          failedNames.push(lead.customer_name);
          this.logger.error(`sweepUntriedLeads: lead ${lead.id} still failed: ${err.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    if (sent > 0 || failed > 0) {
      this.logger.log(`sweepUntriedLeads: caught up ${sent} never-attempted leads, ${failed} still failed`);
      this.push.notifyAll({
        title: sent > 0 ? `Caught up ${sent} missed itinerary send${sent > 1 ? 's' : ''}` : `${failed} itinerary send${failed > 1 ? 's' : ''} still failing`,
        body: sent > 0 && failed === 0 ? 'These leads had never been attempted -- sent automatically just now.' : `Still failing: ${failedNames.slice(0, 3).join(', ')}${failedNames.length > 3 ? '…' : ''} — check Failed Sends.`,
        url: '/packages',
      }).catch(() => undefined);
    }
  }

  // ---- THE single gate every itinerary send must pass through ----
  // Atomically claims the right to send this destination's itinerary to this
  // phone number, before anything touches WhatsApp's API. The claim is a
  // database INSERT guarded by a real unique index (migration 036) on
  // (normalized phone, package) -- not a "check, then act" query, which two
  // triggers firing close together can both pass. Whoever's INSERT succeeds
  // owns the send; everyone else gets told "already claimed" and stops, no
  // exceptions, no matter which of the (now consolidated) trigger paths called.
  private async claimItinerarySend(to: string, packageId: string): Promise<{ claimed: true; logId: string } | { claimed: false }> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO whatsapp_logs(to_number, status, package_id, message_type) VALUES($1,'sending',$2,'itinerary') RETURNING id`,
        [to, packageId],
      );
      return { claimed: true, logId: rows[0].id };
    } catch (err: any) {
      if (err.code === '23505') return { claimed: false }; // unique_violation -- someone else already has this
      throw err;
    }
  }

  // Every itinerary send -- automatic on a new lead, backlog catch-up, a named
  // agent's manual Resend, or a customer picking a package from the chat menu --
  // must call this and only this. `send` is the actual WhatsApp API call for
  // that specific case (template vs plain document); everything else (the
  // claim, recording the result, alerting on failure, updating the lead's
  // pipeline stage) is identical and lives here exactly once.
  private async dispatchItinerary(opts: {
    to: string; leadId: string | null; packageId: string; templateName: string | null; customerName: string | null;
    destination: string | null; trigger: 'auto' | 'backlog' | 'resend' | 'chat'; actorUserId?: string;
    send: () => Promise<any>;
    afterSend?: (result: any) => Promise<void>;
  }): Promise<{ sent: boolean; reason?: string; error?: string }> {
    const claim = await this.claimItinerarySend(opts.to, opts.packageId);
    if (!claim.claimed) {
      this.logger.log(`dispatchItinerary: claim lost for ${opts.to} / package ${opts.packageId} -- already sent or in flight (trigger=${opts.trigger})`);
      return { sent: false, reason: 'already_sent' };
    }
    try {
      const result = await opts.send();
      await this.pool.query(
        `UPDATE whatsapp_logs SET status='accepted', sent_at=now(), message_id=$2, lead_id=$3, template_name=$4, sent_by=$5, triggered_by=$6 WHERE id=$1`,
        [claim.logId, result?.messages?.[0]?.id ?? null, opts.leadId, opts.templateName, opts.actorUserId ?? null, opts.trigger],
      );
      if (opts.afterSend) await opts.afterSend(result);
      // The lead's own pipeline Status is a human decision (Contacted, Follow-up, etc.) and must
      // never be overwritten just because a WhatsApp message went out -- that erased staff's own
      // work every time a retry or reconciliation resend fired. Whether the itinerary itself
      // reached the customer lives entirely in the separate "Auto WhatsApp" delivery status
      // (whatsapp_logs / the Leads table's own column), never in leads.status.
      return { sent: true };
    } catch (err: any) {
      await this.pool.query(
        `UPDATE whatsapp_logs SET status='failed', error_message=$2, lead_id=$3, template_name=$4, sent_by=$5, triggered_by=$6 WHERE id=$1`,
        [claim.logId, String(err.message).slice(0, 300), opts.leadId, opts.templateName, opts.actorUserId ?? null, opts.trigger],
      );
      if (opts.trigger !== 'resend') this.alertFailedSend(opts.customerName || opts.to, opts.destination, err.message, opts.leadId ?? undefined);
      return { sent: false, reason: 'send_failed', error: err.message };
    }
  }

  // The one rule this exists for: a failed automatic send must never just sit
  // quietly in a log table. Every place that records status='failed' for an
  // itinerary calls this immediately -- push notification, not a page someone
  // has to remember to open.
  private alertFailedSend(customerName: string, destination: string | null, reason: string | null, leadId?: string) {
    this.realtime.broadcastItineraryFailed({ lead_id: leadId ?? null, customer_name: customerName, destination, reason });
    this.push.notifyAll({
      title: `Itinerary failed to send — ${customerName}`,
      body: `${destination ? destination + ' — ' : ''}${reason || 'WhatsApp did not give a reason'}`,
      url: '/packages',
    }).catch((err) => this.logger.error(`alertFailedSend push failed: ${err.message}`));
  }

  verifySubscription(mode?: string, token?: string): boolean {
    const expected = this.config.get<string>('META_VERIFY_TOKEN');
    return mode === 'subscribe' && !!expected && token === expected;
  }

  private appSecretCache: { secrets: string[]; at: number } = { secrets: [], at: 0 };
  private lastRejectedAt: Date | null = null;

  // Secrets that may sign webhooks: the one saved in the CRM, then the server setting.
  private async getAppSecrets(): Promise<string[]> {
    if (Date.now() - this.appSecretCache.at < 30000) return this.appSecretCache.secrets;
    const { rows } = await this.pool.query(`SELECT app_secret FROM whatsapp_config WHERE is_configured = true ORDER BY created_at DESC LIMIT 1`).catch(() => ({ rows: [] as any[] }));
    const secrets = [rows[0]?.app_secret, this.config.get<string>('META_APP_SECRET')].filter((v): v is string => !!v && !!v.trim());
    this.appSecretCache = { secrets, at: Date.now() };
    return secrets;
  }

  async verifySignature(rawBody: Buffer | undefined, signatureHeader: string | undefined): Promise<boolean> {
    if (!rawBody || !signatureHeader) return false;
    const providedBuf = Buffer.from(signatureHeader.replace(/^sha256=/, ''), 'hex');
    for (const secret of await this.getAppSecrets()) {
      const expectedBuf = createHmac('sha256', secret).update(rawBody).digest();
      if (expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf)) return true;
    }
    this.lastRejectedAt = new Date();
    this.logger.warn('WhatsApp webhook rejected: signature does not match the Meta App Secret (fix it in CRM > WhatsApp Inbox)');
    return false;
  }

  // 'valid' / 'invalid' are conclusive answers from Meta. 'unknown' means Meta refused to even
  // answer right now (its own rate limit on this specific debug call) -- that is NOT the same as
  // the secret being wrong, and callers must not treat it as a failure.
  private async metaSecretWorks(appId: string, secret: string): Promise<'valid' | 'invalid' | 'unknown'> {
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    try {
      const res = await fetch(`https://graph.facebook.com/${version}/app?access_token=${encodeURIComponent(appId + '|' + secret)}`);
      const data: any = await res.json();
      if (res.ok && data?.id) return 'valid';
      if (data?.error?.is_transient || data?.error?.code === 4 || data?.error?.code === 17 || data?.error?.code === 32) return 'unknown';
      return 'invalid';
    } catch { return 'unknown'; }
  }

  // Re-verifying with Meta on every 30-second health poll was itself tripping Meta's rate
  // limit for this one endpoint, which then showed a false "App Secret is wrong" banner even
  // though the secret was fine and real webhooks kept working the whole time. Verify at most
  // once every 5 minutes, and if Meta can't give a conclusive answer, keep showing whatever we
  // last confirmed instead of flipping the banner red on a throttle.
  private secretVerifyCache: { valid: boolean; source: 'crm' | 'server' | null; at: number } = { valid: false, source: null, at: 0 };

  // Everything that must be true for customer messages to reach the CRM.
  async connectionHealth() {
    const out: any = { configured: false, tokenValid: false, appId: null, appName: null, secretSource: null, secretValid: false, subscribed: false, inboundCount: 0, lastInboundAt: null, lastRejectedAt: this.lastRejectedAt };
    const config = await this.getConfig();
    if (!config) return out;
    out.configured = true;
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    try {
      const res = await fetch(`https://graph.facebook.com/${version}/debug_token?input_token=${encodeURIComponent(config.access_token)}&access_token=${encodeURIComponent(config.access_token)}`);
      const data: any = await res.json();
      out.tokenValid = !!data?.data?.is_valid;
      out.appId = data?.data?.app_id ?? null;
      out.appName = data?.data?.application ?? null;
    } catch { /* leave defaults */ }
    if (out.appId) {
      if (Date.now() - this.secretVerifyCache.at < 5 * 60000) {
        out.secretValid = this.secretVerifyCache.valid;
        out.secretSource = this.secretVerifyCache.source;
      } else {
        const { rows } = await this.pool.query(`SELECT app_secret FROM whatsapp_config WHERE is_configured = true ORDER BY created_at DESC LIMIT 1`).catch(() => ({ rows: [] as any[] }));
        const crmSecret: string | undefined = rows[0]?.app_secret;
        const envSecret = this.config.get<string>('META_APP_SECRET');
        const crmResult = crmSecret ? await this.metaSecretWorks(out.appId, crmSecret) : 'invalid';
        const envResult = crmResult !== 'valid' && envSecret ? await this.metaSecretWorks(out.appId, envSecret) : 'invalid';
        if (crmResult === 'valid') { out.secretValid = true; out.secretSource = 'crm'; this.secretVerifyCache = { valid: true, source: 'crm', at: Date.now() }; }
        else if (envResult === 'valid') { out.secretValid = true; out.secretSource = 'server'; this.secretVerifyCache = { valid: true, source: 'server', at: Date.now() }; }
        else if (crmResult === 'unknown' || envResult === 'unknown') {
          // Meta wouldn't give a conclusive answer on the debug call itself (its own rate limit).
          // Fall back to the real ground truth we already track: has an actual incoming webhook
          // been rejected by verifySignature() recently? If not, the secret is demonstrably
          // working right now regardless of what this one throttled debug call says.
          const recentlyRejected = !!this.lastRejectedAt && Date.now() - this.lastRejectedAt.getTime() < 30 * 60000;
          out.secretValid = !recentlyRejected;
          out.secretSource = out.secretValid ? (this.secretVerifyCache.source ?? 'crm') : null;
          out.secretCheckThrottled = true;
        } else {
          out.secretValid = false;
          out.secretSource = null;
          this.secretVerifyCache = { valid: false, source: null, at: Date.now() };
        }
      }
      try {
        const res = await fetch(`https://graph.facebook.com/${version}/${config.business_account_id}/subscribed_apps?access_token=${encodeURIComponent(config.access_token)}`);
        const data: any = await res.json();
        out.subscribed = (data?.data || []).some((x: any) => String(x?.whatsapp_business_api_data?.id) === String(out.appId));
      } catch { /* leave default */ }
    }
    const { rows: stats } = await this.pool.query(`SELECT count(*)::int AS n, max(created_at) AS last FROM whatsapp_messages WHERE direction = 'in'`).catch(() => ({ rows: [{ n: 0, last: null }] }));
    out.inboundCount = stats[0]?.n ?? 0;
    out.lastInboundAt = stats[0]?.last ?? null;
    // Straight from Meta, not inferred: this is what actually decides whether
    // "healthy ecosystem engagement" throttling hits you. GREEN/STANDARD means
    // the account itself is in good standing -- throttling is then almost
    // always about sending pace, not account quality.
    out.qualityRating = null;
    out.throughputTier = null;
    try {
      const res = await fetch(`https://graph.facebook.com/${version}/${config.phone_number_id}?fields=quality_rating,throughput&access_token=${encodeURIComponent(config.access_token)}`);
      const data: any = await res.json();
      out.qualityRating = data?.quality_rating ?? null;
      out.throughputTier = data?.throughput?.level ?? null;
    } catch { /* leave null, non-critical */ }
    return out;
  }

  // Saves the App Secret typed into the CRM -- only after Meta confirms it belongs to the connected app.
  async saveAppSecret(secret: string) {
    const value = String(secret || '').trim();
    if (!/^[0-9a-f]{32}$/i.test(value)) throw new BadRequestException('An App Secret is 32 letters and numbers (0-9, a-f). Copy it again from App settings > Basic.');
    const config = await this.getConfig();
    if (!config) throw new BadRequestException('WhatsApp is not configured');
    const health = await this.connectionHealth();
    if (!health.appId) throw new BadRequestException('Could not identify the Meta app from the WhatsApp token');
    const result = await this.metaSecretWorks(health.appId, value);
    if (result === 'unknown') throw new BadRequestException('Meta could not confirm this right now (it is rate-limiting this check) — please try again in a minute.');
    if (result !== 'valid') throw new BadRequestException('Meta says this is not the App Secret of "' + (health.appName || health.appId) + '". Open that app > App settings > Basic > App secret.');
    await this.pool.query(`UPDATE whatsapp_config SET app_secret = $1 WHERE is_configured = true`, [value]);
    this.appSecretCache = { secrets: [], at: 0 };
    this.secretVerifyCache = { valid: true, source: 'crm', at: Date.now() };
    return this.connectionHealth();
  }

  async processWebhookPayload(body: any): Promise<void> {
    const entries = body?.entry ?? [];
    for (const entry of entries) {
      const changes = entry?.changes ?? [];
      for (const change of changes) {
        if (change?.field !== 'messages') continue;
        const value = change.value ?? {};
        const statuses = value.statuses ?? [];
        for (const delivery of statuses) {
          const error = delivery.errors?.[0];
          this.logger.log(
            `WhatsApp delivery ${delivery.id || 'unknown'} to ${delivery.recipient_id || 'unknown'}: ${delivery.status || 'unknown'}` +
            (error ? ` (code ${error.code || 'unknown'}: ${error.title || error.message || 'delivery failed'}${error.error_data?.details ? ` — ${error.error_data.details}` : ''})` : ''),
          );
          if (delivery.recipient_id && delivery.status) {
            const errorMessage = error ? (error.error_data?.details || error.title || error.message) : null;
            // Chat bubbles (agent-typed text, files) carry their own delivery state, so the Inbox can
            // show sent / delivered / read / failed-with-reason exactly like WhatsApp.
            // Meta's webhook delivery order is not guaranteed (retries can replay an older
            // "delivered" event after we've already recorded "read"). Rank the statuses so a
            // late/out-of-order event can never downgrade a tick that's already further along.
            const STATUS_RANK: Record<string, number> = { sent: 1, accepted: 1, delivered: 2, read: 3, failed: 4 };
            const rank = STATUS_RANK[delivery.status] ?? 0;
            if (delivery.id) {
              await this.pool.query(
                `UPDATE whatsapp_messages SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('status', $2::text, 'error', $3::text, 'statusAt', now())
                 WHERE wa_message_id = $1
                   AND COALESCE((CASE meta->>'status' WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 WHEN 'sent' THEN 1 WHEN 'accepted' THEN 1 WHEN 'failed' THEN 4 ELSE 0 END), 0) <= $4`,
                [delivery.id, delivery.status, errorMessage, rank],
              ).catch(() => undefined);
            }
            // Match on the message id ONLY. The old "latest log for that number" fallback let a status
            // for a message we do not log (e.g. a file an agent sent by hand) overwrite the itinerary's row.
            const { rows: updated } = await this.pool.query(
              `UPDATE whatsapp_logs SET status = $1, error_message=$2
               WHERE id = (SELECT id FROM whatsapp_logs WHERE message_id=$3 LIMIT 1)
                 AND COALESCE((CASE status WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 WHEN 'sent' THEN 1 WHEN 'accepted' THEN 1 WHEN 'failed' THEN 4 ELSE 0 END), 0) <= $4
               RETURNING lead_id, package_id, message_type, to_number`,
              [delivery.status, errorMessage, delivery.id || null, rank],
            ).catch((err) => { this.logger.error(`Could not update WhatsApp delivery log: ${err.message}`); return { rows: [] as any[] }; });
            const row = updated[0];
            // Meta's send API returns "accepted" immediately -- we only learn a send actually
            // failed later, right here, via this webhook. This never touches leads.status (that
            // is a human's own pipeline stage, never auto-changed by a WhatsApp outcome) -- it
            // only alerts staff, since the failure lives entirely in the delivery status column.
            if (delivery.status === 'failed' && row?.lead_id && row.message_type === 'itinerary') {
              const { rows: named } = await this.pool.query(`SELECT customer_name, destination FROM leads WHERE id=$1 AND is_deleted=false`, [row.lead_id]);
              if (named[0]) this.alertFailedSend(named[0].customer_name, named[0].destination, errorMessage, row.lead_id);
            }
            if (delivery.status === 'delivered') {
              await this.sendMappedItineraryAfterTemplate(delivery.recipient_id).catch((err) =>
                this.logger.error(`Could not auto-send mapped itinerary: ${err.message}`, err.stack),
              );
            }
          }
        }
        const messages = value.messages ?? [];
        const contactName = value.contacts?.[0]?.profile?.name;
        for (const message of messages) {
          await this.handleIncomingMessage(message, contactName).catch((err) =>
            this.logger.error(`Failed handling inbound WhatsApp message: ${err.message}`, err.stack),
          );
        }
      }
    }
  }

  async sendTestTemplateItinerary(to: string, packageId: string) {
    const digits = String(to).replace(/\D/g, '');
    const normalized = digits.length === 10 ? `91${digits}` : digits;
    const { rows } = await this.pool.query(`SELECT test_numbers FROM whatsapp_automation_settings WHERE id=true`);
    if (!(rows[0]?.test_numbers || []).includes(normalized)) throw new BadRequestException('Number is not in the approved test list');
    const config = await this.getConfig();
    if (!config) throw new BadRequestException('WhatsApp is not configured');
    const { rows: packages } = await this.pool.query(
      `SELECT name,description,itinerary_pdf_object_key,itinerary_pdf_file_name,whatsapp_template_name,whatsapp_template_status,contact_name,contact_number,contact_button_text,buttons,id
         FROM tour_packages WHERE id=$1 AND is_deleted=false`, [packageId],
    );
    const pkg = packages[0];
    if (!pkg?.itinerary_pdf_object_key) throw new BadRequestException('Upload the itinerary before testing');
    if (pkg.whatsapp_template_status !== 'APPROVED' || !pkg.whatsapp_template_name) {
      throw new BadRequestException('Meta template must be approved before testing');
    }
    const link = await this.r2.getPresignedDownloadUrl(pkg.itinerary_pdf_object_key, 600);
    const result = await this.sendDocumentTemplate(config, normalized, pkg.whatsapp_template_name, link, pkg.itinerary_pdf_file_name || `${pkg.name}.pdf`, pkg.description || `Please review the ${pkg.name} itinerary.`, pkg.contact_name || 'Errances Voyages', pkg.contact_number || '9999999999', pkg);
    await this.pool.query(
      `INSERT INTO whatsapp_logs(to_number,template_name,status,sent_at,message_id,package_id,message_type)
       VALUES($1,$2,'accepted',now(),$3,$4,'itinerary')`,
      [normalized, pkg.whatsapp_template_name, result?.messages?.[0]?.id ?? null, packageId],
    );
    await this.recordItineraryMessage({ ...pkg, id: packageId }, normalized, null, null, result?.messages?.[0]?.id ?? null);
    return { success: true };
  }

  async submitItineraryTemplate(packageId: string) {
    const config = await this.getConfig();
    if (!config?.business_account_id) throw new BadRequestException('WhatsApp Business Account ID is missing in Settings');
    const { rows } = await this.pool.query(
      `SELECT id,name,description,itinerary_pdf_object_key,itinerary_pdf_file_name,whatsapp_template_id,whatsapp_template_status,contact_number,contact_button_text,buttons
         FROM tour_packages WHERE id=$1 AND is_deleted=false`, [packageId],
    );
    const pkg = rows[0];
    if (!pkg) throw new BadRequestException('Itinerary not found');
    if (!pkg.itinerary_pdf_object_key) throw new BadRequestException('Upload the itinerary document first');
    pkg.contact_button_text = pkg.contact_button_text ?? null;
    if (pkg.buttons || String(pkg.contact_number || '').trim()) {
      return this.submitButtonTemplate(config, pkg, normalizeIndianMobile(pkg.contact_number));
    }
    const { rows: sharedRows } = await this.pool.query(
      `SELECT itinerary_template_id,itinerary_template_name,itinerary_template_status,itinerary_template_rejection_reason
         FROM whatsapp_automation_settings WHERE id=true`,
    );
    const shared = sharedRows[0];
    if (shared?.itinerary_template_status === 'APPROVED' && shared.itinerary_template_name) {
      const { rows: attached } = await this.pool.query(
        `UPDATE tour_packages SET whatsapp_template_id=$2,whatsapp_template_name=$3,whatsapp_template_status='APPROVED',
         whatsapp_template_rejection_reason=NULL,whatsapp_template_checked_at=now(),updated_at=now() WHERE id=$1 RETURNING *`,
        [packageId,shared.itinerary_template_id,shared.itinerary_template_name],
      );
      return attached[0];
    }
    if (shared?.itinerary_template_id && !['REJECTED','PAUSED','DISABLED'].includes(shared.itinerary_template_status)) {
      return this.syncItineraryTemplateStatus(packageId);
    }
    const templateName = 'campaign_itinerary_delivery_v1';
    const link = await this.r2.getPresignedDownloadUrl(pkg.itinerary_pdf_object_key, 600);
    const fileResponse = await fetch(link);
    if (!fileResponse.ok) throw new BadRequestException('Could not read the itinerary document for Meta submission');
    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    const fileType = fileResponse.headers.get('content-type') || 'application/pdf';
    const appId = await this.resolveMetaAppId(config.access_token);
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const sessionResponse = await fetch(`https://graph.facebook.com/${version}/${appId}/uploads?file_length=${bytes.length}&file_type=${encodeURIComponent(fileType)}&access_token=${encodeURIComponent(config.access_token)}`, { method:'POST' });
    const session: any = await sessionResponse.json();
    if (!sessionResponse.ok || !session.id) throw new BadRequestException(`Meta upload session failed: ${session?.error?.message || sessionResponse.status}`);
    const uploadResponse = await fetch(`https://graph.facebook.com/${version}/${session.id}`, {
      method:'POST', headers:{ Authorization:`OAuth ${config.access_token}`, file_offset:'0', 'Content-Type':fileType }, body:bytes,
    });
    const upload: any = await uploadResponse.json();
    if (!uploadResponse.ok || !upload.h) throw new BadRequestException(`Meta document upload failed: ${upload?.error?.message || uploadResponse.status}`);
    const bodyText = `{{1}}\n\nYour travel consultant: {{2}}\nCall or WhatsApp: {{3}}`;
    const createResponse = await fetch(`https://graph.facebook.com/${version}/${config.business_account_id}/message_templates`, {
      method:'POST', headers:{ Authorization:`Bearer ${config.access_token}`, 'Content-Type':'application/json' },
      body:JSON.stringify({ name:templateName, language:'en_US', category:'MARKETING', components:[
        { type:'HEADER', format:'DOCUMENT', example:{ header_handle:[upload.h] } },
        { type:'BODY', text:bodyText, example:{ body_text:[[`Thank you for your interest. Please review the attached itinerary.`,'Errances Voyages','9999999999']] } },
      ]}),
    });
    const created: any = await createResponse.json();
    if (!createResponse.ok || !created.id) throw new BadRequestException(`Meta template submission failed: ${created?.error?.error_user_msg || created?.error?.message || createResponse.status}`);
    const status = String(created.status || 'PENDING').toUpperCase();
    await this.pool.query(
      `UPDATE whatsapp_automation_settings SET itinerary_template_id=$1,itinerary_template_name=$2,
       itinerary_template_status=$3,itinerary_template_rejection_reason=NULL,itinerary_template_checked_at=now(),updated_at=now()
       WHERE id=true`, [created.id,templateName,status],
    );
    const { rows: updated } = await this.pool.query(
      `UPDATE tour_packages SET whatsapp_template_id=$2,whatsapp_template_name=$3,whatsapp_template_status=$4,
       whatsapp_template_rejection_reason=NULL,whatsapp_template_submitted_at=now(),whatsapp_template_checked_at=now(),updated_at=now()
       WHERE id=$1 RETURNING *`, [packageId,created.id,templateName,status],
    );
    return updated[0];
  }

  // One template per consultant number: header document + message body +
  // "Call our consultant" (tap-to-call) + "Request a call back" buttons.
  // Packages using the same number share the same template, so a number only
  // needs Meta's approval once.
  private async submitButtonTemplate(config: WhatsAppConfig, pkg: any, contactMobile: string | null) {
    const national = contactMobile || '';
    const { meta: metaButtons, signature } = buildMetaButtons(pkg);
    const templateName = `${V2_TEMPLATE_PREFIX}${signature}`;

    const { rows: existing } = await this.pool.query(
      `SELECT whatsapp_template_id, whatsapp_template_status FROM tour_packages
        WHERE whatsapp_template_name=$1 AND whatsapp_template_id IS NOT NULL AND is_deleted=false
        ORDER BY (whatsapp_template_status='APPROVED') DESC, whatsapp_template_checked_at DESC NULLS LAST LIMIT 1`,
      [templateName],
    );
    let templateId: string | undefined = existing[0]?.whatsapp_template_id;
    let status: string = existing[0]?.whatsapp_template_status || 'PENDING';

    if (!templateId) {
      const lookupVersion = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
      const lookup: any = await (await fetch(`https://graph.facebook.com/${lookupVersion}/${config.business_account_id}/message_templates?name=${encodeURIComponent(templateName)}&fields=id,name,status&access_token=${encodeURIComponent(config.access_token)}`)).json().catch(() => null);
      const already = lookup?.data?.find((t: any) => t.name === templateName);
      if (already) { templateId = already.id; status = String(already.status || 'PENDING').toUpperCase(); }
    }

    if (!templateId) {
      const link = await this.r2.getPresignedDownloadUrl(pkg.itinerary_pdf_object_key, 600);
      const fileResponse = await fetch(link);
      if (!fileResponse.ok) throw new BadRequestException('Could not read the itinerary document for Meta submission');
      const bytes = Buffer.from(await fileResponse.arrayBuffer());
      const fileType = fileResponse.headers.get('content-type') || 'application/pdf';
      const appId = await this.resolveMetaAppId(config.access_token);
      const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
      const sessionResponse = await fetch(`https://graph.facebook.com/${version}/${appId}/uploads?file_length=${bytes.length}&file_type=${encodeURIComponent(fileType)}&access_token=${encodeURIComponent(config.access_token)}`, { method:'POST' });
      const session: any = await sessionResponse.json();
      if (!sessionResponse.ok || !session.id) throw new BadRequestException(`Meta upload session failed: ${session?.error?.message || sessionResponse.status}`);
      const uploadResponse = await fetch(`https://graph.facebook.com/${version}/${session.id}`, {
        method:'POST', headers:{ Authorization:`OAuth ${config.access_token}`, file_offset:'0', 'Content-Type':fileType }, body:bytes,
      });
      const upload: any = await uploadResponse.json();
      if (!uploadResponse.ok || !upload.h) throw new BadRequestException(`Meta document upload failed: ${upload?.error?.message || uploadResponse.status}`);
      const createResponse = await fetch(`https://graph.facebook.com/${version}/${config.business_account_id}/message_templates`, {
        method:'POST', headers:{ Authorization:`Bearer ${config.access_token}`, 'Content-Type':'application/json' },
        body:JSON.stringify({ name:templateName, language:'en_US', category:'MARKETING', components:[
          { type:'HEADER', format:'DOCUMENT', example:{ header_handle:[upload.h] } },
          { type:'BODY', text:`Dear {{1}},\n\n{{2}}\n\n{{3}}\n\nYour expert: *{{4}}* — tap a button below to get in touch.`, example:{ body_text:[['Mr. Ramesh','Dreaming of a holiday but worried about planning and cost?','We have a ready itinerary with handpicked stays and sightseeing, all within your budget.',`Errances Voyages · ${national || '9443146955'}`]] } },
          { type:'BUTTONS', buttons: metaButtons },
        ]}),
      });
      const created: any = await createResponse.json();
      if (!createResponse.ok || !created.id) throw new BadRequestException(`Meta template submission failed: ${created?.error?.error_user_msg || created?.error?.error_user_msg || created?.error?.message || createResponse.status}`);
      templateId = created.id as string;
      status = String(created.status || 'PENDING').toUpperCase();
    }

    const { rows: updated } = await this.pool.query(
      `UPDATE tour_packages SET whatsapp_template_id=$2,whatsapp_template_name=$3,whatsapp_template_status=$4,
       whatsapp_template_rejection_reason=NULL,whatsapp_template_submitted_at=COALESCE(whatsapp_template_submitted_at,now()),
       whatsapp_template_checked_at=now(),updated_at=now() WHERE id=$1 RETURNING *`,
      [pkg.id, templateId, templateName, status],
    );
    return updated[0];
  }

  // Refreshes the approval status of a per-number (v2) template and applies it
  // to every itinerary sharing that number. Returns null when the package is
  // on the legacy shared template.
  private async syncButtonTemplateStatus(config: WhatsAppConfig, packageId: string) {
    const { rows } = await this.pool.query(
      `SELECT whatsapp_template_id, whatsapp_template_name FROM tour_packages WHERE id=$1 AND is_deleted=false`,
      [packageId],
    );
    const current = rows[0];
    if (!current?.whatsapp_template_id || !String(current.whatsapp_template_name || '').startsWith('campaign_itinerary_v')) return null;
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const response = await fetch(`https://graph.facebook.com/${version}/${current.whatsapp_template_id}?fields=id,name,status,category,language,quality_score,rejected_reason,last_updated_time&access_token=${encodeURIComponent(config.access_token)}`);
    const data: any = await response.json();
    if (!response.ok) throw new BadRequestException(`Could not read Meta template status: ${data?.error?.message || response.status}`);
    const status = String(data.status || 'PENDING').toUpperCase();
    await this.pool.query(
      `UPDATE tour_packages SET whatsapp_template_status=$2,whatsapp_template_rejection_reason=$3,whatsapp_template_checked_at=now(),updated_at=now()
        WHERE whatsapp_template_name=$1 AND is_deleted=false`,
      [current.whatsapp_template_name, status, data.rejected_reason || null],
    );
    const { rows: updated } = await this.pool.query(`SELECT * FROM tour_packages WHERE id=$1`, [packageId]);
    return {
      ...updated[0],
      meta_details: {
        name: data.name || current.whatsapp_template_name,
        category: data.category || null,
        language: data.language || null,
        quality: data.quality_score?.score || null,
        rejected_reason: data.rejected_reason && data.rejected_reason !== 'NONE' ? data.rejected_reason : null,
        last_updated: data.last_updated_time || null,
      },
    };
  }

  async syncItineraryTemplateStatus(packageId: string) {
    const config = await this.getConfig();
    if (!config) throw new BadRequestException('WhatsApp is not configured');
    const buttonTemplate = await this.syncButtonTemplateStatus(config, packageId);
    if (buttonTemplate) return buttonTemplate;
    const { rows } = await this.pool.query(`SELECT itinerary_template_id FROM whatsapp_automation_settings WHERE id=true`);
    const templateId = rows[0]?.itinerary_template_id;
    if (!templateId) throw new BadRequestException('Template has not been submitted to Meta');
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const response = await fetch(`https://graph.facebook.com/${version}/${templateId}?fields=id,name,status,rejected_reason&access_token=${encodeURIComponent(config.access_token)}`);
    const data: any = await response.json();
    if (!response.ok) throw new BadRequestException(`Could not read Meta template status: ${data?.error?.message || response.status}`);
    const status = String(data.status || 'PENDING').toUpperCase();
    await this.pool.query(
      `UPDATE whatsapp_automation_settings SET itinerary_template_status=$1,itinerary_template_rejection_reason=$2,
       itinerary_template_checked_at=now(),updated_at=now() WHERE id=true`, [status,data.rejected_reason || null],
    );
    const { rows: updated } = await this.pool.query(
      `UPDATE tour_packages SET whatsapp_template_id=$2,whatsapp_template_name=$3,whatsapp_template_status=$4,
       whatsapp_template_rejection_reason=$5,whatsapp_template_checked_at=now(),updated_at=now() WHERE id=$1 RETURNING *`,
      [packageId,templateId,data.name,status,data.rejected_reason || null],
    );
    return updated[0];
  }

  async sendLeadWelcomeTemplate(to: string, customerName: string, destination: string, leadId?: string) {
    const config = await this.getConfig();
    if (!config) throw new BadRequestException('WhatsApp is not configured');
    const digits = String(to).replace(/\D/g, '');
    const indian = normalizeIndianMobile(to);
    const normalized = indian ? `91${indian}` : digits;
    const result = await this.callWhatsAppApi(config, {
      to: normalized,
      type: 'template',
      template: {
        name: 'travel_enquiry_welcome',
        language: { code: 'en_US' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: customerName.slice(0, 60) },
            { type: 'text', text: destination.slice(0, 60) },
          ],
        }],
      },
    });
    await this.pool.query(
      `INSERT INTO whatsapp_logs (to_number, template_name, status, sent_at, message_id, lead_id, message_type)
       VALUES ($1, 'travel_enquiry_welcome', 'accepted', now(), $2, $3, 'template')`,
      [normalized, result?.messages?.[0]?.id ?? null, leadId ?? null],
    );
    // Store the real rendered text (Meta's approved wording, exact from WhatsApp
    // Manager) so the CRM inbox shows what the customer actually received,
    // instead of just the template's internal name.
    const welcomeText = `Hello ${customerName.slice(0, 60)},\n\nThank you for choosing Errances Voyages. We have received your enquiry for ${destination.slice(0, 60)}.\n\nOur travel consultant will contact you shortly. Reply YES to receive the itinerary and package details for your preferred destination.\n\nFor immediate assistance, contact +91 94431 46955.`;
    await this.storeMessage(normalized, leadId ?? null, 'out', welcomeText, 'text', result?.messages?.[0]?.id ?? undefined).catch(() => undefined);
    // The lead's pipeline stage is a human-driven judgment call (New/Contacted/Qualified/...),
    // not something an automatic WhatsApp send should move on its own -- that delivery state
    // already lives in the Auto WhatsApp column (sent/delivered/read/failed), so it's never
    // duplicated into lead.status here.
    await this.upsertConversation(normalized, 'awaiting_itinerary_consent', { leadId }, customerName, leadId);
    // The whole point of the welcome is the itinerary that follows it. It used to
    // wait for WhatsApp to confirm the welcome was DELIVERED -- if that never came
    // (dead number, missed webhook) the itinerary was never attempted, failed
    // nowhere, and appeared on no list. Send it right after the welcome instead;
    // the duplicate-proof claim makes the old delivered-trigger a harmless backup.
    if (leadId) {
      setTimeout(() => {
        this.sendItineraryForLead(config, normalized, leadId).catch((err) => this.logger.error(`Itinerary after welcome failed for lead ${leadId}: ${err.message}`));
      }, 4000);
    }
    return result;
  }

  // A customer's photo / PDF / voice note used to show as a bare "[image]" line.
  // Meta only hands over a media id, so download it (needs our token), keep a
  // copy in our own storage, and record where -- so the Inbox can show exactly
  // what the customer sent, like WhatsApp does.
  private async fetchInboundMedia(message: any): Promise<{ kind: 'image' | 'document' | 'audio' | 'video'; url: string; filename: string; mimeType: string; caption?: string } | null> {
    const type = message?.type as string;
    if (!['image', 'document', 'audio', 'video', 'sticker'].includes(type)) return null;
    const media = message[type];
    if (!media?.id) return null;
    const config = await this.getConfig();
    if (!config || !this.r2.isConfigured()) return null;
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const auth = { Authorization: `Bearer ${config.access_token}` };
    const info: any = await (await fetch(`https://graph.facebook.com/${version}/${media.id}`, { headers: auth })).json();
    if (!info?.url) return null;
    const file = await fetch(info.url, { headers: auth });
    if (!file.ok) return null;
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = String(media.mime_type || info.mime_type || 'application/octet-stream');
    const ext = mimeType.split('/')[1]?.split(';')[0] || 'bin';
    const filename = String(media.filename || `${type}.${ext}`);
    const { url } = await this.r2.uploadBuffer(buffer, 'whatsapp-inbound', filename, mimeType);
    const kind = type === 'sticker' ? 'image' : (type as 'image' | 'document' | 'audio' | 'video');
    return { kind, url, filename, mimeType, caption: media.caption };
  }

  private async handleIncomingMessage(message: any, contactName?: string) {
    const from = message.from as string;
    if (!from) return;

    const leadId = await this.upsertLeadFromMessage(message, from, contactName).catch((err) => {
      this.logger.error(`Failed to upsert CRM lead for WhatsApp contact ${from}: ${err.message}`, err.stack);
      return undefined;
    });

    const inboundText = String(message?.text?.body || message?.button?.text || message?.interactive?.button_reply?.title || message?.interactive?.list_reply?.title || `[${message?.type || 'message'}]`);
    const media = await this.fetchInboundMedia(message).catch((err) => { this.logger.warn(`Inbound media not stored: ${err.message}`); return null; });
    if (media) {
      await this.storeMessage(from, leadId ?? null, 'in', media.caption || media.filename || inboundText, media.kind, message?.id, undefined, { url: media.url, filename: media.filename, mimeType: media.mimeType }).catch(() => undefined);
    } else {
      await this.storeMessage(from, leadId ?? null, 'in', inboundText, message?.type || 'text', message?.id).catch(() => undefined);
    }
    this.notifyInbound(from, leadId, contactName, inboundText).catch(() => undefined);

    const config = await this.getConfig();
    if (!config) {
      this.logger.error('WhatsApp is not configured (Settings > WhatsApp) — cannot reply.');
      return;
    }

    const listReplyId: string | undefined = message?.interactive?.list_reply?.id;

    if (listReplyId) {
      await this.sendItinerary(config, from, listReplyId, leadId);
      await this.upsertConversation(from, 'completed', { lastPackageId: listReplyId }, contactName, leadId);
      return;
    }

    const buttonPayload = message?.button?.payload || message?.interactive?.button_reply?.id;
    const buttonLabel = String(message?.button?.text || message?.interactive?.button_reply?.title || '').toLowerCase();
    if (String(buttonPayload || '').startsWith(CALLBACK_PAYLOAD) || buttonLabel.includes('call back') || buttonLabel.includes('chat with')) {
      let customReply: string | undefined;
      const [, pkgId, position] = String(buttonPayload || '').split('|');
      if (pkgId && position !== undefined) {
        const { rows: pk } = await this.pool.query(`SELECT buttons, contact_number, contact_button_text FROM tour_packages WHERE id=$1`, [pkgId]).catch(() => ({ rows: [] as any[] }));
        const tapped = pk[0] ? buildMetaButtons(pk[0]).ordered[Number(position)] : undefined;
        if (tapped?.type === 'chat') {
          const chatMobile = normalizeIndianMobile(tapped.phone || buildMetaButtons(pk[0]).ordered.find((c) => c.type === 'call')?.phone || pk[0].contact_number);
          const intro = tapped.reply?.trim() || 'Thanks for reaching out to Errances Voyages! 🙏 Tap the link to chat with our travel expert on WhatsApp:';
          if (chatMobile) customReply = `${intro}\nhttps://wa.me/91${chatMobile}`;
        }
      }
      await this.handleCallbackRequest(config, from, contactName, leadId, customReply);
      return;
    }

    const quickReplyText = message?.button?.text || message?.interactive?.button_reply?.title;
    const plainText = message?.text?.body;
    const replyText = String(quickReplyText || plainText || '').trim().toLowerCase();
    // Free-text call requests ("call me", "call back", "phone me") were only
    // ever caught when the customer tapped the button -- typed ones got the
    // generic consultant reply and vanished. Same handling as the button now:
    // push + a persistent pending row on the Callback Requests list.
    if (/\b(call\s*(me|back)|callback|phone\s*me|ring\s*me|contact\s*me|talk\s*to)\b/.test(replyText)) {
      await this.handleCallbackRequest(config, from, contactName, leadId);
      return;
    }
    if (leadId && (replyText === 'yes' || replyText.includes('send itinerary'))) {
      const { rows: before } = await this.pool.query(
        `SELECT 1 FROM whatsapp_logs WHERE lead_id=$1 AND message_type='itinerary' AND is_deleted=false AND status IN ('accepted','sent','delivered','read') LIMIT 1`,
        [leadId],
      );
      const matched = await this.sendItineraryForLead(config, from, leadId);
      if (matched) {
        await this.upsertConversation(from, 'completed', { itinerarySentFromLead: true }, contactName, leadId);
        // They already have it -- the duplicate-proof gate correctly sent nothing,
        // but silence looks like we ignored them. Say so, and flag it for a human,
        // since someone asking again usually means they didn't see/open it.
        if (before.length) {
          await this.handleCallbackRequest(config, from, contactName, leadId, 'Your itinerary is already in this chat, just above 👆 Our travel expert will message you shortly to help further. 🙏');
        }
        return;
      }
    }

    // A customer is writing to us and still has NOT received their itinerary: that
    // is the moment to send it (they just gave us a working WhatsApp number, and
    // inside their 24h window it goes as a plain document, free of template limits).
    if (leadId) {
      const { rows: got } = await this.pool.query(
        `SELECT 1 FROM whatsapp_logs WHERE lead_id=$1 AND message_type='itinerary' AND is_deleted=false AND status IN ('accepted','sent','delivered','read') LIMIT 1`,
        [leadId],
      );
      if (!got.length) {
        const sentNow = await this.sendItineraryForLead(config, from, leadId).catch(() => false);
        if (sentNow) { await this.upsertConversation(from, 'completed', { itinerarySentOnInbound: true }, contactName, leadId); return; }
      }
    }

    // First-ever message from this contact, arriving via a Meta ad click --
    // try to auto-match the ad's campaign to a tagged package and send its
    // itinerary immediately, skipping the generic menu. Falls back to the
    // menu on any failure (no campaign tag set, API error, etc).
    const referral: WhatsAppReferral | undefined = message?.referral;
    const isFirstContact = !(await this.getConversationState(from));
    if (isFirstContact && referral?.source_id) {
      const matched = await this.tryAutoSendItinerary(config, from, referral, contactName, leadId);
      if (matched) return;
    }

    // Any other message: point the customer to a consultant (name + number) instead of a package menu.
    await this.sendConsultantReply(config, from, leadId);
    await this.upsertConversation(from, 'consultant_assist', null, contactName, leadId);
  }

  // Who the customer should contact: the lead's assigned employee, else the number on the
  // latest active itinerary, else the business number.
  private async getConsultantContact(leadId?: string): Promise<{ name: string; number: string | null }> {
    if (leadId) {
      const { rows } = await this.pool.query(`SELECT u.full_name, u.phone FROM leads l JOIN users u ON u.id = l.assigned_to WHERE l.id = $1`, [leadId]).catch(() => ({ rows: [] as any[] }));
      const number = normalizeIndianMobile(rows[0]?.phone);
      if (number) return { name: rows[0].full_name, number };
    }
    const { rows: pkgs } = await this.pool.query(
      `SELECT contact_name, contact_number FROM tour_packages WHERE is_active = true AND is_deleted = false AND COALESCE(contact_number,'') <> '' ORDER BY updated_at DESC LIMIT 1`,
    ).catch(() => ({ rows: [] as any[] }));
    const pkgNumber = normalizeIndianMobile(pkgs[0]?.contact_number);
    if (pkgNumber) return { name: pkgs[0].contact_name || '', number: pkgNumber };
    const profile = await this.getBusinessProfile().catch(() => null);
    return { name: '', number: normalizeIndianMobile(profile?.phone) };
  }

  // Automatic reply to any customer message: contact our consultant (with the number).
  private async sendConsultantReply(config: WhatsAppConfig, from: string, leadId?: string) {
    // Once a real agent has replied on this chat, stop the automatic reply entirely --
    // the conversation is being handled by a person now, not the bot.
    const { rows: humanTakeover } = await this.pool.query(
      `SELECT 1 FROM whatsapp_messages WHERE phone_number = $1 AND direction = 'out' AND sent_by IS NOT NULL LIMIT 1`,
      [from],
    );
    if (humanTakeover.length) return;
    const { rows: recent } = await this.pool.query(
      `SELECT 1 FROM whatsapp_messages WHERE phone_number = $1 AND direction = 'out' AND body LIKE 'Thank you for contacting%' AND created_at > now() - interval '10 minutes' LIMIT 1`,
      [from],
    );
    if (recent.length) return;
    const contact = await this.getConsultantContact(leadId);
    const lines = ['Thank you for contacting Errances Voyages! 🙏', '', 'Please contact our travel consultant — they will assist you with your tour.'];
    if (contact.number) lines.push('', `📞 ${contact.name ? contact.name + ' · ' : ''}${contact.number}`, `Call or chat: https://wa.me/91${contact.number}`);
    const text = lines.join('\n');
    // Keep Meta's own message id, or this bubble can never show a real tick -- the delivery
    // webhook has nothing to match it against, and it would sit on a fake single tick forever
    // even after the customer reads it.
    await this.sendText(config, from, text)
      .then((result: any) => this.storeMessage(from, leadId ?? null, 'out', text, 'text', result?.messages?.[0]?.id))
      .catch((err) => this.logger.error(`Consultant reply failed for ${from}: ${err.message}`));
  }

  // The customer tapped "Request a call back" on the itinerary message: move
  // the lead to follow-up, alert the CRM team (popup + push), and acknowledge.
  private async handleCallbackRequest(config: WhatsAppConfig, from: string, contactName: string | undefined, leadId: string | undefined, customReply?: string) {
    let lead: any = null;
    if (leadId) {
      const { rows } = await this.pool.query(
        `SELECT id, customer_name, phone, whatsapp_number, assigned_to FROM leads WHERE id=$1 AND is_deleted=false`,
        [leadId],
      );
      lead = rows[0];
      // Only nudges a lead that nobody has touched yet -- once staff have set a status by hand
      // (Contacted or anything else), an automatic event never overwrites their own work.
      await this.pool.query(
        `UPDATE leads SET status='follow_up', updated_at=now()
          WHERE id=$1 AND status = 'new' AND is_deleted=false`,
        [leadId],
      );
    }
    const customerName = lead?.customer_name || contactName || from;
    const phone = lead?.phone || lead?.whatsapp_number || from;
    this.realtime.broadcastCallbackRequest({
      id: leadId ?? null,
      customer_name: customerName,
      phone,
      assigned_to: lead?.assigned_to ?? null,
    });
    // The popup alone isn't enough -- if nobody's looking at the screen right
    // then, a callback request must not just vanish. This is the persistent
    // record: stays pending on the Callback Requests list until someone
    // actually makes the call and marks it done.
    await this.pool.query(
      `INSERT INTO callback_requests(lead_id, customer_name, phone) VALUES($1,$2,$3)`,
      [leadId ?? null, customerName, phone],
    );
    this.push.notifyAll({
      title: `Callback requested — ${customerName}`,
      body: `Tapped "Call our experts" on the itinerary — call ${phone}`,
      url: '/followups',
    }).catch((err) => this.logger.error(`Callback request push failed: ${err.message}`));
    const reply = customReply || 'Thank you! Our travel expert will message you here shortly. You can type your questions in this chat anytime. 🙏';
    await this.sendText(config, from, reply)
      .then((result: any) => this.storeMessage(from, leadId ?? null, 'out', reply, 'text', result?.messages?.[0]?.id))
      .catch(() => undefined);
    await this.upsertConversation(from, 'callback_requested', { requestedAt: new Date().toISOString() }, contactName, leadId);
  }

  private async getConversationState(phoneNumber: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      `SELECT state FROM whatsapp_conversations WHERE phone_number = $1`,
      [phoneNumber],
    );
    return rows[0]?.state ?? null;
  }

  // Resolves the ad's real campaign name via the Marketing API, matches it
  // against a tagged package, and sends that package's itinerary directly.
  // Returns true if it handled the message (caller should skip the menu).
  private async tryAutoSendItinerary(
    config: WhatsAppConfig,
    to: string,
    referral: WhatsAppReferral,
    contactName: string | undefined,
    leadId: string | undefined,
  ): Promise<boolean> {
    try {
      const campaignName = await this.fetchAdCampaignName(referral.source_id!);
      if (!campaignName) return false;

      let pkg = await this.packagesService.findByCampaignName(campaignName);
      if (!pkg) {
        const destination = this.extractDestinationFromCampaign(campaignName);
        if (destination) pkg = await this.packagesService.findByDestination(destination);
      }
      if (!pkg) return false;

      if (!pkg.itinerary_pdf_object_key) {
        // No document to attach yet -- fall back to a single text reply rather than sending
        // nothing. Must still be logged into the Inbox and keep Meta's message id, exactly like
        // every other send -- otherwise this text exists on the customer's phone but nowhere in
        // the CRM at all.
        const fallbackText = pkg.description ||
          `Hi! 👋 Thanks for your interest in *${pkg.name}*. Our team will share the itinerary and follow up shortly to help you plan your trip.`;
        const result: any = await this.sendText(config, to, fallbackText);
        await this.storeMessage(to, leadId ?? null, 'out', fallbackText, 'text', result?.messages?.[0]?.id).catch(() => undefined);
        await this.upsertConversation(to, 'completed', { lastPackageId: pkg.id, matchedByCampaign: campaignName }, contactName, leadId);
        return true;
      }

      // Everything -- the thank-you copy, the itinerary, and the consultant's
      // contact -- goes out as ONE WhatsApp message (a document with a rich
      // caption), not three separate pings on the customer's phone.
      const consultant = leadId ? await this.getConsultantForLead(leadId) : { full_name: 'Errances Voyages', phone: '9999999999' };
      if ((pkg as any).contact_name) consultant.full_name = (pkg as any).contact_name;
      if ((pkg as any).contact_number) consultant.phone = (pkg as any).contact_number;
      const caption = this.buildItineraryCaption(pkg, consultant);
      // Same single gate -- this referral-triggered path had no duplicate guard
      // at all before; a customer clicking the same ad twice, or this webhook
      // firing twice for one event (Meta does retry webhooks), could not have
      // been stopped previously.
      await this.dispatchItinerary({
        to, leadId: leadId ?? null, packageId: pkg.id, templateName: null, customerName: contactName ?? null, destination: null, trigger: 'chat',
        send: async () => {
          const link = await this.r2.getPresignedDownloadUrl(pkg.itinerary_pdf_object_key, 600);
          return this.sendDocument(config, to, link, pkg.itinerary_pdf_file_name || `${pkg.name}.pdf`, caption);
        },
        afterSend: async (result) => {
          await this.recordItineraryMessage(pkg, to, leadId ?? null, contactName, result?.messages?.[0]?.id ?? null, { name: consultant.full_name, phone: consultant.phone });
        },
      });

      await this.upsertConversation(to, 'completed', { lastPackageId: pkg.id, matchedByCampaign: campaignName }, contactName, leadId);
      this.logger.log(`Auto-sent itinerary (single message) for package "${pkg.name}" matched from campaign "${campaignName}"`);

      // Sending the itinerary never touches the lead's own pipeline Status -- that is staff's
      // own work (Contacted, Follow-up, ...) and must never be silently overwritten by automation.
      if (leadId && pkg.campaign_name) await this.leadsService.update(leadId, { campaignName: pkg.campaign_name }).catch(() => undefined);
      return true;
    } catch (err: any) {
      this.logger.error(`Auto-itinerary matching failed: ${err.message}`, err.stack);
      return false;
    }
  }

  private async fetchAdCampaignName(adId: string): Promise<string | undefined> {
    const accessToken = this.config.get<string>('META_PAGE_ACCESS_TOKEN');
    if (!accessToken) return undefined;
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const url = `https://graph.facebook.com/${version}/${adId}?fields=campaign{name}&access_token=${accessToken}`;
    const res = await fetch(url);
    if (!res.ok) {
      this.logger.error(`Failed to fetch ad campaign name for ${adId}: ${res.status} ${await res.text()}`);
      return undefined;
    }
    const data = (await res.json()) as { campaign?: { name?: string } };
    return data.campaign?.name;
  }

  private extractDestinationFromCampaign(campaignName: string): string | undefined {
    const cleaned = campaignName.replace(/^(SMM|SocialMM|TRT)\s*[-–|]?\s*/i, '').trim();
    const destination = cleaned.split(/[-–|]/)[0]?.trim();
    return destination || undefined;
  }

  // Upserts a CRM lead for this WhatsApp contact -- dedup by whatsapp_number.
  // Runs on every inbound message regardless of the bot's own conversation
  // state, so a lead exists as soon as the customer says anything, not only
  // once they pick a package.
  private async upsertLeadFromMessage(message: any, from: string, contactName?: string): Promise<string | undefined> {
    const referral: WhatsAppReferral | undefined = message?.referral;
    // findByWhatsAppNumber alone missed leads created via the Instant-Form ad path,
    // which often only ever populate `phone`, not `whatsapp_number` -- that exact-match
    // lookup would miss them and create a second, duplicate lead for the same person,
    // firing a fresh unprompted welcome+itinerary at whatever hour they replied.
    // findByContactNumber matches phone / whatsapp_number / whatsapp_contact_id, normalized.
    const existing = (await this.leadsService.findByWhatsAppNumber(from)) || (await this.leadsService.findByContactNumber(from));
    if (existing) {
      // Don't clobber staff-progressed status/priority on repeat messages --
      // only backfill attribution the first time it becomes available.
      const patch: Record<string, any> = {};
      if (referral && !existing.ad_name) { patch.adName = referral.headline; patch.metaAttribution = referral as Record<string, any>; }
      if (!existing.whatsapp_number) patch.whatsappNumber = from;
      if (!existing.whatsapp_contact_id) patch.whatsappContactId = from;
      if (Object.keys(patch).length) await this.leadsService.update(existing.id, patch);
      return existing.id;
    }

    const branchId = await this.getDefaultBranchId();
    if (!branchId) {
      this.logger.error('No active branch found — cannot create lead from WhatsApp webhook');
      return undefined;
    }

    const now = new Date();
    const dto: CreateLeadDto = {
      customerName: contactName || from,
      phone: from,
      whatsappNumber: from,
      whatsappContactId: from,
      source: 'meta_ads',
      status: 'new',
      whatsappStatus: 'new',
      destination: this.config.get<string>('WHATSAPP_DEFAULT_TOUR_PLACE') || 'Vietnam',
      adName: referral?.headline,
      leadMonth: now.getMonth() + 1,
      leadYear: now.getFullYear(),
      metaAttribution: referral as Record<string, any> | undefined,
      branchId,
    };
    const lead = await this.leadsService.create(dto, null);
    this.realtime.broadcastNewLead(lead);
    this.logger.log(`Created lead ${lead.id} from WhatsApp contact ${from}`);
    return lead.id;
  }

  private async getDefaultBranchId(): Promise<string | null> {
    const configured = this.config.get<string>('WHATSAPP_DEFAULT_BRANCH_ID') || this.config.get<string>('META_DEFAULT_BRANCH_ID');
    if (configured) return configured;
    const { rows } = await this.pool.query(
      `SELECT id FROM branches WHERE is_active = true ORDER BY created_at ASC LIMIT 1`,
    );
    return rows[0]?.id ?? null;
  }

  private async sendGreetingAndMenu(config: WhatsAppConfig, to: string) {
    const { rows: packages } = await this.pool.query(
      `SELECT id, name, destinations FROM tour_packages
       WHERE is_deleted = false AND is_active = true AND is_template = false
       ORDER BY created_at DESC LIMIT 10`,
    );

    if (packages.length === 0) {
      const fallback = GREETING + "\n\n(Our package list is being updated — please check back shortly.)";
      const result: any = await this.sendText(config, to, fallback);
      await this.storeMessage(to, null, 'out', fallback, 'text', result?.messages?.[0]?.id).catch(() => undefined);
      return;
    }

    const listResult: any = await this.sendInteractiveList(
      config,
      to,
      GREETING,
      'View Packages',
      packages.map((p: any) => ({
        id: p.id,
        title: String(p.name).slice(0, 24),
        description: (Array.isArray(p.destinations) ? p.destinations.join(', ') : '').slice(0, 72),
      })),
    );
    await this.storeMessage(to, null, 'out', GREETING + '\n\n[Package list: ' + packages.map((p: any) => p.name).join(', ') + ']', 'interactive', listResult?.messages?.[0]?.id).catch(() => undefined);
  }

  private async sendItinerary(config: WhatsAppConfig, to: string, packageId: string, leadId?: string) {
    const { rows } = await this.pool.query(
      `SELECT name, itinerary_pdf_object_key, itinerary_pdf_file_name FROM tour_packages WHERE id = $1 AND is_deleted = false`,
      [packageId],
    );
    const pkg = rows[0];

    if (!pkg || !pkg.itinerary_pdf_object_key) {
      const text = "Thanks for your interest! Our itinerary PDF for that package isn't uploaded yet — our team will share it with you shortly. 🙏";
      const result: any = await this.sendText(config, to, text);
      await this.storeMessage(to, leadId ?? null, 'out', text, 'text', result?.messages?.[0]?.id).catch(() => undefined);
      return;
    }

    // Same gate as every other trigger -- a customer picking this destination from
    // the chat menu must not get a second copy if they (or an automatic path)
    // already received this exact package's itinerary.
    await this.dispatchItinerary({
      to, leadId: leadId ?? null, packageId, templateName: null, customerName: null, destination: null, trigger: 'chat',
      send: async () => {
        const link = await this.r2.getPresignedDownloadUrl(pkg.itinerary_pdf_object_key, 600);
        return this.sendDocument(config, to, link, pkg.itinerary_pdf_file_name || `${pkg.name}.pdf`, pkg.name);
      },
      afterSend: async (result) => {
        await this.recordItineraryMessage(pkg, to, leadId ?? null, null, result?.messages?.[0]?.id ?? null);
      },
    });
  }

  private async sendItineraryForLead(config: WhatsAppConfig, to: string, leadId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT destination, campaign_name, customer_name FROM leads WHERE id = $1 AND is_deleted = false`,
      [leadId],
    );
    const lead = rows[0];
    if (!lead) return false;
    // A destination can have more than one itinerary variant tagged to it (e.g.
    // "5 Days 4 Nights" and "2 Days 1 Night" as two separate uploaded documents,
    // each its own Meta-approved template -- Meta only allows one document per
    // template, so multiple documents genuinely means multiple packages here).
    // Send every ready match, not just the first one found.
    let candidates = lead.campaign_name ? await this.packagesService.findManyByCampaignName(lead.campaign_name) : [];
    if (!candidates.length && lead.destination) candidates = await this.packagesService.findManyByDestination(lead.destination);
    if (!candidates.length) {
      this.logger.warn(`No active itinerary mapping found for lead ${leadId}; automatic document was not sent`);
      return false;
    }
    const ready = candidates.filter((pkg: any) => pkg.whatsapp_template_status === 'APPROVED' && pkg.whatsapp_template_name && pkg.itinerary_pdf_object_key);
    if (!ready.length) {
      this.logger.warn(`Approved document template is not ready for any candidate package matching lead ${leadId}`);
      return false;
    }
    const { rows: consultants } = await this.pool.query(
      `SELECT COALESCE(u.full_name,'Errances Voyages') AS full_name, COALESCE(u.phone,'9999999999') AS phone
         FROM leads l LEFT JOIN users u ON u.id=l.assigned_to WHERE l.id=$1 LIMIT 1`, [leadId],
    );
    let anySent = false;
    let anyAlready = false;
    for (const pkg of ready) {
      const consultant = { ...(consultants[0] || { full_name:'Errances Voyages', phone:'9999999999' }) };
      if (pkg.contact_name) consultant.full_name = pkg.contact_name;
      if (pkg.contact_number) consultant.phone = pkg.contact_number;
      // This is the main automatic path (fires right after the welcome message is
      // confirmed delivered). Everything past this point -- the duplicate-proof
      // claim, the actual send, recording the result, alerting on failure -- goes
      // through the one shared dispatcher so this path can never drift out of sync
      // with backlog/resend/chat again.
      // Customer wrote to us in the last day -> WhatsApp allows a normal chat
      // document, which is not a marketing template and so is not subject to the
      // "healthy ecosystem engagement" block.
      const plain = await this.inServiceWindow(to);
      const outcome = await this.dispatchItinerary({
        to, leadId, packageId: pkg.id, templateName: plain ? null : pkg.whatsapp_template_name, customerName: lead.customer_name,
        destination: lead.destination, trigger: 'auto',
        send: async () => {
          const link = await this.r2.getPresignedDownloadUrl(pkg.itinerary_pdf_object_key, 600);
          const fileName = pkg.itinerary_pdf_file_name || `${pkg.name}.pdf`;
          if (plain) return this.sendDocument(config, to, link, fileName, this.buildItineraryCaption(pkg, consultant));
          return this.sendDocumentTemplate(config, to, pkg.whatsapp_template_name, link, fileName, pkg.description || `Please review the ${pkg.name} itinerary.`, consultant.full_name, consultant.phone, pkg, lead.customer_name);
        },
        afterSend: async (result) => {
          await this.recordItineraryMessage(pkg, to, leadId, lead.customer_name, result?.messages?.[0]?.id ?? null, { name: consultant.full_name, phone: consultant.phone }, { plain });
        },
      });
      if (outcome.sent) anySent = true;
      if (outcome.reason === 'already_sent') anyAlready = true;
      // A short gap between multiple documents to the same person, same as every
      // other multi-send loop in this file -- not a burst of several messages
      // landing on their phone in the same second.
      if (ready.length > 1) await new Promise((resolve) => setTimeout(resolve, 30000));
    }
    // 'already_sent' means another trigger already has (or is handling) this --
    // not a failure from this call's point of view.
    return anySent || anyAlready;
  }

  // ---- catch-up: which enquiries of this itinerary's campaign already got it ----
  private async leadsForPackage(pkg: any) {
    const destinations = (Array.isArray(pkg.destinations) ? pkg.destinations : []).filter(Boolean).map((d: string) => `%${d}%`);
    const { rows } = await this.pool.query(
      `SELECT l.id, l.customer_name, l.destination, l.campaign_name, l.status, l.assigned_to,
              COALESCE(NULLIF(l.whatsapp_number,''), NULLIF(l.phone,'')) AS phone, l.created_at,
              (SELECT max(w.created_at) FROM whatsapp_logs w
                WHERE w.lead_id = l.id AND w.package_id = $1 AND w.message_type = 'itinerary'
                  AND w.status IN ('accepted','sent','delivered','read')) AS sent_at
         FROM leads l
        WHERE l.is_deleted = false
          AND ( ($2 <> '' AND l.campaign_name = $2)
             OR (cardinality($3::text[]) > 0 AND l.destination ILIKE ANY($3::text[])
                 AND NOT EXISTS (SELECT 1 FROM tour_packages o WHERE o.id <> $1 AND o.is_deleted = false AND o.is_active = true AND COALESCE(o.campaign_name,'') <> '' AND o.campaign_name = l.campaign_name)) )
        ORDER BY l.created_at DESC LIMIT 1000`,
      [pkg.id, pkg.campaign_name || '', destinations],
    );
    return rows;
  }

  private toWaNumber(phone: string | null): string | null {
    const mobile = normalizeIndianMobile(phone || '');
    return mobile ? `91${mobile}` : null;
  }

  async itineraryDeliveryStatus(packageId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM tour_packages WHERE id = $1 AND is_deleted = false`, [packageId]);
    const pkg = rows[0];
    if (!pkg) throw new BadRequestException('Itinerary not found');
    const leads = await this.leadsForPackage(pkg);
    const items = leads.map((l: any) => ({ id: l.id, name: l.customer_name, phone: l.phone, enquiry: l.destination || l.campaign_name || '', sent: !!l.sent_at, sentAt: l.sent_at, validPhone: !!this.toWaNumber(l.phone), createdAt: l.created_at }));
    const sent = items.filter((i) => i.sent).length;
    const pending = items.filter((i) => !i.sent && i.validPhone).length;
    return {
      campaign: pkg.campaign_name, destination: (pkg.destinations || [])[0] || null,
      isActive: pkg.is_active, templateStatus: pkg.whatsapp_template_status,
      total: items.length, sent, pending, noPhone: items.filter((i) => !i.sent && !i.validPhone).length,
      leads: items.slice(0, 200),
    };
  }

  // Sends this itinerary to every matching enquiry that has not received it. Test mode is respected.
  async sendItineraryBacklog(packageId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM tour_packages WHERE id = $1 AND is_deleted = false`, [packageId]);
    const pkg = rows[0];
    if (!pkg) throw new BadRequestException('Itinerary not found');
    if (!pkg.is_active) throw new BadRequestException('Activate the itinerary first');
    if (pkg.whatsapp_template_status !== 'APPROVED' || !pkg.whatsapp_template_name || !pkg.itinerary_pdf_object_key) throw new BadRequestException('The Meta template must be approved before sending');
    const config = await this.getConfig();
    if (!config) throw new BadRequestException('WhatsApp is not configured');
    const pending = (await this.leadsForPackage(pkg)).filter((l: any) => !l.sent_at).slice(0, 300);
    const summary = { sent: 0, skippedTestMode: 0, noPhone: 0, failed: 0 };
    const fileName = pkg.itinerary_pdf_file_name || `${pkg.name}.pdf`;
    for (const lead of pending) {
      const to = this.toWaNumber(lead.phone);
      if (!to) { summary.noPhone++; continue; }
      const outcome = await this.dispatchItinerary({
        to, leadId: lead.id, packageId: pkg.id, templateName: pkg.whatsapp_template_name, customerName: lead.customer_name,
        destination: lead.destination || pkg.name, trigger: 'backlog',
        send: () => this.r2.getPresignedDownloadUrl(pkg.itinerary_pdf_object_key, 600).then((link) =>
          this.sendDocumentTemplate(config, to, pkg.whatsapp_template_name, link, fileName, pkg.description || `Please review the ${pkg.name} itinerary.`, pkg.contact_name || 'Errances Voyages', pkg.contact_number || '', pkg, lead.customer_name)),
        afterSend: async (result) => {
          await this.recordItineraryMessage(pkg, to, lead.id, lead.customer_name, result?.messages?.[0]?.id ?? null);
        },
      });
      if (outcome.sent) summary.sent++;
      else if (outcome.reason === 'send_failed') summary.failed++;
      // 'already_sent' (the claim lost to another trigger) needs no counter bump --
      // it means this lead is already covered, which is the point of the guard.
      // 300ms was too fast for a real bulk run -- a burst of many sends in a few
      // seconds is exactly what Meta's own pacing check flags, regardless of how
      // healthy the account's quality rating is. A few seconds per send is the
      // actual lever we control for reducing "healthy ecosystem engagement" hits.
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    return summary;
  }

  // Turns Meta's raw error text into: what actually happened, whose side it's on,
  // and whether retrying can possibly help. Shared by the single failed-sends page
  // and its "Retry all" action so the two never disagree with each other.
  private classifyFailure(raw: string | null): { reason: string; fault: 'meta' | 'customer' | 'us' | 'unknown'; solution: string; retryable: boolean } {
    const text = (raw || '').toLowerCase();
    if (!text) return { reason: 'WhatsApp did not give a reason.', fault: 'unknown', solution: 'Try Resend once; if it fails again with no reason, contact Meta support with the message ID.', retryable: true };
    if (text.includes('never confirmed delivery')) return {
      reason: 'Meta accepted this message but never confirmed whether it was delivered.',
      fault: 'unknown',
      solution: 'WhatsApp gives no way to check after the fact -- only an automatic webhook, which never arrived. Resend once; if it happens again, call the customer to confirm by phone.',
      retryable: true,
    };
    if (text.includes('healthy ecosystem engagement')) return {
      reason: 'Meta blocked this specific send to protect message quality on your number.',
      fault: 'meta',
      solution: 'Not something broken on our side. Meta throttles a business number that sends many similar template messages in a burst, and it can also happen when the customer\'s own WhatsApp privacy setting ("Who can message me from businesses") blocks numbers they have not saved. Retry later, spaced out -- do not resend the same burst all at once.',
      retryable: true,
    };
    if (text.includes('undeliverable') || text.includes('not a whatsapp user') || text.includes('1013')) return {
      reason: 'This phone number could not be reached on WhatsApp at all.',
      fault: 'customer',
      solution: 'Not us and not Meta blocking -- the number is either not on WhatsApp or was entered wrong. Get the correct WhatsApp number from the customer directly; resending will keep failing until then.',
      retryable: false,
    };
    if (text.includes('no payment method')) return {
      reason: 'Our Meta Business account had no payment method on file, so Meta refused to send any paid template.',
      fault: 'us',
      solution: 'This was our account setup, now fixed -- safe to retry.',
      retryable: true,
    };
    if (text.includes('currency is not configured') || text.includes('currency') ) return {
      reason: 'Our Meta Business account had no billing currency set.',
      fault: 'us',
      solution: 'This was our account setup, now fixed -- safe to retry.',
      retryable: true,
    };
    if (text.includes('experiment')) return {
      reason: 'Meta has this phone number in one of its own internal test groups.',
      fault: 'meta',
      solution: 'Nothing on our side or the customer\'s side caused this. It usually clears on its own after some time -- retrying now will likely fail the same way.',
      retryable: false,
    };
    if (text.includes('24 hour') || text.includes('re-engagement') || text.includes('131047')) return {
      reason: 'More than 24 hours passed since this customer last messaged us.',
      fault: 'customer',
      solution: 'Only a fresh approved template can reach them now -- Resend will send a new template message, which is allowed.',
      retryable: true,
    };
    if (text.includes('rate limit') || text.includes('too many')) return {
      reason: 'We were sending too fast and got temporarily throttled.',
      fault: 'us',
      solution: 'Wait a few minutes, then retry at a slower pace.',
      retryable: true,
    };
    if (text.includes('template') && (text.includes('paused') || text.includes('disabled'))) return {
      reason: 'Meta paused or disabled this message template.',
      fault: 'meta',
      solution: 'Check WhatsApp Manager for the template\'s status and re-submit it if needed before retrying.',
      retryable: false,
    };
    return { reason: raw || 'WhatsApp did not give a reason.', fault: 'unknown', solution: 'Try Resend once; if it fails again the same way, contact Meta support with the message ID.', retryable: true };
  }

  // Every currently-failed itinerary send across every package, one row per person,
  // classified with why it failed and whether retrying is worth doing.
  async listFailedItineraries() {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT ON (w.lead_id, w.package_id)
              w.id, w.lead_id, w.package_id, w.status, w.error_message, w.created_at,
              l.customer_name, l.phone AS lead_phone, l.whatsapp_number, l.destination AS lead_destination,
              p.name AS package_name, p.destinations AS package_destinations
         FROM whatsapp_logs w
         JOIN leads l ON l.id = w.lead_id AND l.is_deleted = false
         JOIN tour_packages p ON p.id = w.package_id AND p.is_deleted = false
        WHERE w.message_type = 'itinerary' AND w.is_deleted = false
          -- a stale failed attempt (often a duplicate try seconds after a good send) is not "failed" if the customer already has it
          AND NOT EXISTS (SELECT 1 FROM whatsapp_logs g WHERE g.to_number_norm = w.to_number_norm AND g.package_id = w.package_id AND g.message_type = 'itinerary' AND g.is_deleted = false AND g.status NOT IN ('failed','test_mode_skipped','unconfirmed'))
        ORDER BY w.lead_id, w.package_id, w.created_at DESC`,
    );
    // DISTINCT ON above already gives the single latest attempt per person+package;
    // a later success would BE that latest row, so keeping only rows whose latest
    // attempt is 'failed' is exactly "still failed right now, nothing succeeded since".
    const { rows: manual } = await this.pool.query(
      `SELECT m.lead_id, m.package_id, m.marked_at, u.full_name AS marked_by_name FROM manual_itinerary_sends m LEFT JOIN users u ON u.id = m.marked_by`,
    );
    const manualBy = new Map<string, any>(manual.map((m: any) => [m.lead_id + m.package_id, m]));
    const items = rows
      .filter((row: any) => row.status === 'failed' || row.status === 'unconfirmed')
      .map((row: any) => {
        const info = this.classifyFailure(row.error_message);
        const man = manualBy.get(row.lead_id + row.package_id);
        const phone = row.whatsapp_number || row.lead_phone;
        return {
          leadId: row.lead_id, packageId: row.package_id, customerName: row.customer_name, phone,
          destination: row.lead_destination || (row.package_destinations || [])[0] || null,
          packageName: row.package_name, failedAt: row.created_at, errorMessage: row.error_message,
          ...info,
          // A person already sent it by hand: never auto-retry, shown under "Sent manually".
          ...(man ? { retryable: false, manualAt: man.marked_at, manualBy: man.marked_by_name || null } : { manualAt: null, manualBy: null }),
        };
      });
    // Not sent = failed to send, from the team's point of view: a lead that matches a
    // live itinerary but has never had an attempt belongs on the same list, not on a
    // separate "never sent" one. It sends by itself (see retryThrottledQueue).
    const { data: unsent } = await this.listUnsentItineraries();
    for (const u of unsent) {
      items.push({
        leadId: u.leadId, packageId: u.packageId, customerName: u.customerName, phone: u.phone, destination: u.destination,
        packageName: u.packageName, failedAt: u.createdAt, errorMessage: null, manualAt: null, manualBy: null,
        reason: 'Not sent yet — no attempt has been made for this lead.',
        fault: 'queued' as any, solution: 'Sends automatically within the hour, or press Resend now.', retryable: true,
      });
    }
    return { data: items, total: items.length };
  }

  // One click, all packages: retries every currently-failed send that classifyFailure
  // says is worth retrying, spaced out so we don't walk straight back into the same
  // Meta throttling that likely caused some of these in the first place.
  async markManualItinerary(leadId: string, packageId: string, userId?: string) {
    await this.pool.query(
      `INSERT INTO manual_itinerary_sends (lead_id, package_id, marked_by) VALUES ($1,$2,$3) ON CONFLICT (lead_id, package_id) DO NOTHING`,
      [leadId, packageId, userId ?? null],
    );
    return { ok: true };
  }

  async unmarkManualItinerary(leadId: string, packageId: string) {
    await this.pool.query(`DELETE FROM manual_itinerary_sends WHERE lead_id=$1 AND package_id=$2`, [leadId, packageId]);
    return { ok: true };
  }

  async retryAllFailedItineraries(userId?: string) {
    const { data: failed } = await this.listFailedItineraries();
    const toRetry = failed.filter((item) => item.retryable);
    let started = 0;
    (async () => {
      for (const item of toRetry) {
        try { await this.resendItineraryToLead(item.packageId, item.leadId, userId); }
        catch (err: any) { this.logger.warn(`Bulk retry failed for lead ${item.leadId}: ${err.message}`); }
        await new Promise((resolve) => setTimeout(resolve, 6000));
      }
    })().catch((err) => this.logger.error(`Bulk retry run crashed: ${err.message}`));
    started = toRetry.length;
    return { queued: started, skipped: failed.length - started };
  }

  // Every lead accounted for exactly once, so the Packages header adds up to the Leads
  // page total instead of counting lead+itinerary pairs and skipping leads with no attempt.
  async leadCoverage() {
    const { rows } = await this.pool.query(
      // "Received" means Meta actually confirmed it -- delivered or read. 'accepted'/'sent' only
      // means Meta agreed to try; that is not proof it reached anyone, so it is never counted as
      // received here (that was the exact false-confidence bug). A fresh accepted/sent send (under
      // 2 hours old) is still normal and counted separately as "in flight", not as a problem.
      `SELECT l.id, l.customer_name, l.created_at, l.destination, l.campaign_name, l.source, COALESCE(NULLIF(l.whatsapp_number,''), NULLIF(l.phone,'')) AS phone,
              EXISTS (SELECT 1 FROM whatsapp_logs w WHERE w.lead_id=l.id AND w.message_type='itinerary' AND w.is_deleted=false) AS attempted,
              (EXISTS (SELECT 1 FROM whatsapp_logs w WHERE w.lead_id=l.id AND w.message_type='itinerary' AND w.is_deleted=false AND w.status IN ('delivered','read')) OR EXISTS (SELECT 1 FROM manual_itinerary_sends m WHERE m.lead_id=l.id)) AS got,
              EXISTS (SELECT 1 FROM whatsapp_logs w WHERE w.lead_id=l.id AND w.message_type='itinerary' AND w.is_deleted=false AND w.status IN ('accepted','sent') AND w.created_at > now() - interval '2 hours') AS in_flight
         FROM leads l WHERE l.is_deleted = false`,
    );
    const { data: unsent } = await this.listUnsentItineraries();
    const waiting = new Set(unsent.map((u: any) => u.leadId));
    const out = { total: rows.length, received: 0, failed: 0, inFlight: 0, notSentYet: 0, noPhone: 0, noItinerary: 0, noPhoneLeads: [] as any[], noItineraryLeads: [] as any[] };
    const brief = (r: any) => ({ id: r.id, name: r.customer_name, createdAt: r.created_at, destination: r.destination, campaign: r.campaign_name, source: r.source, phone: r.phone });
    for (const r of rows) {
      if (r.got) out.received++;
      else if (r.in_flight) out.inFlight++;
      else if (r.attempted) out.failed++;
      else if (!this.toWaNumber(r.phone)) { out.noPhone++; out.noPhoneLeads.push(brief(r)); }
      else if (waiting.has(r.id)) out.notSentYet++;
      else { out.noItinerary++; out.noItineraryLeads.push(brief(r)); }
    }
    out.noPhoneLeads.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    out.noItineraryLeads.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    return out;
  }

  // Leads that match an active, approved itinerary but have NEVER had a send
  // attempted at all (no log row of any kind) -- invisible on every other list,
  // which only show attempts. Detection only: nothing here sends anything.
  async listUnsentItineraries() {
    const { rows: packages } = await this.pool.query(
      `SELECT * FROM tour_packages WHERE is_deleted = false AND is_active = true AND whatsapp_template_status = 'APPROVED' AND itinerary_pdf_object_key IS NOT NULL`,
    );
    const items: any[] = [];
    for (const pkg of packages) {
      const { rows: attempted } = await this.pool.query(
        `SELECT DISTINCT lead_id FROM whatsapp_logs WHERE package_id=$1 AND message_type='itinerary' AND is_deleted=false AND lead_id IS NOT NULL`,
        [pkg.id],
      );
      const tried = new Set(attempted.map((r: any) => r.lead_id));
      const leads = (await this.leadsForPackage(pkg)).filter((l: any) => !l.sent_at && !tried.has(l.id) && this.toWaNumber(l.phone));
      for (const l of leads) {
        items.push({ leadId: l.id, packageId: pkg.id, customerName: l.customer_name, phone: l.phone, destination: l.destination || (pkg.destinations || [])[0] || null, packageName: pkg.name, createdAt: l.created_at });
      }
    }
    return { data: items, total: items.length };
  }

  // Sends the never-attempted list -- only ever invoked by a person pressing Send
  // after seeing the per-destination breakdown. Background, spaced, and every
  // send still passes the duplicate-proof gate.
  async sendUnsentItineraries(userId?: string) {
    const { data } = await this.listUnsentItineraries();
    (async () => {
      for (const item of data) {
        try { await this.resendItineraryToLead(item.packageId, item.leadId, userId); }
        catch (err: any) { this.logger.warn(`Unsent send failed for lead ${item.leadId}: ${err.message}`); }
        await new Promise((resolve) => setTimeout(resolve, 6000));
      }
    })().catch((err) => this.logger.error(`Unsent send run crashed: ${err.message}`));
    return { queued: data.length };
  }

  // Resends this itinerary to one specific lead -- for retrying a failed send (network
  // blip, Meta's per-number throttling, etc.) without re-sending everyone else.
  async resendItineraryToLead(packageId: string, leadId: string, userId?: string) {
    const { rows } = await this.pool.query(`SELECT * FROM tour_packages WHERE id = $1 AND is_deleted = false`, [packageId]);
    const pkg = rows[0];
    if (!pkg) throw new BadRequestException('Itinerary not found');
    if (pkg.whatsapp_template_status !== 'APPROVED' || !pkg.whatsapp_template_name || !pkg.itinerary_pdf_object_key) throw new BadRequestException('The Meta template must be approved before sending');
    const config = await this.getConfig();
    if (!config) throw new BadRequestException('WhatsApp is not configured');
    const { rows: leadRows } = await this.pool.query(`SELECT id, customer_name, phone, whatsapp_number FROM leads WHERE id = $1 AND is_deleted = false`, [leadId]);
    const lead = leadRows[0];
    if (!lead) throw new BadRequestException('Lead not found');
    const to = this.toWaNumber(lead.whatsapp_number || lead.phone);
    if (!to) throw new BadRequestException('This lead has no valid WhatsApp number');
    // Same single gate as every other trigger -- "Resend" is for a lead that never
    // actually got it (a genuine delivery failure), not a second copy for one that
    // did, and the claim below makes that impossible to get wrong even by race.
    const plain = await this.inServiceWindow(to);
    const outcome = await this.dispatchItinerary({
      to, leadId: lead.id, packageId: pkg.id, templateName: plain ? null : pkg.whatsapp_template_name, customerName: lead.customer_name,
      destination: null, trigger: 'resend', actorUserId: userId,
      send: async () => {
        const link = await this.r2.getPresignedDownloadUrl(pkg.itinerary_pdf_object_key, 600);
        const fileName = pkg.itinerary_pdf_file_name || `${pkg.name}.pdf`;
        if (plain) return this.sendDocument(config, to, link, fileName, this.buildItineraryCaption(pkg, await this.getConsultantForLead(lead.id)));
        return this.sendDocumentTemplate(config, to, pkg.whatsapp_template_name, link, fileName, pkg.description || `Please review the ${pkg.name} itinerary.`, pkg.contact_name || 'Errances Voyages', pkg.contact_number || '', pkg, lead.customer_name);
      },
      afterSend: async (result) => {
        await this.recordItineraryMessage(pkg, to, lead.id, lead.customer_name, result?.messages?.[0]?.id ?? null, undefined, { plain });
      },
    });
    if (!outcome.sent && outcome.reason === 'send_failed') throw new BadRequestException(outcome.error || 'Send failed');
    return outcome;
  }

  // What the customer sees, reproduced for the CRM inbox (matches the approved template body).
  private renderItineraryText(pkg: any, leadName?: string | null, consultant?: { name?: string; phone?: string }) {
    const [p1, p2] = splitItineraryMessage(pkg.description || `Please review the ${pkg.name} itinerary.`);
    const expertName = consultant?.name || pkg.contact_name || 'Errances Voyages';
    const expertPhone = consultant?.phone || pkg.contact_number || '';
    const expert = [expertName, expertPhone].filter((x) => String(x).trim()).join(' · ');
    const greeting = `Dear ${greetingFor(leadName)},`;
    const tail = `Your expert: ${expert} — tap a button below to get in touch.`;
    return { greeting, paragraphs: [p1, p2], tail, text: [greeting, p1, p2, tail].join('\n\n') };
  }

  private async recordItineraryMessage(pkg: any, to: string, leadId: string | null, leadName: string | null | undefined, waId: string | null, consultant?: { name?: string; phone?: string }, opts?: { broadcast?: boolean; at?: string | Date | null; plain?: boolean }) {
    if (leadId && opts?.broadcast !== false) {
      // Test sends pass leadId = null, so this only fires for a real customer.
      this.pool.query(`SELECT assigned_to FROM leads WHERE id = $1`, [leadId]).then(({ rows }) => {
        this.realtime.broadcastItinerarySent({ lead_id: leadId, customer_name: leadName || 'Customer', phone: to, package_name: pkg.name, assigned_to: rows[0]?.assigned_to ?? null });
      }).catch(() => undefined);
    }
    try {
      const rendered = this.renderItineraryText(pkg, leadName, consultant);
      let buttons: { type: string; text: string }[] = [];
      // A plain chat document carries no template buttons -- don't show ones the customer never got.
      if (!opts?.plain) { try { buttons = buildMetaButtons(pkg).meta.map((b: any) => ({ type: b.type, text: b.text })); } catch { /* keep empty */ } }
      // Meta's send API returns "accepted, queued" immediately -- before its own
      // async throttle can later reject the message via webhook. A retry of the
      // same (phone, package) must update that one bubble, never add a new one,
      // or a person retried several times shows several identical "sent" bubbles
      // in the Inbox for a message that may have never actually been delivered.
      await this.pool.query(
        `INSERT INTO whatsapp_messages(phone_number, lead_id, direction, msg_type, body, wa_message_id, meta, package_id, created_at)
         VALUES($1,$2,'out','itinerary',$3,$4,$5,$6,COALESCE($7::timestamptz, now()))
         ON CONFLICT (phone_number, package_id) WHERE msg_type = 'itinerary'
         DO UPDATE SET lead_id = $2, body = $3, wa_message_id = $4, meta = $5, created_at = COALESCE($7::timestamptz, now())`,
        [to, leadId, rendered.text, waId, JSON.stringify({ packageId: pkg.id, packageName: pkg.name, fileName: pkg.itinerary_pdf_file_name || `${pkg.name}.pdf`, greeting: rendered.greeting, paragraphs: rendered.paragraphs, tail: rendered.tail, buttons, waId }), pkg.id, opts?.at ?? null],
      );
    } catch (err: any) {
      this.logger.error(`Could not record itinerary message: ${err.message}`);
    }
  }

  // One-off: turn earlier itinerary log rows into readable messages (uses the itinerary's current text).
  async backfillItineraryMessages() {
    const { rows } = await this.pool.query(
      `SELECT wl.id, wl.to_number, wl.message_id, wl.lead_id, wl.package_id, COALESCE(wl.sent_at, wl.created_at) AS at, l.customer_name
         FROM whatsapp_logs wl LEFT JOIN leads l ON l.id = wl.lead_id
        WHERE wl.message_type = 'itinerary' AND wl.package_id IS NOT NULL AND wl.status IN ('accepted','sent','delivered','read')
          AND NOT EXISTS (SELECT 1 FROM whatsapp_messages m WHERE m.msg_type = 'itinerary' AND m.wa_message_id IS NOT DISTINCT FROM wl.message_id AND m.phone_number = wl.to_number AND m.created_at = COALESCE(wl.sent_at, wl.created_at))`,
    );
    let count = 0;
    for (const row of rows) {
      const { rows: pk } = await this.pool.query(`SELECT * FROM tour_packages WHERE id = $1`, [row.package_id]);
      if (!pk[0]) continue;
      const rendered = this.renderItineraryText(pk[0], row.customer_name);
      let buttons: { type: string; text: string }[] = [];
      try { buttons = buildMetaButtons(pk[0]).meta.map((b: any) => ({ type: b.type, text: b.text })); } catch { /* keep empty */ }
      await this.pool.query(
        `INSERT INTO whatsapp_messages(phone_number, lead_id, direction, msg_type, body, wa_message_id, meta, created_at) VALUES($1,$2,'out','itinerary',$3,$4,$5,$6)`,
        [row.to_number, row.lead_id, rendered.text, row.message_id, JSON.stringify({ packageId: pk[0].id, packageName: pk[0].name, fileName: pk[0].itinerary_pdf_file_name || `${pk[0].name}.pdf`, greeting: rendered.greeting, paragraphs: rendered.paragraphs, tail: rendered.tail, buttons, waId: row.message_id }), row.at],
      );
      count++;
    }
    return { recorded: count };
  }

  // Every itinerary message attempt (sent / delivered / viewed / failed / skipped) for one itinerary.
  async packageMessages(packageId: string) {
    const { rows } = await this.pool.query(
      `SELECT wl.id, wl.status, wl.error_message, wl.to_number, wl.message_id, wl.sent_at, wl.created_at, wl.lead_id,
              l.customer_name, l.lead_number, l.destination, l.campaign_name,
              u.full_name AS sent_by_name
         FROM whatsapp_logs wl LEFT JOIN leads l ON l.id = wl.lead_id
              LEFT JOIN users u ON u.id = wl.sent_by
        WHERE wl.package_id = $1 AND wl.message_type = 'itinerary' AND wl.is_deleted = false
        ORDER BY COALESCE(wl.sent_at, wl.created_at) DESC LIMIT 1000`,
      [packageId],
    );
    return { data: rows, total: rows.length };
  }

  private async getConsultantForLead(leadId: string): Promise<{ full_name: string; phone: string }> {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(u.full_name, 'Errances Voyages') AS full_name, COALESCE(u.phone, '9999999999') AS phone
         FROM leads l LEFT JOIN users u ON u.id = l.assigned_to WHERE l.id = $1 LIMIT 1`,
      [leadId],
    );
    return rows[0] || { full_name: 'Errances Voyages', phone: '9999999999' };
  }

  // One professional caption used everywhere we attach the itinerary
  // document to a single WhatsApp message: thanks the customer, names the
  // destination, and hands them off to their assigned consultant.
  private buildItineraryCaption(pkg: { name: string; description?: string | null }, consultant: { full_name: string; phone: string }): string {
    const intro =
      pkg.description ||
      `Thank you for choosing Errances Voyages! 🙏 Your *${pkg.name}* itinerary is here — kindly explore it in detail.`;
    return `${intro}\n\n📥 Download the itinerary above 👆\n\nFor personalised help, contact your travel consultant *${consultant.full_name}* on *${consultant.phone}*.`;
  }

  private async sendMappedItineraryAfterTemplate(to: string): Promise<void> {
    const normalized = String(to).replace(/\D/g, '');
    const { rows } = await this.pool.query(
      `SELECT lead_id, state FROM whatsapp_conversations
       WHERE regexp_replace(phone_number, '[^0-9]', '', 'g') = $1
       LIMIT 1`,
      [normalized],
    );
    const conversation = rows[0];
    if (!conversation?.lead_id || conversation.state !== 'awaiting_itinerary_consent') return;
    const config = await this.getConfig();
    if (!config) return;
    const sent = await this.sendItineraryForLead(config, normalized, conversation.lead_id);
    if (!sent) return;
    await this.upsertConversation(normalized, 'completed', { itinerarySentAutomatically: true }, undefined, conversation.lead_id);
    // Sending the itinerary never touches the lead's own pipeline Status -- see dispatchItinerary.
  }

  private async upsertConversation(
    phoneNumber: string,
    state: string,
    context: Record<string, unknown> | null,
    contactName?: string,
    leadId?: string,
  ) {
    await this.pool.query(
      `INSERT INTO whatsapp_conversations (phone_number, contact_name, state, context, lead_id, last_message_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (phone_number)
       DO UPDATE SET state = $3, context = COALESCE($4, whatsapp_conversations.context),
                     contact_name = COALESCE($2, whatsapp_conversations.contact_name),
                     lead_id = COALESCE($5, whatsapp_conversations.lead_id),
                     last_message_at = now()`,
      [phoneNumber, contactName ?? null, state, context ? JSON.stringify(context) : null, leadId ?? null],
    );
  }

  private async getConfig(): Promise<WhatsAppConfig | null> {
    const { rows } = await this.pool.query(
      `SELECT phone_number_id, business_account_id, access_token_encrypted FROM whatsapp_config
       WHERE is_configured = true ORDER BY created_at DESC LIMIT 1`,
    );
    const row = rows[0];
    if (!row?.phone_number_id || !row?.access_token_encrypted) return null;
    return { phone_number_id: row.phone_number_id, business_account_id: row.business_account_id, access_token: row.access_token_encrypted };
  }

  private graphUrl(config: WhatsAppConfig) {
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    return `https://graph.facebook.com/${version}/${config.phone_number_id}/messages`;
  }

  private async callWhatsAppApi(config: WhatsAppConfig, payload: Record<string, unknown>) {
    const res = await fetch(this.graphUrl(config), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
    if (!res.ok) {
      const error = await res.text();
      this.logger.error(`WhatsApp API call failed: ${res.status} ${error}`);
      let reason = '';
      try { const parsed = JSON.parse(error); reason = parsed?.error?.code === 131047 ? '24-hour reply window is closed - the customer must message first, or send an approved template' : (parsed?.error?.message || ''); } catch { /* ignore */ }
      throw new Error(`WhatsApp API call failed: ${res.status}${reason ? ' - ' + reason : ''}`);
    }
    return res.json() as Promise<any>;
  }

  private async resolveMetaAppId(accessToken: string): Promise<string> {
    const configured = this.config.get<string>('META_APP_ID');
    if (configured) return configured;
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const response = await fetch(`https://graph.facebook.com/${version}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(accessToken)}`);
    const data: any = await response.json();
    if (!response.ok || !data?.data?.app_id) throw new BadRequestException('Could not resolve the Meta App ID from the configured WhatsApp token');
    return String(data.data.app_id);
  }

  private async storeMessage(phone: string, leadId: string | null, direction: 'in' | 'out', body: string, type = 'text', waId?: string, sentBy?: string, extraMeta?: Record<string, unknown>) {
    // meta.waId mirrors wa_message_id so the inbox can dedupe against any matching
    // whatsapp_logs row (e.g. a template send that's also logged there) and avoid
    // showing the same message twice.
    const meta = waId || extraMeta ? { ...(waId ? { waId } : {}), ...(extraMeta ?? {}) } : null;
    const { rows } = await this.pool.query(
      `INSERT INTO whatsapp_messages(phone_number, lead_id, direction, msg_type, body, wa_message_id, sent_by, meta)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, direction, msg_type, body, created_at, meta`,
      [phone, leadId, direction, type, body, waId ?? null, sentBy ?? null, meta ? JSON.stringify(meta) : null],
    );
    return rows[0];
  }

  // A real file/image the agent picked from their device and sent as-is (as opposed
  // to the itinerary PDF flow, which always sends the package's own document).
  async sendAgentMedia(leadId: string, url: string, filename: string, mimeType: string, caption: string | undefined, userId?: string) {
    const config = await this.getConfig();
    if (!config) throw new BadRequestException('WhatsApp is not configured');
    const { rows } = await this.pool.query(`SELECT phone, whatsapp_number FROM leads WHERE id=$1 AND is_deleted=false`, [leadId]);
    const raw = String(rows[0]?.whatsapp_number || rows[0]?.phone || '').replace(/\D/g, '');
    if (!raw) throw new BadRequestException('This lead has no phone number');
    const to = raw.length === 10 ? `91${raw}` : raw;
    const isImage = mimeType.startsWith('image/');
    // The bucket is private: an unsigned URL makes Meta's download fail ("Downloading media from weblink failed").
    const objectKey = /whatsapp-attachments\/[^?#]+/.exec(url)?.[0] ?? null;
    const link = objectKey ? await this.r2.getPresignedDownloadUrl(objectKey, 3600) : url;
    const payload = isImage
      ? { to, type: 'image', image: { link, caption: caption || undefined } }
      : { to, type: 'document', document: { link, filename, caption: caption || undefined } };
    let result: any;
    try { result = await this.callWhatsAppApi(config, payload); }
    catch (err: any) { throw new BadRequestException(err.message); }
    return this.storeMessage(to, leadId, 'out', caption || filename, isImage ? 'image' : 'document', result?.messages?.[0]?.id, userId, { url, filename, mimeType, ...(objectKey ? { objectKey } : {}) });
  }

  private async notifyInbound(from: string, leadId: string | undefined, contactName: string | undefined, text: string) {
    let lead: any = null;
    if (leadId) {
      const { rows } = await this.pool.query(`SELECT customer_name, assigned_to FROM leads WHERE id=$1`, [leadId]);
      lead = rows[0];
    }
    this.realtime.broadcastWhatsAppMessage({
      lead_id: leadId ?? null,
      customer_name: lead?.customer_name || contactName || from,
      phone: from,
      body: text,
      assigned_to: lead?.assigned_to ?? null,
    });
  }

  // WhatsApp charges for the current month, straight from Meta's pricing_analytics
  // (per day, per message type) -- nothing typed in by hand. GST is an estimate at 18%
  // (the rate Billing Hub applies); the exact billed balance and tax stay in Meta's
  // Billing Hub, which has no public API.
  async billingSummary() {
    const config = await this.getConfig();
    if (!config?.business_account_id) throw new BadRequestException('WhatsApp is not configured');
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v23.0';
    const IST = 5.5 * 3600;
    const now = Math.floor(Date.now() / 1000);
    const istNow = new Date((now + IST) * 1000);
    const monthStart = Math.floor(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1) / 1000) - IST;
    const url = `https://graph.facebook.com/${version}/${config.business_account_id}?fields=pricing_analytics.start(${monthStart}).end(${now}).granularity(DAILY).dimensions(%5B%22PRICING_CATEGORY%22%5D)`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${config.access_token}` } });
    const body: any = await res.json();
    if (!res.ok) throw new BadRequestException(body?.error?.error_user_msg || body?.error?.message || 'Could not read billing from Meta');
    const points: any[] = (body?.pricing_analytics?.data ?? []).flatMap((d: any) => d.data_points ?? []);
    const byCategory = new Map<string, { volume: number; cost: number }>();
    const byDay = new Map<number, { volume: number; cost: number }>();
    for (const p of points) {
      const c = byCategory.get(p.pricing_category) ?? { volume: 0, cost: 0 };
      c.volume += p.volume; c.cost += p.cost; byCategory.set(p.pricing_category, c);
      const d = byDay.get(p.start) ?? { volume: 0, cost: 0 };
      d.volume += p.volume; d.cost += p.cost; byDay.set(p.start, d);
    }
    const totalCost = points.reduce((sum, p) => sum + p.cost, 0);
    const todayStart = Math.max(...Array.from(byDay.keys()), 0);
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      currency: 'INR', monthStart: new Date(monthStart * 1000).toISOString(),
      totalCost: round(totalCost), gstRate: 0.18, estimatedGst: round(totalCost * 0.18), estimatedTotal: round(totalCost * 1.18),
      todayCost: round(byDay.get(todayStart)?.cost ?? 0),
      byCategory: Array.from(byCategory.entries()).map(([category, v]) => ({ category, volume: v.volume, cost: round(v.cost) })),
      days: Array.from(byDay.entries()).sort((a, b) => b[0] - a[0]).map(([start, v]) => ({ date: new Date((start + IST) * 1000).toISOString().slice(0, 10), volume: v.volume, cost: round(v.cost) })),
      updatedAt: new Date().toISOString(),
    };
  }

  // True if this customer messaged us in the last 23h -- WhatsApp's free-form
  // "service window", inside which a normal document can be sent without a template.
  private async inServiceWindow(to: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM whatsapp_messages WHERE direction = 'in'
         AND right(regexp_replace(phone_number, '[^0-9]', '', 'g'), 10) = right(regexp_replace($1, '[^0-9]', '', 'g'), 10)
         AND created_at > now() - interval '23 hours' LIMIT 1`,
      [to],
    );
    return rows.length > 0;
  }

  // A short-lived link to the itinerary PDF itself, so the card in the Inbox can be opened.
  async packageDocumentUrl(packageId: string) {
    const { rows } = await this.pool.query(`SELECT itinerary_pdf_object_key FROM tour_packages WHERE id = $1`, [packageId]);
    const key = rows[0]?.itinerary_pdf_object_key;
    if (!key) throw new BadRequestException('No document uploaded for this itinerary');
    const url = await this.r2.getPresignedDownloadUrl(key, 900);
    return { url, objectKey: key, ...(await this.pdfFacts(key, url)) };
  }

  // Size and page count of an itinerary PDF, worked out once and remembered.
  private pdfFactsCache = new Map<string, { bytes: number | null; pages: number | null }>();
  private async pdfFacts(key: string, url: string) {
    const cached = this.pdfFactsCache.get(key);
    if (cached) return cached;
    const facts = { bytes: await this.r2.objectSize(key), pages: null as number | null };
    try {
      const res = await fetch(url);
      if (res.ok) {
        const file = join(tmpdir(), `pdfinfo-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
        await fsp.writeFile(file, Buffer.from(await res.arrayBuffer()));
        const out: string = await new Promise((resolve) => execFile('pdfinfo', [file], (err, stdout) => resolve(err ? '' : String(stdout))));
        await fsp.unlink(file).catch(() => undefined);
        const m = /Pages:\s+(\d+)/.exec(out);
        if (m) facts.pages = Number(m[1]);
      }
    } catch { /* size alone is still useful */ }
    this.pdfFactsCache.set(key, facts);
    return facts;
  }

  async listMessages(leadId: string) {
    // Self-heal: any itinerary that genuinely went out (Meta-confirmed status) but
    // has no rich chat bubble -- sends from before the bubble was recorded on every
    // path -- gets its bubble rebuilt from the package, dated at the real send time,
    // silently (no notifications). The inbox must show what the customer's phone shows.
    try {
      const { rows: missing } = await this.pool.query(
        `SELECT DISTINCT ON (w.package_id) w.package_id, w.to_number, w.message_id, COALESCE(w.sent_at, w.created_at) AS at, l.customer_name
           FROM whatsapp_logs w JOIN leads l ON l.id = w.lead_id
          WHERE w.lead_id = $1 AND w.message_type = 'itinerary' AND w.is_deleted = false AND w.package_id IS NOT NULL
            AND w.status IN ('accepted','sent','delivered','read')
            AND NOT EXISTS (SELECT 1 FROM whatsapp_messages m WHERE m.phone_number = w.to_number AND m.package_id = w.package_id AND m.msg_type = 'itinerary')
          ORDER BY w.package_id, w.created_at DESC`,
        [leadId],
      );
      for (const row of missing) {
        const { rows: pk } = await this.pool.query(`SELECT * FROM tour_packages WHERE id = $1`, [row.package_id]);
        if (pk[0]) await this.recordItineraryMessage(pk[0], row.to_number, leadId, row.customer_name, row.message_id, undefined, { broadcast: false, at: row.at });
      }
    } catch (err: any) {
      this.logger.warn(`listMessages self-heal skipped: ${err.message}`);
    }
    const { rows } = await this.pool.query(
      `SELECT m.id, m.direction, m.msg_type, m.body, m.meta, m.created_at, m.wa_message_id, u.full_name AS sent_by_name FROM whatsapp_messages m
        LEFT JOIN users u ON u.id = m.sent_by
        WHERE m.lead_id = $1
           OR right(regexp_replace(m.phone_number, '[^0-9]', '', 'g'), 10) = right(regexp_replace((SELECT COALESCE(NULLIF(whatsapp_number,''), phone, '') FROM leads WHERE id = $1), '[^0-9]', '', 'g'), 10)
        ORDER BY m.created_at ASC LIMIT 500`,
      [leadId],
    );
    for (const row of rows) {
      const key = row.meta?.objectKey;
      if (key) { try { row.meta = { ...row.meta, url: await this.r2.getPresignedDownloadUrl(key, 3600) }; } catch { /* keep stored url */ } }
    }
    return rows;
  }

  // An agent replies from the CRM inbox through the same business number.
  // Resolves a Chat button tap (code = <itineraryId>.<buttonPosition>) to a WhatsApp
  // chat link with the sales person's number and the starting message ready.
  async resolveChatLink(code: string): Promise<string | null> {
    const [pkgId, position] = String(code || '').split('.');
    if (!/^[0-9a-f-]{36}$/i.test(pkgId || '') || !/^\d+$/.test(position || '')) return null;
    const { rows } = await this.pool.query(`SELECT buttons, contact_number, contact_button_text, destinations FROM tour_packages WHERE id=$1 AND is_deleted=false`, [pkgId]);
    if (!rows[0]) return null;
    const { ordered } = buildMetaButtons(rows[0]);
    const button = ordered[Number(position)];
    if (!button || button.type !== 'chat') return null;
    const mobile = normalizeIndianMobile(button.phone || ordered.find((c) => c.type === 'call')?.phone || rows[0].contact_number);
    if (!mobile) return null;
    const place = rows[0].destinations?.[0] || 'your trip';
    const text = (button.reply?.trim() || 'Hi, I am interested to know more about {destination}').replace(/\{destination\}/g, place);
    return `https://wa.me/91${mobile}?text=${encodeURIComponent(text)}`;
  }

  async sendAgentMessage(leadId: string, text: string, userId?: string, replyToWaId?: string) {
    const body = String(text || '').trim();
    if (!body) throw new BadRequestException('Type a message first');
    const config = await this.getConfig();
    if (!config) throw new BadRequestException('WhatsApp is not configured');
    const { rows } = await this.pool.query(`SELECT phone, whatsapp_number FROM leads WHERE id=$1 AND is_deleted=false`, [leadId]);
    const raw = String(rows[0]?.whatsapp_number || rows[0]?.phone || '').replace(/\D/g, '');
    if (!raw) throw new BadRequestException('This lead has no phone number');
    const to = raw.length === 10 ? `91${raw}` : raw;
    let result: any;
    let quoted: { waId: string; body: string; from: string } | null = null;
    if (replyToWaId) {
      const { rows: q } = await this.pool.query(`SELECT body, direction FROM whatsapp_messages WHERE wa_message_id=$1 LIMIT 1`, [replyToWaId]);
      if (q[0]) quoted = { waId: replyToWaId, body: String(q[0].body || '').slice(0, 200), from: q[0].direction === 'in' ? 'customer' : 'us' };
    }
    try { result = await this.callWhatsAppApi(config, { to, type: 'text', text: { body }, ...(quoted ? { context: { message_id: quoted.waId } } : {}) }); }
    catch (err: any) { throw new BadRequestException(err.message); }
    return this.storeMessage(to, leadId, 'out', body, 'text', result?.messages?.[0]?.id, userId, quoted ? { replyTo: quoted } : undefined);
  }

  // ---- Inbox state: unread, open/waiting/done, quick replies, star, re-open ----
  private readonly UNREAD_BASELINE = '2026-09-27T00:00:00+05:30';

  async inboxState() {
    const { rows } = await this.pool.query(
      `SELECT l.id AS lead_id, COALESCE(s.status,'open') AS status,
              (SELECT count(*)::int FROM whatsapp_messages m WHERE m.lead_id=l.id AND m.direction='in' AND m.created_at > COALESCE(s.last_read_at, $1::timestamptz)) AS unread,
              lm.body AS last_body, lm.direction AS last_direction, lm.msg_type AS last_type, lm.created_at AS last_at
         FROM leads l
         LEFT JOIN whatsapp_chat_state s ON s.lead_id = l.id
         LEFT JOIN LATERAL (SELECT body, direction, msg_type, created_at FROM whatsapp_messages m WHERE m.lead_id=l.id ORDER BY created_at DESC LIMIT 1) lm ON true
        WHERE l.is_deleted=false AND (lm.created_at IS NOT NULL OR s.lead_id IS NOT NULL)`,
      [this.UNREAD_BASELINE],
    );
    return { data: rows };
  }

  async markChatRead(leadId: string) {
    const { rows: prior } = await this.pool.query(
      `SELECT last_read_at FROM whatsapp_chat_state WHERE lead_id = $1`, [leadId],
    );
    await this.pool.query(
      `INSERT INTO whatsapp_chat_state (lead_id, last_read_at) VALUES ($1, now())
       ON CONFLICT (lead_id) DO UPDATE SET last_read_at = now(), updated_at = now()`, [leadId]);
    // Tell Meta we've read the customer's messages so the blue tick shows up on
    // their own WhatsApp too, not just inside our CRM.
    const { rows: inbound } = await this.pool.query(
      `SELECT wa_message_id FROM whatsapp_messages
        WHERE lead_id = $1 AND direction = 'in' AND wa_message_id IS NOT NULL
          AND created_at > COALESCE($2::timestamptz, '-infinity'::timestamptz)
        ORDER BY created_at DESC LIMIT 1`,
      [leadId, prior[0]?.last_read_at ?? null],
    );
    const waMessageId = inbound[0]?.wa_message_id;
    if (waMessageId) {
      const config = await this.getConfig();
      if (config) {
        await this.callWhatsAppApi(config, { status: 'read', message_id: waMessageId }).catch(
          (err) => this.logger.warn(`Could not send read receipt to Meta: ${err.message}`),
        );
      }
    }
    return { ok: true };
  }

  async setChatStatus(leadId: string, status: string) {
    if (!['open', 'waiting', 'done'].includes(status)) throw new BadRequestException('Unknown status');
    await this.pool.query(
      `INSERT INTO whatsapp_chat_state (lead_id, status) VALUES ($1, $2)
       ON CONFLICT (lead_id) DO UPDATE SET status = $2, updated_at = now()`, [leadId, status]);
    return { ok: true };
  }

  async listQuickReplies() {
    const { rows } = await this.pool.query(`SELECT id, title, body FROM whatsapp_quick_replies ORDER BY title`);
    return { data: rows };
  }

  async createQuickReply(title: string, body: string, userId?: string) {
    if (!String(title || '').trim() || !String(body || '').trim()) throw new BadRequestException('Give the quick reply a title and text');
    const { rows } = await this.pool.query(
      `INSERT INTO whatsapp_quick_replies (title, body, created_by) VALUES ($1,$2,$3) RETURNING id, title, body`,
      [String(title).trim().slice(0, 60), String(body).trim(), userId ?? null]);
    return rows[0];
  }

  async deleteQuickReply(id: string) {
    await this.pool.query(`DELETE FROM whatsapp_quick_replies WHERE id=$1`, [id]);
    return { ok: true };
  }

  async toggleStar(messageId: string) {
    const { rows } = await this.pool.query(
      `UPDATE whatsapp_messages SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('starred', NOT COALESCE((meta->>'starred')::boolean, false)) WHERE id=$1 RETURNING meta`, [messageId]);
    return { starred: !!rows[0]?.meta?.starred };
  }

  // The 24-hour free-chat window is closed: the only thing WhatsApp allows is an approved
  // template. Sends the welcome template so the customer's reply re-opens the window.
  async reopenChat(leadId: string) {
    const { rows } = await this.pool.query(`SELECT customer_name, destination, phone, whatsapp_number FROM leads WHERE id=$1 AND is_deleted=false`, [leadId]);
    const lead = rows[0];
    if (!lead) throw new BadRequestException('Lead not found');
    const phone = lead.whatsapp_number || lead.phone;
    if (!phone) throw new BadRequestException('This lead has no phone number');
    return this.sendLeadWelcomeTemplate(phone, lead.customer_name, lead.destination || '', leadId);
  }

  private sendText(config: WhatsAppConfig, to: string, body: string) {
    return this.callWhatsAppApi(config, { to, type: 'text', text: { body } });
  }

  private sendInteractiveList(
    config: WhatsAppConfig,
    to: string,
    bodyText: string,
    buttonText: string,
    rows: { id: string; title: string; description: string }[],
  ) {
    return this.callWhatsAppApi(config, {
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: bodyText },
        action: {
          button: buttonText,
          sections: [{ title: 'Our Packages', rows }],
        },
      },
    });
  }

  // Bare API call only -- the claim, the log row, and failure alerting all live
  // in dispatchItinerary now (every caller of this goes through it).
  private sendDocument(config: WhatsAppConfig, to: string, link: string, filename: string, caption?: string) {
    return this.callWhatsAppApi(config, { to, type: 'document', document: { link, filename, caption } });
  }

  private sendDocumentTemplate(config: WhatsAppConfig, to: string, name: string, link: string, filename: string, message: string, consultantName: string, consultantPhone: string, pkg?: any, leadName?: string) {
    // Same 4-slot approved template structure (greeting / paragraph 1 / paragraph 2 / expert) --
    // adding "download above" as a new 5th parameter would break the send, since it would no
    // longer match what Meta approved. Instead it rides inside the last paragraph, which is a
    // free-text parameter, so this applies to every package without touching approval status.
    const [p1, p2] = splitItineraryMessage(message);
    // WhatsApp rejects a line break inside a template parameter (see splitItineraryMessage above) --
    // this must stay on the same line as the paragraph, not a new one.
    const p2WithPrompt = `${p2} 📥 Download the itinerary above 👆`.slice(0, 450);
    const components: any[] = [{
      type:'header', parameters:[{ type:'document', document:{ link, filename } }],
    }, {
      type:'body', parameters: name.startsWith('campaign_itinerary_v')
        ? [{ type:'text', text: greetingFor(leadName) }, { type:'text', text: p1.slice(0, 450) }, { type:'text', text: p2WithPrompt }, { type:'text', text: [String(consultantName).slice(0,60), String(consultantPhone || '').slice(0,30)].filter((part) => part.trim()).join(' · ') || 'Errances Voyages' }]
        : [{ type:'text', text:String(message).slice(0,900) }, { type:'text', text:String(consultantName).slice(0,60) }, { type:'text', text:String(consultantPhone).slice(0,30) }],
    }];
    // v2 templates carry a "Request a call back" quick-reply button (index 1,
    // after the static tap-to-call button); its payload comes back to our
    // webhook when the customer taps it.
    if (name.startsWith('campaign_itinerary_v')) {
      const indexes = pkg?.id ? buildMetaButtons(pkg).quickReplyIndexes : [];
      for (const index of indexes) components.push({ type:'button', sub_type:'url', index:String(index), parameters:[{ type:'text', text:`${pkg.id}.${index}` }] });
    }
    return this.callWhatsAppApi(config, { to, type:'template', template:{ name, language:{ code:'en_US' }, components } });
  }

  // Business name and logo exactly as customers see them in WhatsApp, for the
  // itinerary preview.
  async getBusinessProfile() {
    const fallback = { name: 'Errances Voyages', phone: null as string | null, pictureUrl: null as string | null };
    const config = await this.getConfig();
    if (!config) return fallback;
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const base = `https://graph.facebook.com/${version}/${config.phone_number_id}`;
    const token = encodeURIComponent(config.access_token);
    const [info, profile]: any[] = await Promise.all([
      fetch(`${base}?fields=verified_name,display_phone_number&access_token=${token}`).then((r) => r.json()).catch(() => ({})),
      fetch(`${base}/whatsapp_business_profile?fields=profile_picture_url&access_token=${token}`).then((r) => r.json()).catch(() => ({})),
    ]);
    return {
      name: info?.verified_name || fallback.name,
      phone: info?.display_phone_number || null,
      pictureUrl: profile?.data?.[0]?.profile_picture_url || null,
    };
  }
}
