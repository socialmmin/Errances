import { leadVisibleSql } from '../../../common/leads/lead-visibility';
import { BadRequestException, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { advanceLeadStatus } from '../../../common/leads/advance-lead-status';
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
import { TwilioWhatsAppService, TWILIO_PSEUDO_ID } from './twilio-whatsapp.service';
import { EnquiryState, EnquiryStep, detectLanguage, enquiryText, hasRealName, parseTravelDates, parseTravelType, parseTravellers, questionText, staffSummary, summaryText, travelTypeFallback, travelTypeLabel, travelTypeRows, welcomeText } from './enquiry-flow';

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

// Same idea as splitItineraryMessage, but keeps the "Dreaming of X..." hook and the
// "We have done it for you..." offer as two separate template parameters instead of joining
// them with a single space -- that join was making the two sentences visually run together in
// the delivered message, since WhatsApp still won't allow a real line break inside either one.
export function splitItineraryMessage3(message: string): [string, string, string] {
  const clean = String(message || '').replace(/\r/g, '').trim();
  const parts = clean.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (parts.length >= 3) return [parts[0], parts[1], parts.slice(2).join(' ')];
  if (parts.length === 2) return [parts[0], parts[1], 'Tap a button below to reach our expert.'];
  const one = (parts[0] || clean).replace(/\s+/g, ' ');
  const first = one.match(/^(.+?[?!.])\s+(.+)$/);
  if (!first) return [one, 'Tap a button below to reach our expert.', ''];
  const second = first[2].match(/^(.+?[?!.])\s+(.+)$/);
  if (second) return [first[1], second[1], second[2]];
  return [first[1], first[2], 'Tap a button below to reach our expert.'];
}

const V2_TEMPLATE_PREFIX = 'campaign_itinerary_v10_';

const MALE_NAMES = new Set('ramesh suresh kumar arun murugan natarajan sankar shankar ganesh prabhakar anand babu raja rajan ravi senthil karthik karthick vijay vinoth mani selvam siva sivakumar kannan balaji gopal gopalakrishnan hari mohan naveen prakash rajesh ramasamy saravanan sathish satish sundar venkat venkatesh abhishek abdul azizur mounish prabin muruga chandrasakaran chandru baskar baskaran dinesh manoj mahesh ramkumar santhosh sivaraman subramanian sekar selvaraj thiru vignesh vasanth vishnu yogesh ashok ajay amit rahul rohit sanjay sachin nagarajan nataraj manikandan elango ilango kalyan krishnan lokesh magesh mohamed muhammad nandha nithin paras parthiban pradeep raghu rajkumar ramachandran sabari sakthivel sathya sudhakar surya tamil udhaya velmurugan vetri'.split(' '));
const FEMALE_NAMES = new Set('lakshmi priya kavitha meena divya anitha anita sangeetha deepa revathi sumathi vasanthi uma radha geetha gita sasikala jayanthi malathi pooja nithya mythili saranya sowmya shanthi latha kala banu fathima ayesha nisha sneha anjali rekha sudha vimala kalpana kousalya lalitha malini nirmala padma parvathi poornima ramya rani renuka sandhya selvi shobana sridevi sujatha sumitha swathi tamilselvi vidya vani yamuna bharathi'.split(' ').filter((n) => n !== 'bharathi'));

// "Hello Mr. Sankar," -- a title is added only for well-known first names; anything
// uncertain gets the plain first name so nobody is mislabelled.
// A trip length in plain words customers understand: "3 Nights / 4 Days", or just "1 Day" for a
// day trip -- never "3N / 4D" or "0N / 1D".
export function durationWords(nights: number | string | null | undefined, days: number | string | null | undefined): string {
  const n = Number(nights) || 0;
  const d = Number(days) || 0;
  const dayPart = `${d} Day${d === 1 ? '' : 's'}`;
  return n > 0 ? `${n} Night${n === 1 ? '' : 's'} / ${dayPart}` : dayPart;
}

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

export interface PackageButton { type: 'call' | 'url' | 'chat' | 'duration'; text: string; phone?: string; url?: string; reply?: string; customLabel?: string }

// The text on the "ask about another duration" quick-reply button, and how the webhook
// recognizes a tap on it (see handleInbound) -- kept as one constant so the button's label
// and its own recognition can never drift apart.
export const DURATION_BUTTON_TEXT = 'Explore More Itineraries';

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
  return list.filter((b: any) => b && ['call', 'url', 'chat', 'duration'].includes(b.type));
}

// Meta wants call/link buttons first and quick replies grouped after them. Duration shares
// the non-call group's 2-slot cap with url/chat (Meta allows 3 buttons total per template).
export function buildMetaButtons(pkg: any): { meta: any[]; quickReplyIndexes: number[]; durationButtonIndex: number | null; signature: string; ordered: PackageButton[] } {
  const all = resolveButtons(pkg);
  // Explore (a quick reply) goes FIRST, right under the message, so customers see it without
  // scrolling; then Call, then Chat/link. Meta allows mixing as long as quick replies and
  // call/link buttons are each grouped together. 1 call + 2 others max, as before.
  const nonCall = all.filter((b) => b.type === 'url' || b.type === 'chat' || b.type === 'duration').slice(0, 2);
  const ordered = [...nonCall.filter((b) => b.type === 'duration'), ...all.filter((b) => b.type === 'call').slice(0, 1), ...nonCall.filter((b) => b.type !== 'duration')];
  const meta: any[] = [];
  const quickReplyIndexes: number[] = [];
  let durationButtonIndex: number | null = null;
  ordered.forEach((b, index) => {
    const text = String(b.text || '').trim().slice(0, 25);
    if (!text) throw new BadRequestException('Every button needs some text');
    if (b.type === 'call') {
      const number = waNumber(b.phone || pkg?.contact_number);
      if (!number) throw new BadRequestException('The Call button needs a valid phone number, for example 06 12 34 56 78 or +33 6 12 34 56 78');
      meta.push({ type: 'PHONE_NUMBER', text, phone_number: '+' + number });
    } else if (b.type === 'url') {
      const url = String(b.url || '').trim();
      if (!/^https?:\/\/\S+\.\S+/.test(url)) throw new BadRequestException('Website buttons need a full link starting with https://');
      meta.push({ type: 'URL', text, url });
    } else if (b.type === 'duration') {
      // Plain QUICK_REPLY -- no dynamic suffix, Meta echoes this exact text back on tap
      // (message.button.text), which is how the webhook recognizes it (see handleInbound).
      meta.push({ type: 'QUICK_REPLY', text });
      durationButtonIndex = index;
    } else {
      const callFallback = all.find((c) => c.type === 'call')?.phone;
      if (!waNumber(b.phone || callFallback || pkg?.contact_number)) throw new BadRequestException('The Chat button needs a valid WhatsApp number, for example 06 12 34 56 78 or +33 6 12 34 56 78');
      // dynamic link: the per-send suffix is <itineraryId>.<buttonPosition>
      meta.push({ type: 'URL', text, url: `${PUBLIC_API_BASE}/api/integrations/whatsapp/chat/{{1}}`, example: [`${PUBLIC_API_BASE}/api/integrations/whatsapp/chat/00000000-0000-0000-0000-000000000000.1`] });
      quickReplyIndexes.push(index);
    }
  });
  // The signature feeds the Meta template NAME (submitButtonTemplate), which is how an
  // existing, already-approved template gets reused instead of submitting a redundant one for
  // genuinely identical content. It used to hash only the buttons -- so two packages (or the
  // same package re-uploaded with a new file) sharing the same button setup but DIFFERENT
  // itinerary documents collided on the same template name, and submitting just silently
  // reattached whichever old template already existed under that name, never actually
  // submitting the new file to Meta at all. The document is the template's own header media, so
  // it has to be part of what makes a template's identity unique, same as the buttons are.
  // The header-format detection (IMAGE vs DOCUMENT) used to be hardcoded, so a template approved
  // before that fix can be stuck mismatched (approved as DOCUMENT for a file we now correctly
  // detect as an image) with NO way to edit it after the fact on Meta's side. The "adopt an
  // existing template by name" recovery (added after the file-already-exists error) made that
  // worse by silently re-attaching the exact same stuck template. Folding the format hint into
  // the signature means a format-detection fix always produces a brand-new name, so there is
  // nothing stale left to collide with or get wrongly re-adopted.
  const fmtHint = metaHeaderMedia(pkg?.itinerary_pdf_file_name || '').headerFormat === 'IMAGE' ? 'img' : 'doc';
  const signature = createHash('sha1').update(JSON.stringify(meta) + '|' + (pkg?.itinerary_pdf_object_key || '') + '|' + fmtHint).digest('hex').slice(0, 10);
  return { meta, quickReplyIndexes, durationButtonIndex, signature, ordered };
}
const isButtonTemplate = (name: string) => /^campaign_itinerary_v\d+_/.test(String(name || ''));

// Every template submission hardcoded its HEADER as format:'DOCUMENT' regardless of what was
// actually uploaded -- an itinerary saved as a PNG/JPG still got submitted to Meta as a
// generic document, mismatching the real file type ("it is failing to find out what kind of
// format it is"). Meta's template header only has two media formats worth distinguishing here:
// IMAGE (png/jpeg) or DOCUMENT (everything else, PDF included). Falls back to the file
// extension when R2's own Content-Type response is missing/generic, instead of always
// defaulting to application/pdf regardless of the real file.
function metaHeaderMedia(fileName: string, contentTypeHeader?: string | null): { headerFormat: 'IMAGE' | 'DOCUMENT'; mimeType: string } {
  const ext = (String(fileName || '').match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  const extMime: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
  const header = (contentTypeHeader || '').toLowerCase();
  const mimeType = (header && header !== 'application/octet-stream' ? header : extMime[ext]) || 'application/pdf';
  const headerFormat: 'IMAGE' | 'DOCUMENT' = /^image\/(png|jpe?g)$/i.test(mimeType) ? 'IMAGE' : 'DOCUMENT';
  return { headerFormat, mimeType };
}

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

// A phone number as WhatsApp wants it: country code + number, digits only. Indian mobiles are
// recognised as before; a 10-digit number starting with 0 is French (06 12 34 56 78 -> 33612345678);
// anything else must already carry its country code (+44..., 0044...).
export function waNumber(value: string | null | undefined): string | null {
  const indian = normalizeIndianMobile(String(value || ''));
  if (indian) return `91${indian}`;
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('0')) digits = `33${digits.slice(1)}`;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

// A waNumber() for people to read: +91 98437 80129, +33 6 12 34 56 78, else +<digits>.
export function displayPhone(full: string): string {
  if (/^91\d{10}$/.test(full)) return `+91 ${full.slice(2, 7)} ${full.slice(7)}`;
  if (/^33\d{9}$/.test(full)) return `+33 ${full.slice(2, 3)} ${full.slice(3).replace(/(\d{2})(?=\d)/g, '$1 ')}`;
  return `+${full}`;
}
const CALLBACK_PAYLOAD = 'CALLBACK_REQUEST';

const GREETING =
  "Hi! 👋 Welcome to Errances Voyages. Tap \"View Packages\" below to browse our tour packages — we'll send you the full itinerary for whichever one you pick.";

interface WhatsAppConfig {
  phone_number_id: string;
  business_account_id: string;
  access_token: string;
  // 'twilio' when WhatsApp goes through Twilio (TWILIO_* settings); otherwise Meta's Cloud API.
  provider?: 'meta' | 'twilio';
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
    private twilio: TwilioWhatsAppService,
  ) {}

  // Safety net for the other failure mode: a lead that never even got an attempt
  // (the auto-trigger didn't fire at all -- e.g. it arrived on a new WhatsApp
  // contact whose lead record only appeared after the package went active).
  // Every 20 minutes, for every active+approved package, find leads matching its
  // destination with zero itinerary log rows ever, try sending to them now
  // (sendItineraryForLead's own dedup guard makes this safe to run repeatedly),
  // and alert with a tally either way so a missed lead is never just silence.
  onModuleInit() {
    // Twilio reports a template's WhatsApp approval decision by being asked (it has no webhook for
    // it); each decision goes through the same handler as Meta's template-status webhook, and also
    // updates the shared itinerary template that handler does not cover.
    this.twilio.onTemplateStatus(async (e) => {
      await this.pool.query(
        `UPDATE whatsapp_automation_settings SET itinerary_template_status=$2, itinerary_template_rejection_reason=$3, itinerary_template_checked_at=now(), updated_at=now() WHERE itinerary_template_id=$1`,
        [e.contentSid, e.status, e.reason],
      ).catch(() => undefined);
      await this.processWebhookPayload({ entry: [{ changes: [{ field: 'message_template_status_update', value: { message_template_id: e.contentSid, message_template_name: e.name, event: e.status, reason: e.reason } }] }] });
    });

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
    // those and relabels them honestly as unconfirmed, alerting a human to check and resend by hand
    // if needed (no longer auto-resent -- see reconcileUnconfirmedSends for why).
    const reconcile = () => this.reconcileUnconfirmedSends().catch((err) => this.logger.error(`reconcileUnconfirmedSends crashed: ${err.message}`));
    setInterval(reconcile, 30 * 60 * 1000);
    setTimeout(reconcile, 90 * 1000);

    // Circuit breaker: a campaign whose sends are visibly piling up unconfirmed (Meta throttling
    // it) gets automatic sending switched off for that campaign specifically -- new leads and
    // backlog sends both stop -- until the same check sees it's healthy again and switches it
    // back on by itself. This never touches the person's own "Active" toggle, only this separate
    // flag, so nothing about their own settings is ever silently changed.
    const autoPause = () => this.checkAutoPause().catch((err) => this.logger.error(`checkAutoPause crashed: ${err.message}`));
    setInterval(autoPause, 15 * 60 * 1000);
    setTimeout(autoPause, 60 * 1000);

    // catchUpAdditionalDocuments (auto-pushing every approved extra document to everyone who
    // already has the primary) is disabled -- it's the same auto-send-everything behavior removed
    // from dispatchItinerary above, for the same reason: additional itineraries now only go out
    // when a customer actually taps "Explore More Itineraries", never pushed automatically.
  }

  private async checkAutoPause() {
    const { rows: packages } = await this.pool.query(
      `SELECT id, name, auto_paused, auto_pause_count, auto_pause_window_started_at FROM tour_packages
        WHERE is_deleted=false AND is_active=true AND whatsapp_template_status='APPROVED'`,
    );
    for (const pkg of packages) {
      const health = await this.recentDeliveryHealth(pkg.id);
      const windowStarted = pkg.auto_pause_window_started_at ? new Date(pkg.auto_pause_window_started_at).getTime() : 0;
      const windowFresh = Date.now() - windowStarted < 24 * 3600 * 1000;
      const pauseCount = windowFresh ? (pkg.auto_pause_count ?? 0) : 0;
      if (!pkg.auto_paused && health.stuckCount >= 10) {
        await this.pool.query(
          `UPDATE tour_packages SET auto_paused=true, auto_paused_at=now(), auto_pause_count=$2,
             auto_pause_window_started_at = COALESCE(auto_pause_window_started_at, now()) WHERE id=$1`,
          [pkg.id, pauseCount + 1],
        );
        this.logger.warn(`checkAutoPause: paused "${pkg.name}" -- ${health.stuckCount} sends stuck unconfirmed (pause #${pauseCount + 1} in 24h)`);
        this.push.notifyAll({
          title: `Auto-paused: ${pkg.name}`,
          body: `Meta isn't confirming delivery for ${health.stuckCount} recent sends -- automatic sending is paused for this itinerary and will resume on its own once it clears.`,
          url: '/packages',
        }).catch(() => undefined);
      } else if (pkg.auto_paused) {
        // After repeated pauses in the same 24h window, require the count to be fully clear
        // (not just below the pause threshold) before trusting it's actually recovered --
        // a campaign that keeps tripping the same wall needs a firmer bar to resume automatically.
        const recovered = pauseCount >= 3 ? health.stuckCount === 0 : health.stuckCount < 3;
        if (recovered) {
          await this.pool.query(`UPDATE tour_packages SET auto_paused=false, auto_paused_at=NULL WHERE id=$1`, [pkg.id]);
          this.logger.log(`checkAutoPause: resumed "${pkg.name}" -- delivery confirmations back to normal`);
          this.push.notifyAll({
            title: `Resumed: ${pkg.name}`,
            body: `Delivery confirmations are back to normal -- automatic sending has resumed for this itinerary.`,
            url: '/packages',
          }).catch(() => undefined);
        }
      }
    }
  }

  // Anything still sitting at 'accepted' 2+ hours after we sent it has had more than enough time for
  // Meta's normal delivery webhook (which usually lands in seconds). Relabel it 'unconfirmed' --
  // never "sent", because we genuinely do not know -- and alert staff by name so nobody has to be
  // told by an angry customer that "the CRM said it was sent."
  //
  // This used to auto-resend on this same signal, which was wrong: a missing webhook is not proof
  // the message failed -- Meta's delivery webhooks can simply be slow or never arrive even when the
  // customer received it fine. Auto-resending on that guess meant real customers were getting the
  // exact same itinerary sent to them twice (confirmed via whatsapp_logs: ~150/day relabelled
  // unconfirmed, every one of them auto-resent). Since there is no way to actually check whether a
  // past message was delivered, the only honest thing to do is surface it for a human to look at and
  // decide (Failed WhatsApp page already has a manual "Resend" action) -- not guess on their behalf.
  private async reconcileUnconfirmedSends() {
    const { rows } = await this.pool.query(
      `UPDATE whatsapp_logs SET status = 'unconfirmed',
              error_message = 'Meta accepted this message but never confirmed delivery within 2 hours. We cannot verify whether it reached the customer -- WhatsApp gives no way to check after the fact, only automatic webhooks, which did not arrive for this one. Check with the customer before resending, since it may have already reached them.'
        WHERE message_type = 'itinerary' AND status = 'accepted' AND is_deleted = false AND created_at < now() - interval '2 hours'
        RETURNING id, lead_id, package_id, to_number`,
    );
    if (!rows.length) return;
    const { rows: named } = await this.pool.query(
      `SELECT w.id, l.customer_name, l.destination FROM whatsapp_logs w JOIN leads l ON l.id = w.lead_id WHERE w.id = ANY($1::uuid[])`,
      [rows.map((r: any) => r.id)],
    );
    this.logger.warn(`reconcileUnconfirmedSends: ${rows.length} itinerary sends never got a delivery confirmation from Meta -- relabelled unconfirmed for manual review (no longer auto-resent): ${named.map((n: any) => n.customer_name).slice(0, 5).join(', ')}`);
    this.push.notifyAll({
      title: `${rows.length} WhatsApp itinerar${rows.length > 1 ? 'ies never' : 'y never'} confirmed delivered`,
      body: `Meta accepted ${rows.length > 1 ? 'these sends' : 'this send'} but never confirmed delivery -- we cannot tell if it reached them, so it was NOT auto-resent. Review and resend by hand only if needed: ${named.slice(0, 3).map((n: any) => n.customer_name).join(', ')}${named.length > 3 ? '…' : ''}`,
      url: '/failed-whatsapp',
    }).catch(() => undefined);
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
      // Additional documents used to auto-follow the primary on every send path -- that directly
      // defeated the "Explore More Itineraries" interactive picker added later: by the time a
      // customer tapped it, every document had already been blasted at them automatically, so the
      // button either had nothing left to offer or never got a chance to matter. The picker is
      // now the ONLY way additional documents go out -- removed here on purpose.
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
    if (!rawBody || !signatureHeader) {
      // Never silent again: a missing raw body is a server bug, not a bad secret.
      this.lastRejectedAt = new Date();
      this.logger.warn(`WhatsApp webhook rejected: ${!rawBody ? 'raw request body not available (server body-parser setup)' : 'no X-Hub-Signature-256 header'}`);
      return false;
    }
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
      const res = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/app?access_token=${encodeURIComponent(appId + '|' + secret)}`);
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
    const out: any = { configured: false, tokenValid: false, appId: null, appName: null, secretSource: null, secretValid: false, subscribed: false, inboundCount: 0, lastInboundAt: null, lastRejectedAt: this.lastRejectedAt, recentOutboundCount: 0, inboundStale: false };
    const config = await this.getConfig();
    if (!config) return out;
    out.configured = true;
    const twilio = config.provider === 'twilio';
    if (twilio) {
      // Twilio signs its webhooks with the auth token, so a working token is also the "secret";
      // "subscribed" means the sender is online and its webhook points at this CRM.
      const h = await this.twilio.health();
      Object.assign(out, {
        provider: 'twilio', sender: this.twilio.from.replace('whatsapp:', ''), senderName: h.senderName, senderStatus: h.senderStatus,
        tokenValid: h.tokenValid, appId: 'twilio', appName: h.accountName ? `Twilio - ${h.accountName}` : 'Twilio',
        secretValid: h.tokenValid, secretSource: 'server', subscribed: h.webhookOk && h.senderStatus === 'ONLINE',
      });
    }
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    if (!twilio) try {
      const res = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/debug_token?input_token=${encodeURIComponent(config.access_token)}&access_token=${encodeURIComponent(config.access_token)}`);
      const data: any = await res.json();
      out.tokenValid = !!data?.data?.is_valid;
      out.appId = data?.data?.app_id ?? null;
      out.appName = data?.data?.application ?? null;
    } catch { /* leave defaults */ }
    if (out.appId && !twilio) {
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
        const res = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${config.business_account_id}/subscribed_apps?access_token=${encodeURIComponent(config.access_token)}`);
        const data: any = await res.json();
        out.subscribed = (data?.data || []).some((x: any) => String(x?.whatsapp_business_api_data?.id) === String(out.appId));
      } catch { /* leave default */ }
    }
    const { rows: stats } = await this.pool.query(`SELECT count(*)::int AS n, max(created_at) AS last FROM whatsapp_messages WHERE direction = 'in'`).catch(() => ({ rows: [{ n: 0, last: null }] }));
    out.inboundCount = stats[0]?.n ?? 0;
    out.lastInboundAt = stats[0]?.last ?? null;
    // Meta's subscribed_apps check only confirms the App itself is subscribed to this WABA at
    // all -- it does NOT confirm the specific "messages" webhook FIELD is still checked in the
    // App Dashboard, which is a separate toggle Meta doesn't expose a clean API answer for. This
    // is the real, concrete signal instead: has ANY customer reply/button-tap actually arrived in
    // the last 24h while the business is otherwise active (recent outbound sends exist)? If sends
    // are going out but nothing is coming back for a full day, that's exactly the silent
    // webhook-unsubscribed failure mode that sat undetected for days before -- surfaced here
    // instead of only being discoverable by someone manually comparing timestamps in the database.
    const { rows: outboundRecent } = await this.pool.query(`SELECT count(*)::int AS n FROM whatsapp_messages WHERE direction='out' AND created_at > now() - interval '24 hours'`).catch(() => ({ rows: [{ n: 0 }] }));
    out.recentOutboundCount = outboundRecent[0]?.n ?? 0;
    out.inboundStale = out.recentOutboundCount > 0 && (!out.lastInboundAt || Date.now() - new Date(out.lastInboundAt).getTime() > 24 * 3600 * 1000);
    // Straight from Meta, not inferred: this is what actually decides whether
    // "healthy ecosystem engagement" throttling hits you. GREEN/STANDARD means
    // the account itself is in good standing -- throttling is then almost
    // always about sending pace, not account quality.
    out.qualityRating = null;
    out.throughputTier = null;
    if (twilio) {
      const h = await this.twilio.health();
      out.qualityRating = ({ HIGH: 'GREEN', MEDIUM: 'YELLOW', LOW: 'RED' } as Record<string, string>)[String(h.quality || '').toUpperCase()] ?? null;
      out.throughputTier = h.throughput;
      return out;
    }
    try {
      const res = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${config.phone_number_id}?fields=quality_rating,throughput&access_token=${encodeURIComponent(config.access_token)}`);
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

  // Twilio inbound (form fields) -> the same processing as a Cloud API webhook. A message id we
  // already stored is skipped, so a repeated webhook never doubles a message or a reply.
  // Message SIDs being handled right now: a Twilio retry can arrive before the first delivery is stored.
  private twilioInFlight = new Set<string>();

  async processTwilioInbound(params: Record<string, string>): Promise<void> {
    const sid = params?.MessageSid;
    if (sid) {
      if (this.twilioInFlight.has(sid)) return;
      this.twilioInFlight.add(sid);
    }
    try {
      if (sid) {
        const { rows } = await this.pool.query(`SELECT 1 FROM whatsapp_messages WHERE wa_message_id = $1 LIMIT 1`, [sid]);
        if (rows.length) return;
      }
      await this.processWebhookPayload(this.twilio.toCloudInbound(params));
    } finally {
      if (sid) this.twilioInFlight.delete(sid);
    }
  }

  async processTwilioStatus(params: Record<string, string>): Promise<void> {
    const payload = this.twilio.toCloudStatus(params);
    if (!payload) return;
    // A bulk WhatsApp recipient's delivery state (never moved backwards by a late event).
    const status = payload.entry[0].changes[0].value.statuses[0];
    await this.pool.query(
      `UPDATE whatsapp_broadcast_recipients SET status = $2, error = $3, updated_at = now()
        WHERE message_sid = $1 AND (CASE status WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 WHEN 'sent' THEN 1 WHEN 'failed' THEN 4 ELSE 0 END) <= $4`,
      [status.id, status.status, status.errors?.[0]?.title ?? null, ({ sent: 1, delivered: 2, read: 3, failed: 4 } as Record<string, number>)[status.status] ?? 0],
    ).catch(() => undefined);
    await this.processWebhookPayload(payload);
  }

  // Customer messages Twilio received while the CRM could not take them (e.g. its webhook address
  // was missing): stored and notified now, with no automatic reply. Safe to run more than once.
  async recoverTwilioInbound(since: string) {
    if (!this.twilio.isConfigured()) throw new BadRequestException('Twilio is not configured');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(since || '')) ? since : new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const found = await this.twilio.listInboundSince(day);
    let recovered = 0;
    for (const m of found) {
      const { rows } = await this.pool.query(`SELECT 1 FROM whatsapp_messages WHERE wa_message_id = $1 LIMIT 1`, [m.sid]);
      if (rows.length) continue;
      const params: Record<string, string> = { MessageSid: m.sid, From: m.from, WaId: m.from.replace(/\D/g, ''), Body: m.body, NumMedia: String(m.media.length) };
      if (m.media[0]) { params.MediaUrl0 = m.media[0].url; params.MediaContentType0 = m.media[0].contentType; }
      await this.processWebhookPayload(this.twilio.toCloudInbound(params, { recovered: true, timestamp: Math.floor(new Date(m.dateSent).getTime() / 1000) }));
      recovered++;
    }
    return { since: day, checked: found.length, recovered };
  }

  async processWebhookPayload(body: any): Promise<void> {
    const entries = body?.entry ?? [];
    for (const entry of entries) {
      const changes = entry?.changes ?? [];
      for (const change of changes) {
        // Meta pushes this the instant a template is actually reviewed -- approved, rejected,
        // paused, etc -- rather than making every page wait for someone to click "Sync" or
        // reload. The review itself still takes however long Meta's own moderation takes (that
        // part is entirely on Meta's side, not something any business can speed up), but this
        // closes the gap between "Meta decided" and "the CRM shows it" to effectively zero.
        // One template can belong to a package's primary itinerary, an additional document, the
        // daily report, or the quotation-ready template -- all four get checked since there's no
        // cheap way to know in advance which one this event is about.
        if (change?.field === 'message_template_status_update') {
          const v = change.value ?? {};
          const templateId = String(v.message_template_id ?? '').trim();
          const status = String(v.event ?? '').toUpperCase().trim();
          const reason = v.reason ? String(v.reason) : null;
          if (templateId && status) {
            await Promise.all([
              this.pool.query(`UPDATE tour_packages SET whatsapp_template_status=$2, whatsapp_template_rejection_reason=$3, whatsapp_template_checked_at=now(), updated_at=now() WHERE whatsapp_template_id=$1`, [templateId, status, reason]),
              this.pool.query(`UPDATE package_itinerary_documents SET whatsapp_template_status=$2, whatsapp_template_rejection_reason=$3, whatsapp_template_checked_at=now(), updated_at=now() WHERE whatsapp_template_id=$1`, [templateId, status, reason]),
              this.pool.query(`UPDATE daily_report_settings SET template_status=$2, template_rejection_reason=$3, updated_at=now() WHERE template_id=$1`, [templateId, status, reason]),
              this.pool.query(`UPDATE quotation_template_settings SET template_status=$2, template_rejection_reason=$3, checked_at=now() WHERE template_id=$1`, [templateId, status, reason]),
            ]).catch((err) => this.logger.error(`message_template_status_update sync failed for ${templateId}: ${err.message}`));
            this.realtime.broadcastTemplateStatusUpdate({ templateId, status });
            this.logger.log(`Template ${templateId} (${v.message_template_name || 'unknown'}) status update: ${status}`);
            // Previously only the in-app status chip changed -- nothing told anyone unless they
            // happened to have that page open. A rejection/pause/disable is exactly the kind of
            // thing that otherwise sits unnoticed until someone later wonders why a customer never
            // got their itinerary, so this fires a real push notification the instant Meta decides,
            // not just a socket event only an open tab would see.
            if (['REJECTED', 'PAUSED', 'DISABLED'].includes(status)) {
              this.push.notifyAll({
                title: `WhatsApp rejected a template — ${v.message_template_name || 'itinerary'}`,
                body: reason ? reason.slice(0, 150) : 'Open the itinerary to see why and resubmit.',
                url: '/packages',
              }).catch((err: any) => this.logger.error(`Push notify failed for template rejection: ${err.message}`));
            }
          }
          continue;
        }
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
        if (change?.field === 'smb_message_echoes') {
          for (const echo of value.message_echoes ?? []) {
            await this.storeEchoMessage(echo).catch((err) => this.logger.warn(`Could not store phone-app echo: ${err.message}`));
          }
          continue;
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
    const result = await this.sendDocumentTemplate(config, normalized, pkg.whatsapp_template_name, link, pkg.itinerary_pdf_file_name || `${pkg.name}.pdf`, pkg.description || `Please review the ${pkg.name} itinerary.`, pkg.contact_name || 'Errances Voyages', pkg.contact_number || '', pkg);
    // Test sends used to record leadId=null, which left "Explore More Itineraries" unable to work
    // at all when YOU reply on the test number: it looks up what package was last sent via
    // whatsapp_logs.lead_id, and a null lead_id there is simply never found. A real lead record
    // (find-or-create, same as a genuine customer's first reply) makes a test number behave
    // exactly like a real customer end-to-end, including the duration picker.
    const leadId = await this.upsertLead(normalized, 'Test contact').catch((err) => {
      this.logger.error(`Could not resolve a lead for test number ${normalized}: ${err.message}`);
      return undefined;
    });
    // A repeat test send to the same number/package hits the same partial unique index
    // (uq_itinerary_claim) that stops a real customer getting the itinerary twice -- update the
    // existing row instead of failing, since re-testing the same combination is expected here.
    try {
      await this.pool.query(
        `INSERT INTO whatsapp_logs(to_number,template_name,status,sent_at,message_id,package_id,message_type,lead_id)
         VALUES($1,$2,'accepted',now(),$3,$4,'itinerary',$5)`,
        [normalized, pkg.whatsapp_template_name, result?.messages?.[0]?.id ?? null, packageId, leadId ?? null],
      );
    } catch (err: any) {
      if (err.code !== '23505') throw err;
      await this.pool.query(
        `UPDATE whatsapp_logs SET template_name=$2, status='accepted', sent_at=now(), message_id=$3, lead_id=$5
         WHERE to_number=$1 AND package_id=$4 AND message_type='itinerary' AND is_deleted=false`,
        [normalized, pkg.whatsapp_template_name, result?.messages?.[0]?.id ?? null, packageId, leadId ?? null],
      );
    }
    // broadcast:false -- a test send now has a real leadId (so the duration picker works), but
    // it's still not a real customer getting their itinerary; staff shouldn't get an "itinerary
    // sent" push notification every time someone clicks Test.
    await this.recordItineraryMessage({ ...pkg, id: packageId }, normalized, leadId ?? null, null, result?.messages?.[0]?.id ?? null, undefined, { broadcast: false });
    // A test send deliberately mirrors exactly what a real customer gets: the primary message and
    // the "Explore More Itineraries" button -- additional documents are no longer auto-pushed
    // anywhere (see dispatchItinerary), so a test shouldn't auto-push them either.
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
      return this.submitButtonTemplate(config, pkg, waNumber(pkg.contact_number));
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
    const { headerFormat, mimeType: fileType } = metaHeaderMedia(pkg.itinerary_pdf_file_name, fileResponse.headers.get('content-type'));
    const appId = await this.resolveMetaAppId(config.access_token);
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const sessionResponse = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${appId}/uploads?file_length=${bytes.length}&file_type=${encodeURIComponent(fileType)}&access_token=${encodeURIComponent(config.access_token)}`, { method:'POST' });
    const session: any = await sessionResponse.json();
    if (!sessionResponse.ok || !session.id) throw new BadRequestException(`Meta upload session failed: ${session?.error?.message || sessionResponse.status}`);
    const uploadResponse = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${session.id}`, {
      method:'POST', headers:{ Authorization:`OAuth ${config.access_token}`, file_offset:'0', 'Content-Type':fileType }, body:bytes,
    });
    const upload: any = await uploadResponse.json();
    if (!uploadResponse.ok || !upload.h) throw new BadRequestException(`Meta document upload failed: ${upload?.error?.message || uploadResponse.status}`);
    const bodyText = `{{1}}\n\nYour travel consultant: {{2}}\nCall or WhatsApp: {{3}}`;
    const createResponse = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${config.business_account_id}/message_templates`, {
      method:'POST', headers:{ Authorization:`Bearer ${config.access_token}`, 'Content-Type':'application/json' },
      body:JSON.stringify({ name:templateName, language:'en_US', category:'MARKETING', components:[
        { type:'HEADER', format:headerFormat, example:{ header_handle:[upload.h] } },
        { type:'BODY', text:bodyText, example:{ body_text:[[`Thank you for your interest. Please review the attached itinerary.`,'Errances Voyages','+33 1 23 45 67 89']] } },
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

  // Additional itinerary documents beyond the primary one -- "Add another" in the CRM, no fixed
  // limit. Each one is its own WhatsApp template (Meta allows only one document per template),
  // submitted and approved independently.
  async submitAdditionalDocumentTemplate(documentId: string) {
    const config = await this.getConfig();
    if (!config?.business_account_id) throw new BadRequestException('WhatsApp Business Account ID is missing in Settings');
    const { rows: docRows } = await this.pool.query(`SELECT * FROM package_itinerary_documents WHERE id=$1`, [documentId]);
    const doc = docRows[0];
    if (!doc) throw new BadRequestException('Document not found');
    if (!doc.object_key) throw new BadRequestException('Upload the document first');
    // A document already approved under an older template naming (_v2 and earlier) has the old,
    // joined-line body text baked in -- only re-check status for one already on the current
    // naming; anything older falls through and gets freshly resubmitted under the new name.
    const onCurrentFormat = /^campaign_itinerary_doc_v(?:[3-9]|\d\d)_/.test(String(doc.whatsapp_template_name || ''));
    if (onCurrentFormat && doc.whatsapp_template_id && doc.whatsapp_template_status && !['REJECTED', 'PAUSED', 'DISABLED'].includes(doc.whatsapp_template_status)) {
      return this.syncAdditionalDocumentTemplateStatus(documentId);
    }
    const { rows: pkgRows } = await this.pool.query(`SELECT buttons, contact_number, description, name FROM tour_packages WHERE id=$1 AND is_deleted=false`, [doc.package_id]);
    const pkg = pkgRows[0];
    const { meta: metaButtons } = buildMetaButtons(pkg ?? {});
    const national = waNumber(pkg?.contact_number) ? displayPhone(waNumber(pkg?.contact_number)!) : '';
    // Same message as the primary itinerary's own template -- only the download line's day/night
    // count differs, since that's the one part of the text that's actually specific to this document.
    // Two separate slots (hook, offer) instead of one joined string, so they land on their own
    // lines in the delivered message rather than running together.
    const [, samePkgP2, samePkgP3] = splitItineraryMessage3(pkg?.description || `Please review the ${pkg?.name || 'itinerary'}.`);
    // v4 (not v3) and a format tag in the name -- v3 names were approved back when header format
    // detection was hardcoded wrong, and the later "adopt existing template by name" recovery
    // just kept re-attaching those same stuck-wrong templates since the name never changed. This
    // guarantees a clean break: nothing under v4_img_/v4_doc_ has ever existed, so creation always
    // actually happens instead of silently adopting old broken content.
    const fmtTag = metaHeaderMedia(doc.file_name).headerFormat === 'IMAGE' ? 'img' : 'doc';
    const templateName = `campaign_itinerary_doc_v4_${fmtTag}_${String(documentId).replace(/-/g, '').slice(0, 16)}`;
    const version0 = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    // This template name is deterministic per document id (not per submission attempt) -- a
    // resubmission of the SAME document (e.g. after we reset its local status, as happened for
    // the header-format fix) reuses the exact same name, and Meta then refuses to create a
    // second template under a name it already has content for ("There is already English (US)
    // content for this template"). The primary package's own submit path already looks the
    // existing template up on Meta by name and adopts it instead of blindly re-creating -- this
    // did the same check locally (see the on-current-format branch above) but never checked
    // Meta itself, so a local-only reset (nothing wrong on Meta's side) always hit this wall.
    const lookup: any = await this.twilio.graphFetch(`https://graph.facebook.com/${version0}/${config.business_account_id}/message_templates?name=${encodeURIComponent(templateName)}&fields=id,name,status&access_token=${encodeURIComponent(config.access_token)}`).then((r) => r.json()).catch(() => null);
    const already = lookup?.data?.find((t: any) => t.name === templateName);
    if (already) {
      const { rows: adopted } = await this.pool.query(
        `UPDATE package_itinerary_documents SET whatsapp_template_id=$2, whatsapp_template_name=$3, whatsapp_template_status=$4,
         whatsapp_template_rejection_reason=NULL, whatsapp_template_submitted_at=COALESCE(whatsapp_template_submitted_at, now()), whatsapp_template_checked_at=now(), updated_at=now()
         WHERE id=$1 RETURNING *`, [documentId, already.id, templateName, String(already.status || 'PENDING').toUpperCase()],
      );
      return adopted[0];
    }
    const link = await this.r2.getPresignedDownloadUrl(doc.object_key, 600);
    const fileResponse = await fetch(link);
    if (!fileResponse.ok) throw new BadRequestException('Could not read the document for Meta submission');
    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    const { headerFormat, mimeType: fileType } = metaHeaderMedia(doc.file_name, fileResponse.headers.get('content-type'));
    const appId = await this.resolveMetaAppId(config.access_token);
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const sessionResponse = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${appId}/uploads?file_length=${bytes.length}&file_type=${encodeURIComponent(fileType)}&access_token=${encodeURIComponent(config.access_token)}`, { method: 'POST' });
    const session: any = await sessionResponse.json();
    if (!sessionResponse.ok || !session.id) throw new BadRequestException(`Meta upload session failed: ${session?.error?.message || sessionResponse.status}`);
    const uploadResponse = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${session.id}`, {
      method: 'POST', headers: { Authorization: `OAuth ${config.access_token}`, file_offset: '0', 'Content-Type': fileType }, body: bytes,
    });
    const upload: any = await uploadResponse.json();
    if (!uploadResponse.ok || !upload.h) throw new BadRequestException(`Meta document upload failed: ${upload?.error?.message || uploadResponse.status}`);
    const durationLabel = doc.duration_days ? `${doc.duration_days} Day${doc.duration_days === 1 ? '' : 's'} / ${doc.duration_nights ?? 0} Night${doc.duration_nights === 1 ? '' : 's'} ` : '';
    const createResponse = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${config.business_account_id}/message_templates`, {
      method: 'POST', headers: { Authorization: `Bearer ${config.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: templateName, language: 'en_US', category: 'MARKETING', components: [
        { type: 'HEADER', format: headerFormat, example: { header_handle: [upload.h] } },
        { type: 'BODY', text: `Dear {{1}},\n\n📥 Download your ${durationLabel}itinerary above👆.\n\n{{2}}\n\n{{3}}\n\nYour expert: *{{4}}* — tap a button below to get in touch.`, example: { body_text: [['Mr. Ramesh', samePkgP2.slice(0, 450) || 'Dreaming of a holiday but worried about planning and cost?', samePkgP3.slice(0, 450) || 'We have a ready itinerary with handpicked stays and sightseeing, all within your budget.', `Errances Voyages · ${national || '+33 1 23 45 67 89'}`]] } },
        ...(metaButtons.length ? [{ type: 'BUTTONS', buttons: metaButtons }] : []),
      ] }),
    });
    const created: any = await createResponse.json();
    if (!createResponse.ok || !created.id) throw new BadRequestException(`Meta template submission failed: ${created?.error?.error_user_msg || created?.error?.message || createResponse.status}`);
    const status = String(created.status || 'PENDING').toUpperCase();
    const { rows: updated } = await this.pool.query(
      `UPDATE package_itinerary_documents SET whatsapp_template_id=$2, whatsapp_template_name=$3, whatsapp_template_status=$4,
       whatsapp_template_rejection_reason=NULL, whatsapp_template_submitted_at=now(), whatsapp_template_checked_at=now(), updated_at=now()
       WHERE id=$1 RETURNING *`, [documentId, created.id, templateName, status],
    );
    return updated[0];
  }

  async syncAdditionalDocumentTemplateStatus(documentId: string) {
    const config = await this.getConfig();
    if (!config) throw new BadRequestException('WhatsApp is not configured');
    const { rows } = await this.pool.query(`SELECT whatsapp_template_id FROM package_itinerary_documents WHERE id=$1`, [documentId]);
    const templateId = rows[0]?.whatsapp_template_id;
    if (!templateId) throw new BadRequestException('No template submitted yet for this document');
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const response = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${templateId}?fields=id,name,status,category,language,quality_score,rejected_reason,last_updated_time&access_token=${encodeURIComponent(config.access_token)}`);
    const data: any = await response.json();
    if (!response.ok) throw new BadRequestException(`Could not read Meta template status: ${data?.error?.message || response.status}`);
    const status = String(data.status || 'PENDING').toUpperCase();
    const { rows: updated } = await this.pool.query(
      `UPDATE package_itinerary_documents SET whatsapp_template_status=$2, whatsapp_template_rejection_reason=$3, whatsapp_template_checked_at=now(), updated_at=now()
        WHERE id=$1 RETURNING *`,
      [documentId, status, data.rejected_reason && data.rejected_reason !== 'NONE' ? data.rejected_reason : null],
    );
    // Category/quality/last-updated aren't persisted (same as the primary template's own status
    // check) -- returned alongside the row so the UI can show them right after a manual check.
    return {
      ...updated[0],
      meta_details: {
        name: data.name || null,
        category: data.category || null,
        language: data.language || null,
        quality: data.quality_score?.score || null,
        rejected_reason: data.rejected_reason && data.rejected_reason !== 'NONE' ? data.rejected_reason : null,
        last_updated: data.last_updated_time || null,
      },
    };
  }

  // Sends every additional document whose own template is approved, right after the primary
  // document sends -- so "send them all together" means one after another, since WhatsApp
  // allows only one document attachment per template message.
  // One template per consultant number: header document + message body +
  // "Call our consultant" (tap-to-call) + "Request a call back" buttons.
  // Packages using the same number share the same template, so a number only
  // needs Meta's approval once.
  private async submitButtonTemplate(config: WhatsAppConfig, pkg: any, contactMobile: string | null) {
    const national = contactMobile ? displayPhone(contactMobile) : '';
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
      const lookup: any = await (await this.twilio.graphFetch(`https://graph.facebook.com/${lookupVersion}/${config.business_account_id}/message_templates?name=${encodeURIComponent(templateName)}&fields=id,name,status&access_token=${encodeURIComponent(config.access_token)}`)).json().catch(() => null);
      const already = lookup?.data?.find((t: any) => t.name === templateName);
      if (already) { templateId = already.id; status = String(already.status || 'PENDING').toUpperCase(); }
    }

    if (!templateId) {
      const link = await this.r2.getPresignedDownloadUrl(pkg.itinerary_pdf_object_key, 600);
      const fileResponse = await fetch(link);
      if (!fileResponse.ok) throw new BadRequestException('Could not read the itinerary document for Meta submission');
      const bytes = Buffer.from(await fileResponse.arrayBuffer());
      const { headerFormat, mimeType: fileType } = metaHeaderMedia(pkg.itinerary_pdf_file_name, fileResponse.headers.get('content-type'));
      const appId = await this.resolveMetaAppId(config.access_token);
      const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
      const sessionResponse = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${appId}/uploads?file_length=${bytes.length}&file_type=${encodeURIComponent(fileType)}&access_token=${encodeURIComponent(config.access_token)}`, { method:'POST' });
      const session: any = await sessionResponse.json();
      if (!sessionResponse.ok || !session.id) throw new BadRequestException(`Meta upload session failed: ${session?.error?.message || sessionResponse.status}`);
      const uploadResponse = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${session.id}`, {
        method:'POST', headers:{ Authorization:`OAuth ${config.access_token}`, file_offset:'0', 'Content-Type':fileType }, body:bytes,
      });
      const upload: any = await uploadResponse.json();
      if (!uploadResponse.ok || !upload.h) throw new BadRequestException(`Meta document upload failed: ${upload?.error?.message || uploadResponse.status}`);
      const createResponse = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${config.business_account_id}/message_templates`, {
        method:'POST', headers:{ Authorization:`Bearer ${config.access_token}`, 'Content-Type':'application/json' },
        body:JSON.stringify({ name:templateName, language:'en_US', category:'MARKETING', components:[
          { type:'HEADER', format:headerFormat, example:{ header_handle:[upload.h] } },
          { type:'BODY', text:`Dear {{1}},\n\n{{2}}\n\n{{3}}\n\n{{4}}\n\nYour expert: *{{5}}* — tap a button below to get in touch.`, example:{ body_text:[['Mr. Ramesh','📥 Download your itinerary above👆.','Dreaming of a holiday but worried about planning and cost?','We have a ready itinerary with handpicked stays and sightseeing, all within your budget.',`Errances Voyages · ${national || '+33 1 23 45 67 89'}`]] } },
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
    const response = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${current.whatsapp_template_id}?fields=id,name,status,category,language,quality_score,rejected_reason,last_updated_time&access_token=${encodeURIComponent(config.access_token)}`);
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
    const response = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${templateId}?fields=id,name,status,rejected_reason&access_token=${encodeURIComponent(config.access_token)}`);
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

  // First WhatsApp to a new Meta lead. The owner's rule (2026-10-05): the customer gets ONLY the
  // itinerary template, with its Call / Chat / Explore buttons -- no separate "Thank you for
  // choosing... Reply YES" welcome before it (two messages back-to-back also raised Meta's spam
  // signals). A campaign with no ready itinerary sends nothing; the alert banner's "no itinerary
  // ready" problem is what flags those for staff.
  async sendLeadWelcomeTemplate(to: string, _customerName: string, _destination: string, leadId?: string) {
    const config = await this.getConfig();
    if (!config) throw new BadRequestException('WhatsApp is not configured');
    if (!leadId) return null;
    const digits = String(to).replace(/\D/g, '');
    const indian = normalizeIndianMobile(to);
    const normalized = indian ? `91${indian}` : digits;
    const sent = await this.sendItineraryForLead(config, normalized, leadId).catch((err) => {
      this.logger.error(`First itinerary send failed for lead ${leadId}: ${err.message}`);
      return false;
    });
    if (!sent) this.logger.warn(`No ready itinerary for new lead ${leadId} -- nothing sent automatically (welcome template retired)`);
    return null;
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
    if (this.twilio.isTwilioMediaUrl(media.id)) {
      const mimeType = String(media.mime_type || 'application/octet-stream');
      const ext = mimeType.split('/')[1]?.split(';')[0] || 'bin';
      const filename = String(media.filename || `${type}.${ext}`);
      const kind = type === 'sticker' ? 'image' : (type as 'image' | 'document' | 'audio' | 'video');
      // With file storage configured keep our own copy; otherwise the file stays at Twilio and the
      // inbox streams it from there (see messageMedia).
      if (this.r2.isConfigured()) {
        const file = await this.twilio.fetchMedia(media.id);
        if (file) {
          const { url } = await this.r2.uploadBuffer(file.body, 'whatsapp-inbound', filename, mimeType);
          return { kind, url, filename, mimeType, caption: media.caption };
        }
      }
      return { kind, url: media.id, filename, mimeType, caption: media.caption };
    }
    const config = await this.getConfig();
    if (!config || !this.r2.isConfigured()) return null;
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const auth = { Authorization: `Bearer ${config.access_token}` };
    const info: any = await (await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${media.id}`, { headers: auth })).json();
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

    const leadId = await this.upsertLead(from, contactName, message?.referral).catch((err) => {
      this.logger.error(`Failed to upsert CRM lead for WhatsApp contact ${from}: ${err.message}`, err.stack);
      return undefined;
    });

    const inboundText = String(message?.text?.body || message?.button?.text || message?.interactive?.button_reply?.title || message?.interactive?.list_reply?.title || `[${message?.type || 'message'}]`);
    const media = await this.fetchInboundMedia(message).catch((err) => { this.logger.warn(`Inbound media not stored: ${err.message}`); return null; });
    // How long Meta took to hand this message to us (minutes after the customer sent it).
    const sentAtMs = Number(message?.timestamp) * 1000;
    const lateMin = sentAtMs ? Math.max(0, Math.round((Date.now() - sentAtMs) / 60000)) : 0;
    if (media) {
      await this.storeMessage(from, leadId ?? null, 'in', media.caption || media.filename || inboundText, media.kind, message?.id, undefined, { url: media.url, filename: media.filename, mimeType: media.mimeType, ...(lateMin >= 5 ? { lateMin } : {}) }).catch(() => undefined);
    } else {
      // A button tap or swipe-reply carries the message it answers (context.id); keep a short
      // quote of it, the way WhatsApp shows it above the customer's reply.
      let replyTo: Record<string, unknown> | undefined;
      if (message?.context?.id) {
        const { rows: q } = await this.pool.query(`SELECT body, msg_type, direction, meta FROM whatsapp_messages WHERE wa_message_id = $1 LIMIT 1`, [message.context.id]).catch(() => ({ rows: [] as any[] }));
        if (q[0]) {
          const m = q[0].meta || {};
          const quoted = q[0].msg_type === 'itinerary' ? [m.greeting, ...(m.paragraphs || [])].filter(Boolean).join('\n') : String(q[0].body || '');
          replyTo = { from: q[0].direction === 'out' ? 'us' : 'customer', body: quoted.slice(0, 200), media: q[0].msg_type === 'itinerary' || ['image', 'document'].includes(q[0].msg_type), packageId: m.packageId ?? null };
        }
      }
      await this.storeMessage(from, leadId ?? null, 'in', inboundText, message?.type || 'text', message?.id, undefined, { ...(replyTo ? { replyTo } : {}), ...(lateMin >= 5 ? { lateMin } : {}) }).catch(() => undefined);
    }
    this.notifyInbound(from, leadId, contactName, inboundText).catch(() => undefined);

    // "STOP" takes a customer off bulk WhatsApp (recorded even when the message reaches us late);
    // "START" puts them back. Their one-to-one chat with staff is not affected.
    const word = String(message?.text?.body || '').trim().toLowerCase().replace(/[.!\s]+$/, '');
    const optOut = ['stop', 'stop all', 'unsubscribe', 'arret', 'arrêt', 'arreter', 'arrêter', 'desabonner', 'désabonner'].includes(word);
    if (optOut) await this.pool.query(`INSERT INTO whatsapp_opt_outs (phone) VALUES ($1) ON CONFLICT DO NOTHING`, [from]).catch(() => undefined);
    const optIn = ['start', 'subscribe', 'reprendre'].includes(word)
      && !!(await this.pool.query(`DELETE FROM whatsapp_opt_outs WHERE phone = $1`, [from]).catch(() => ({ rowCount: 0 }))).rowCount;

    // Recovered from Twilio's log after it could not reach the CRM: kept in the Inbox and notified
    // above, but never auto-answered hours later -- a person picks it up.
    if (message?.recovered) return;

    // Meta retries undelivered webhooks for days. A tap or message redelivered long after the
    // customer sent it (e.g. after an outage) is kept in the Inbox and notified to staff above, but
    // the bot does not auto-reply to it -- answering a week-old "Explore more" out of the blue would
    // confuse the customer. The cut-off is 12 hours, not 1: on 5 Oct 2026 Meta handed over most
    // messages one to several hours late (in batches) and every one of them went unanswered, while
    // the customer's 24-hour window was still open and a reply was exactly what they were waiting for.
    if (lateMin > 12 * 60) {
      this.logger.log(`Inbound from ${from} is ${lateMin} min old (redelivered) -- stored, no auto-reply`);
      return;
    }
    if (lateMin >= 5) this.logger.warn(`Inbound from ${from} reached us ${lateMin} min after the customer sent it -- replying now`);

    const config = await this.getConfig();
    if (!config) {
      this.logger.error('WhatsApp is not configured (Settings > WhatsApp) — cannot reply.');
      return;
    }

    if (optOut || optIn) {
      const reply = optOut
        ? 'You will no longer receive offers from Errances Voyages on WhatsApp. Reply START to receive them again.\n\nVous ne recevrez plus nos offres sur WhatsApp. Répondez START pour les recevoir à nouveau.'
        : 'Welcome back! You will receive offers from Errances Voyages on WhatsApp again.\n\nBon retour ! Vous recevrez à nouveau nos offres sur WhatsApp.';
      await this.sendText(config, from, reply).then((result: any) => this.storeMessage(from, leadId ?? null, 'out', reply, 'text', result?.messages?.[0]?.id)).catch(() => undefined);
      return;
    }

    // In the middle of the enquiry questions (see startEnquiry): this message is the answer.
    if (await this.continueEnquiry(config, from, leadId, contactName, message)) return;

    // Duration options arrive as a list row, or (3 or fewer options) as reply buttons -- same ids.
    const durButtonId = String(message?.interactive?.button_reply?.id || '');
    const listReplyId: string | undefined = message?.interactive?.list_reply?.id || (durButtonId.startsWith('dur:') ? durButtonId : undefined);

    if (listReplyId) {
      // "dur:<packageId>:<candidateId>" -- a tap on the duration-options list, not a package
      // pick from the generic menu. Checked first since both share the same list_reply field.
      if (listReplyId.startsWith('dur:') && leadId) {
        const [, pkgId, candidateId] = listReplyId.split(':');
        // "custom" sets its own 'awaiting_custom_duration' conversation state inside
        // handleDurationListReply (so the next free-text reply gets captured as that request)
        // -- the blanket 'completed' below would otherwise immediately stomp that state.
        if (candidateId === 'custom') {
          await this.handleDurationListReply(config, from, leadId, pkgId, candidateId).catch((err: any) => {
            this.logger.warn(`handleDurationListReply (custom) failed for lead ${leadId}: ${err.message}`);
          });
          return;
        }
        const handled = await this.handleDurationListReply(config, from, leadId, pkgId, candidateId).catch((err: any) => {
          this.logger.warn(`handleDurationListReply failed for lead ${leadId}: ${err.message}`);
          return false;
        });
        if (handled) { await this.upsertConversation(from, 'completed', { durationMatchSent: true }, contactName, leadId); return; }
      }
      await this.sendItinerary(config, from, listReplyId, leadId);
      await this.upsertConversation(from, 'completed', { lastPackageId: listReplyId }, contactName, leadId);
      return;
    }

    const buttonPayload = message?.button?.payload || message?.interactive?.button_reply?.id;
    const buttonLabel = String(message?.button?.text || message?.interactive?.button_reply?.title || '').toLowerCase();

    // The "Would you like to select another itinerary?" step after a pick (see
    // sendDurationCandidate) -- "Explore More Itineraries" reopens the duration list (which, once
    // everything's been sent, auto-falls-through to the call-our-experts flow itself -- see
    // sendDurationOptionsList), "Call our experts" goes straight to the same callback-request
    // flow as the button on the original package message.
    if (String(buttonPayload || '').startsWith('durmore:') && leadId) {
      const [, choice, pkgId] = String(buttonPayload).split(':');
      if (choice === 'yes') {
        const handled = await this.sendDurationOptionsList(config, from, leadId, undefined, pkgId || null).catch((err: any) => {
          this.logger.warn(`sendDurationOptionsList (durmore) failed for lead ${leadId}: ${err.message}`);
          return false;
        });
        if (handled) { await this.upsertConversation(from, 'awaiting_duration', { packageId: pkgId }, contactName, leadId); return; }
      } else {
        await this.handleCallbackRequest(config, from, contactName, leadId, 'Thank you. Our travel expert will call you shortly.');
        return;
      }
    }

    // Tapped "Choose Duration" -- show exactly what we have as a tappable list instead of
    // asking them to type one (see sendDurationOptionsList). Free-text duration asks (e.g.
    // someone just types "3N/4D" without tapping anything) are still handled further down as
    // a fallback.
    // Exact default label, or any wording containing "explore" (the button text is editable per
    // package, and Meta echoes back whatever text was approved).
    if ((buttonLabel === DURATION_BUTTON_TEXT.toLowerCase() || buttonLabel.includes('explore')) && leadId) {
      const tappedWaId: string | undefined = message?.context?.id;
      const { rows: tapped } = tappedWaId
        ? await this.pool.query(`SELECT package_id FROM whatsapp_logs WHERE message_id = $1 AND package_id IS NOT NULL LIMIT 1`, [tappedWaId]).catch(() => ({ rows: [] as any[] }))
        : { rows: [] as any[] };
      const handled = await this.sendDurationOptionsList(config, from, leadId, undefined, tapped[0]?.package_id).catch((err: any) => {
        this.logger.warn(`sendDurationOptionsList failed for lead ${leadId}: ${err.message}`);
        return false;
      });
      if (handled) { await this.upsertConversation(from, 'awaiting_duration', null, contactName, leadId); return; }
    }

    if (String(buttonPayload || '').startsWith(CALLBACK_PAYLOAD) || buttonLabel.includes('call back') || buttonLabel === 'call me' || buttonLabel.includes('call our') || buttonLabel.includes('chat with')) {
      let customReply: string | undefined;
      const [, pkgId, position] = String(buttonPayload || '').split('|');
      if (pkgId && position !== undefined) {
        const { rows: pk } = await this.pool.query(`SELECT buttons, contact_number, contact_button_text FROM tour_packages WHERE id=$1`, [pkgId]).catch(() => ({ rows: [] as any[] }));
        const orderedPk = pk[0] ? buildMetaButtons(pk[0]).ordered : [];
        const tapped = orderedPk[Number(position)]?.type === 'chat' ? orderedPk[Number(position)] : orderedPk.find((b) => b.type === 'chat');
        if (tapped?.type === 'chat') {
          const chatNumber = waNumber(tapped.phone || buildMetaButtons(pk[0]).ordered.find((c) => c.type === 'call')?.phone || pk[0].contact_number);
          const intro = tapped.reply?.trim() || 'Thank you for contacting Errances Voyages. Tap the link to chat with our travel expert on WhatsApp:';
          if (chatNumber) customReply = `${intro}\nhttps://wa.me/${chatNumber}`;
        }
      }
      await this.handleCallbackRequest(config, from, contactName, leadId, customReply);
      return;
    }

    const quickReplyText = message?.button?.text || message?.interactive?.button_reply?.title;
    const plainText = message?.text?.body;
    const replyText = String(quickReplyText || plainText || '').trim().toLowerCase();

    // They tapped "Need other days/nights?" last turn and this is their reply -- capture it as
    // a custom duration request (Callback Requests list + popup/push, same as any other "a
    // human needs to follow up" event) instead of letting it fall into any of the generic
    // routing below, which could otherwise silently auto-match it to an existing duration.
    if (leadId && plainText) {
      const { rows: conv } = await this.pool.query(`SELECT state, last_message_at FROM whatsapp_conversations WHERE phone_number = $1`, [from]);
      if (conv[0]?.state === 'awaiting_custom_duration') {
        // Only a reply that reads like a trip length ("5 days", "4 nights", "a week") within two
        // hours of the prompt counts. "Ok" or a question a day later is an ordinary message.
        const fresh = Date.now() - new Date(conv[0].last_message_at).getTime() < 2 * 60 * 60 * 1000;
        const readsLikeDuration = /\d|\b(night|day|week|month|one|two|three|four|five|six|seven|eight|nine|ten)s?\b/i.test(plainText);
        if (fresh && readsLikeDuration) {
          await this.handleCustomDurationRequest(config, from, contactName, leadId, plainText);
          await this.upsertConversation(from, 'completed', { customDurationRequested: true }, contactName, leadId);
          return;
        }
        await this.upsertConversation(from, 'completed', null, contactName, leadId);
      }
    }

    // Free-text call requests ("call me", "call back", "phone me") were only
    // ever caught when the customer tapped the button -- typed ones got the
    // generic consultant reply and vanished. Same handling as the button now:
    // push + a persistent pending row on the Callback Requests list.
    if (/\b(call|callback|phone\s*me|ring\s*me|contact\s*me|talk\s*(to|with)|speak\s*(to|with))\b/.test(replyText) && !/\b(don'?t|do not|dont|no need to|not)\s+call\b/.test(replyText)) {
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
        // They already had it and asked again -- usually they couldn't find or open it. Send the
        // PDF itself again (free: their message just opened the 24h window) instead of pointing
        // "above", which reads as being ignored.
        if (before.length) await this.resendItineraryPdfInSession(config, from, leadId).catch((err) => this.logger.warn(`PDF resend failed for lead ${leadId}: ${err.message}`));
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
      } else {
        // They already have a primary itinerary and are now asking about a specific duration
        // (e.g. "3N/4D?") -- send whichever duration we actually have that's closest, as a plain
        // in-session document. No new template needed: this rides entirely on the 24h session
        // window their own message just opened, same as the "not received yet" send above.
        const target = this.parseDurationRequest(replyText || inboundText);
        if (target) {
          const handled = await this.handleDurationRequest(config, from, leadId, target).catch((err: any) => {
            this.logger.warn(`handleDurationRequest failed for lead ${leadId}: ${err.message}`);
            return false;
          });
          if (handled) { await this.upsertConversation(from, 'completed', { durationMatchSent: true }, contactName, leadId); return; }
        }
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

    // Someone new writing in, with no itinerary to send them: welcome them and ask what trip they
    // have in mind (a few questions), so sales starts from a complete request.
    if (await this.startEnquiry(config, from, leadId, contactName, String(plainText || quickReplyText || ''))) return;

    // Any other message: answer by what the customer actually said (see replyByIntent).
    await this.replyByIntent(config, from, leadId, contactName, replyText, String(plainText || quickReplyText || '')).catch((err) => this.logger.error(`Intent reply failed for ${from}: ${err.message}`));
    await this.upsertConversation(from, 'consultant_assist', null, contactName, leadId);
  }

  // ---------------------------------------------------------------- enquiry questions

  private async say(config: WhatsAppConfig, to: string, leadId: string | undefined, text: string) {
    const result: any = await this.sendText(config, to, text);
    await this.storeMessage(to, leadId ?? null, 'out', text, 'text', result?.messages?.[0]?.id).catch(() => undefined);
  }

  private async askEnquiryStep(config: WhatsAppConfig, to: string, leadId: string | undefined, state: EnquiryState, opts: { retry?: boolean; lead?: string } = {}) {
    const lead = opts.lead ? `${opts.lead}\n\n` : '';
    if (state.step !== 'type') return this.say(config, to, leadId, lead + questionText(state, state.step, opts.retry));
    // The last question is a tappable list; if that cannot be sent, the same choices as numbers.
    const t = enquiryText(state.lang);
    const body = lead + questionText(state, 'type', opts.retry);
    try {
      const result: any = await this.sendInteractiveList(config, to, body, t.typeButton, travelTypeRows(state.lang), t.section);
      await this.storeMessage(to, leadId ?? null, 'out', body, 'text', result?.messages?.[0]?.id, undefined, { list: { button: t.typeButton, rows: travelTypeRows(state.lang).map((r) => r.title) } }).catch(() => undefined);
    } catch (err: any) {
      this.logger.warn(`Enquiry type list could not be sent to ${to} (${err.message}) -- sent as numbered text`);
      await this.say(config, to, leadId, lead + travelTypeFallback(state));
    }
  }

  // Welcomes someone who has just written in and asks the first of the enquiry questions: their
  // name (only when WhatsApp gave none), destination, departure date, travellers, type of trip.
  // Not started when sales is already on it: a quotation or itinerary went out, staff are
  // chatting, the lead already has its travel dates, or the questions were answered this month.
  private async startEnquiry(config: WhatsAppConfig, from: string, leadId: string | undefined, contactName: string | undefined, text: string): Promise<boolean> {
    if (!leadId) return false;
    const { rows } = await this.pool.query(
      `SELECT l.customer_name, l.status::text AS status, l.travel_from,
              EXISTS (SELECT 1 FROM lead_requirements r WHERE r.lead_id = l.id AND r.source = 'whatsapp_enquiry' AND r.created_at > now() - interval '30 days') AS answered,
              EXISTS (SELECT 1 FROM whatsapp_messages m WHERE m.phone_number = $2 AND m.direction = 'out' AND m.sent_by IS NOT NULL AND m.created_at > now() - interval '12 hours') AS staff_chatting,
              EXISTS (SELECT 1 FROM whatsapp_logs w WHERE w.lead_id = l.id AND w.message_type = 'itinerary' AND w.is_deleted = false) AS has_itinerary,
              EXISTS (SELECT 1 FROM quotations q WHERE q.lead_id = l.id) AS has_quotation
         FROM leads l WHERE l.id = $1 AND l.is_deleted = false`, [leadId, from]);
    const lead = rows[0];
    if (!lead || lead.answered || lead.staff_chatting || lead.has_itinerary || lead.has_quotation || lead.travel_from) return false;
    if (['quotation_sent', 'negotiation', 'booking_confirmed', 'won', 'lost', 'not_interested'].includes(lead.status)) return false;

    const name = hasRealName(contactName) ? contactName!.trim() : hasRealName(lead.customer_name) ? String(lead.customer_name).trim() : null;
    const steps: EnquiryStep[] = [...(name ? [] : ['name' as EnquiryStep]), 'destination', 'dates', 'travellers', 'type'];
    const state: EnquiryState = { lang: detectLanguage(text, from), step: steps[0], steps, answers: {}, startedAt: new Date().toISOString(), retries: 0 };
    await this.askEnquiryStep(config, from, leadId, state, { lead: welcomeText(state, name ? name.split(/\s+/)[0] : null) });
    await this.upsertConversation(from, `enq_${state.step}`, { enquiry: state }, contactName, leadId);
    this.logger.log(`Enquiry started with ${from} (${state.lang}, ${steps.length} questions)`);
    return true;
  }

  // Takes this message as the answer to the question in progress, then asks the next one or
  // finishes. Returns false when no enquiry is in progress (the usual handling carries on).
  private async continueEnquiry(config: WhatsAppConfig, from: string, leadId: string | undefined, contactName: string | undefined, message: any): Promise<boolean> {
    const listId: string | undefined = message?.interactive?.list_reply?.id;
    const { rows } = await this.pool.query(`SELECT state, context, last_message_at FROM whatsapp_conversations WHERE phone_number = $1`, [from]);
    const state: EnquiryState | undefined = rows[0]?.context?.enquiry;
    if (!rows[0] || !String(rows[0].state).startsWith('enq_') || !state) {
      // A late tap on the type list after the enquiry closed: nothing to do, and not a package pick.
      return String(listId || '').startsWith('enq:');
    }
    // A person has taken the chat over since the questions began: the bot steps aside.
    const { rows: staff } = await this.pool.query(
      `SELECT 1 FROM whatsapp_messages WHERE phone_number = $1 AND direction = 'out' AND sent_by IS NOT NULL AND created_at > $2 LIMIT 1`, [from, state.startedAt]);
    if (staff.length) { await this.upsertConversation(from, 'consultant_assist', {}, contactName, leadId); return false; }
    // Back after a long silence: the half-finished answers are stale, so start over.
    if (Date.now() - new Date(rows[0].last_message_at).getTime() > 12 * 60 * 60 * 1000) {
      await this.upsertConversation(from, 'greeted', {}, contactName, leadId);
      return false;
    }

    const text = String(message?.text?.body || message?.interactive?.list_reply?.title || message?.interactive?.button_reply?.title || message?.button?.text || '').trim();
    // "Call me" / "rappelez-moi" at any point: a callback request, and the questions stop there.
    if (/\b(call\s*(me|back)|callback|phone\s*me|ring\s*me|rappel(ez|er)?[- ]?moi|appel(ez|er)[- ]moi|me\s+rappeler|[êe]tre\s+rappel[ée])/i.test(text)) {
      await this.saveEnquiry(from, leadId, state, false);
      await this.upsertConversation(from, 'consultant_assist', {}, contactName, leadId);
      await this.handleCallbackRequest(config, from, contactName, leadId, state.lang === 'fr' ? 'Merci. Notre conseiller voyage vous appellera très bientôt.' : undefined);
      return true;
    }
    if (!text) {
      await this.say(config, from, leadId, enquiryText(state.lang).unreadable);
      await this.upsertConversation(from, `enq_${state.step}`, { enquiry: state }, contactName, leadId);
      return true;
    }

    // An answer that cannot be what was asked ("?", "12" for a name) gets the question once more;
    // the second time it is taken as given, so nobody gets stuck.
    const usable = state.step === 'type' ? !!parseTravelType(listId, text)
      : state.step === 'travellers' ? /\d|\p{L}{3,}/u.test(text)
      : state.step === 'dates' ? /\d|\p{L}{3,}/u.test(text)
      : /\p{L}{2,}/u.test(text);
    if (!usable && state.retries < 1) {
      state.retries += 1;
      await this.askEnquiryStep(config, from, leadId, state, { retry: true });
      await this.upsertConversation(from, `enq_${state.step}`, { enquiry: state }, contactName, leadId);
      return true;
    }
    state.answers[state.step] = text.slice(0, 300);
    if (state.step === 'type') state.travelType = parseTravelType(listId, text);
    state.retries = 0;

    const next = state.steps[state.steps.indexOf(state.step) + 1];
    if (next) {
      state.step = next;
      await this.askEnquiryStep(config, from, leadId, state);
      await this.upsertConversation(from, `enq_${state.step}`, { enquiry: state }, contactName, leadId);
      return true;
    }

    // All answered: keep it on the lead, give the customer their request back, alert sales.
    const name = await this.saveEnquiry(from, leadId, state, true);
    const closing = summaryText(state, name.split(/\s+/)[0] || '');
    const t = enquiryText(state.lang);
    const result: any = await this.sendInteractiveButtons(config, from, closing, [{ id: 'durmore:no:', title: t.callButton }]).catch(() => this.sendText(config, from, closing));
    await this.storeMessage(from, leadId ?? null, 'out', closing, 'text', result?.messages?.[0]?.id, undefined, { buttons: [{ type: 'QUICK_REPLY', text: t.callButton }] }).catch(() => undefined);
    await this.upsertConversation(from, 'completed', { enquiryCompletedAt: new Date().toISOString() }, contactName, leadId);
    await this.flagForFollowUp(from, leadId, name || contactName, 'New WhatsApp enquiry', staffSummary(state)).catch((err) => this.logger.error(`Enquiry alert failed for ${from}: ${err.message}`));
    this.logger.log(`Enquiry completed by ${from}: ${staffSummary(state)}`);
    return true;
  }

  // Writes the enquiry answers onto the lead: its name (if it had none), destination, dates,
  // travellers and travel type, a requirement entry and a note with the customer's own words.
  // `complete` false = the customer stopped part-way; what they did answer is still kept.
  // Returns the customer's name.
  private async saveEnquiry(from: string, leadId: string | undefined, state: EnquiryState, complete: boolean): Promise<string> {
    if (!leadId) return state.answers.name ?? '';
    const a = state.answers;
    const dates = a.dates ? parseTravelDates(a.dates) : {};
    const people = a.travellers ? parseTravellers(a.travellers) : {};
    const { rows } = await this.pool.query(
      `UPDATE leads SET
         customer_name = CASE WHEN $2::text IS NOT NULL AND customer_name !~ '[[:alpha:]]{2}' THEN $2 ELSE customer_name END,
         destination = COALESCE($3, destination),
         travel_from = COALESCE($4::date, travel_from), travel_to = COALESCE($5::date, travel_to),
         adults = COALESCE($6, adults), children = COALESCE($7, children),
         travel_type = COALESCE($8::travel_type, travel_type), updated_at = now()
       WHERE id = $1 AND is_deleted = false RETURNING customer_name`,
      [leadId, a.name ? a.name.slice(0, 120) : null, a.destination ? a.destination.slice(0, 200) : null, dates.from ?? null, dates.to ?? null, people.adults ?? null, people.children ?? null, state.travelType ?? null],
    ).catch((err) => { this.logger.error(`Could not save enquiry answers on lead ${leadId}: ${err.message}`); return { rows: [] as any[] }; });
    const lines = [
      a.destination && `Destination: ${a.destination}`, a.dates && `Departure: ${a.dates}`, a.travellers && `Travellers: ${a.travellers}`,
      (state.travelType || a.type) && `Type of trip: ${travelTypeLabel(state.travelType, 'en') ?? a.type}`,
    ].filter(Boolean);
    if (lines.length) {
      await this.pool.query(
        `INSERT INTO lead_requirements (lead_id, destination, travel_from, travel_to, adults, children, notes, answers, source)
         VALUES ($1, $2, $3, $4, COALESCE($5, 1), COALESCE($6, 0), $7, $8, $9)`,
        [leadId, a.destination ?? null, dates.from ?? null, dates.to ?? null, people.adults ?? null, people.children ?? null, lines.join('\n'), JSON.stringify({ ...a, travelType: state.travelType ?? null, language: state.lang }), complete ? 'whatsapp_enquiry' : 'whatsapp_enquiry_partial'],
      ).catch((err) => this.logger.error(`Could not save enquiry requirement for lead ${leadId}: ${err.message}`));
      await this.pool.query(`INSERT INTO lead_notes (lead_id, body) VALUES ($1, $2)`, [leadId, `WhatsApp enquiry${complete ? '' : ' (not finished)'}\n${lines.join('\n')}`]).catch(() => undefined);
    }
    return String(rows[0]?.customer_name || a.name || '').trim();
  }

  // A message with one "Call our experts" button under it (tapping it books a callback).
  private async sendWithCallButton(config: WhatsAppConfig, to: string, leadId: string | undefined, text: string) {
    const result: any = await this.sendInteractiveButtons(config, to, text, [{ id: 'durmore:no:', title: 'Call our experts' }]);
    await this.storeMessage(to, leadId ?? null, 'out', text, 'text', result?.messages?.[0]?.id, undefined, { buttons: [{ type: 'QUICK_REPLY', text: 'Call our experts' }] }).catch(() => undefined);
  }

  // A customer said something that needs a person: a pending row on Callback Requests (with what
  // they said), the pop-up for whoever is online, and a push for whoever is not.
  private async flagForFollowUp(from: string, leadId: string | undefined, contactName: string | undefined, title: string, said: string) {
    const { rows } = leadId ? await this.pool.query(`SELECT customer_name, phone, whatsapp_number, assigned_to FROM leads WHERE id=$1 AND is_deleted=false`, [leadId]) : { rows: [] as any[] };
    const lead = rows[0];
    const customerName = lead?.customer_name || contactName || from;
    const phone = lead?.phone || lead?.whatsapp_number || from;
    this.realtime.broadcastCallbackRequest({ id: leadId ?? null, customer_name: customerName, phone, assigned_to: lead?.assigned_to ?? null });
    await this.pool.query(`INSERT INTO callback_requests(lead_id, customer_name, phone, note) VALUES($1,$2,$3,$4)`, [leadId ?? null, customerName, phone, `${title}: "${said.trim().slice(0, 500)}"`]);
    await advanceLeadStatus(this.pool, leadId, 'follow_up');
    this.push.notifyAll({ title: `${title} — ${customerName}`, body: `"${said.trim().slice(0, 120)}" — call ${phone}`, url: leadId ? `/whatsapp?lead=${leadId}` : '/callback-requests' }).catch((err) => this.logger.error(`Follow-up push failed: ${err.message}`));
  }

  // The automatic answer to a typed message, chosen by what the customer said:
  //  - replying to a quotation ("ok", "confirm", "book") -> how to approve it, staff alerted
  //  - wants to book / asks the price -> a follow-up for staff, told an expert will contact them
  //  - a plain "ok" / "thanks" -> a short next step with a Call our experts button
  //  - anything else -> an expert will reply, with the expert's number and the same button
  // The bot stays quiet while a staff member is chatting (their own message in the last 30 minutes).
  private async replyByIntent(config: WhatsAppConfig, from: string, leadId: string | undefined, contactName: string | undefined, text: string, said: string) {
    const { rows: outs } = await this.pool.query(
      `SELECT body, sent_by, created_at FROM whatsapp_messages WHERE phone_number = $1 AND direction = 'out' ORDER BY created_at DESC LIMIT 6`,
      [from],
    );
    const ageMin = (row: any) => (Date.now() - new Date(row.created_at).getTime()) / 60000;
    const quotation = outs.find((m) => /\/q\/[0-9a-f-]{8,}/i.test(String(m.body || '')) && ageMin(m) < 48 * 60);
    const staffChatting = outs.some((m) => m.sent_by && ageMin(m) < 30 && m !== quotation);
    const saidRecently = (prefix: string, minutes: number) => outs.some((m) => String(m.body || '').startsWith(prefix) && ageMin(m) < minutes);

    const ack = /^(ok(ay|k)?|k+|fine|sure|yes|ya|yeah|yep|done|good|great|nice|super|noted|thanks?|thank\s*you|thx|tq|ty|sari|seri|nandri|👍|👌|🙏)[\s.!]*$/i.test(text);
    const wantsBooking = /\b(book|booking|confirm|proceed|go ahead|pay|payment|advance|interested|finali[sz]e)\b/.test(text);
    const wantsPrice = /\b(price|cost|rate|charges?|how much|budget|discount|offer|quote|quotation|package amount)\b/.test(text);

    const contact = await this.getConsultantContact(leadId);
    const callLine = contact.number ? `\n\nFor immediate assistance, call ${contact.name ? `${contact.name} on` : 'us on'} ${displayPhone(contact.number)}.` : '';

    if (quotation && (ack || wantsBooking)) {
      const { rows: l } = leadId ? await this.pool.query(`SELECT customer_name, phone FROM leads WHERE id=$1`, [leadId]) : { rows: [] as any[] };
      const name = l[0]?.customer_name || contactName || from;
      this.push.notifyAll({ title: `Quotation reply — ${name}`, body: `"${said.trim().slice(0, 120)}" — follow up to close the booking`, url: leadId ? `/whatsapp?lead=${leadId}` : '/whatsapp' }).catch(() => undefined);
      if (saidRecently('Thank you. To confirm your booking', 6 * 60)) return;
      await this.sendWithCallButton(config, from, leadId, 'Thank you. To confirm your booking, please open the quotation link above and tap *Approve & sign*. Your invoice and the payment details open right after.\n\nIf you would like to discuss anything first, our travel expert can call you.');
      return;
    }
    if (wantsBooking || wantsPrice) {
      await this.flagForFollowUp(from, leadId, contactName, wantsBooking ? 'Wants to book' : 'Asked about the price', said);
      if (staffChatting) return;
      const reply = (wantsBooking ? 'Thank you. Our travel expert will contact you shortly to confirm your booking.' : 'Thank you for your interest. Our travel expert will share the price details with you shortly.') + callLine;
      await this.sendText(config, from, reply).then((result: any) => this.storeMessage(from, leadId ?? null, 'out', reply, 'text', result?.messages?.[0]?.id)).catch(() => undefined);
      return;
    }
    if (staffChatting) return;
    if (ack) {
      if (saidRecently('Thank you. If you would like to go ahead', 6 * 60)) return;
      await this.sendWithCallButton(config, from, leadId, 'Thank you. If you would like to go ahead or have any questions, our travel expert is ready to help.');
      return;
    }
    if (saidRecently('Thank you for your message', 10)) return;
    await this.sendWithCallButton(config, from, leadId, `Thank you for your message. Our travel expert will reply to you here shortly.${callLine}`);
  }

  // Who the customer should contact: the lead's assigned employee, else the number on the
  // latest active itinerary, else the business number.
  private async getConsultantContact(leadId?: string): Promise<{ name: string; number: string | null }> {
    if (leadId) {
      const { rows } = await this.pool.query(`SELECT u.full_name, u.phone FROM leads l JOIN users u ON u.id = l.assigned_to WHERE l.id = $1`, [leadId]).catch(() => ({ rows: [] as any[] }));
      const number = waNumber(rows[0]?.phone);
      if (number) return { name: rows[0].full_name, number };
    }
    const { rows: pkgs } = await this.pool.query(
      `SELECT contact_name, contact_number FROM tour_packages WHERE is_active = true AND is_deleted = false AND COALESCE(contact_number,'') <> '' ORDER BY updated_at DESC LIMIT 1`,
    ).catch(() => ({ rows: [] as any[] }));
    const pkgNumber = waNumber(pkgs[0]?.contact_number);
    if (pkgNumber) return { name: pkgs[0].contact_name || '', number: pkgNumber };
    const profile = await this.getBusinessProfile().catch(() => null);
    return { name: '', number: waNumber(profile?.phone) };
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
    const lines = ['Thank you for contacting Errances Voyages.', '', 'Please contact our travel consultant — they will assist you with your tour.'];
    if (contact.number) lines.push('', `📞 ${contact.name ? contact.name + ' · ' : ''}${displayPhone(contact.number)}`, `Call or chat: https://wa.me/${contact.number}`);
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
    await advanceLeadStatus(this.pool, leadId, 'follow_up');
    this.push.notifyAll({
      title: `Callback requested — ${customerName}`,
      body: `Tapped "Call our experts" on the itinerary — call ${phone}`,
      url: '/followups',
    }).catch((err) => this.logger.error(`Callback request push failed: ${err.message}`));
    const reply = customReply || 'Thank you. Our travel expert will message you here shortly. You can type your questions in this chat at any time.';
    await this.sendText(config, from, reply)
      .then((result: any) => this.storeMessage(from, leadId ?? null, 'out', reply, 'text', result?.messages?.[0]?.id))
      .catch(() => undefined);
    await this.upsertConversation(from, 'callback_requested', { requestedAt: new Date().toISOString() }, contactName, leadId);
  }

  // They tapped "Need other days/nights?" and then typed what they want -- same popup/push +
  // persistent-list treatment as a callback request (reuses callback_requests.note for the
  // actual text, since this is exactly that: "a human needs to follow up with this person"),
  // plus a plain acknowledgement so they're not left hanging.
  private async handleCustomDurationRequest(config: WhatsAppConfig, from: string, contactName: string | undefined, leadId: string, requestedText: string) {
    const { rows } = await this.pool.query(
      `SELECT id, customer_name, phone, whatsapp_number, assigned_to FROM leads WHERE id=$1 AND is_deleted=false`,
      [leadId],
    );
    const lead = rows[0];
    const customerName = lead?.customer_name || contactName || from;
    const phone = lead?.phone || lead?.whatsapp_number || from;
    const note = `Requested a custom itinerary duration: "${requestedText.trim().slice(0, 500)}"`;
    this.realtime.broadcastCallbackRequest({
      id: leadId ?? null,
      customer_name: customerName,
      phone,
      assigned_to: lead?.assigned_to ?? null,
    });
    await this.pool.query(
      `INSERT INTO callback_requests(lead_id, customer_name, phone, note) VALUES($1,$2,$3,$4)`,
      [leadId ?? null, customerName, phone, note],
    );
    await advanceLeadStatus(this.pool, leadId, 'follow_up');
    this.push.notifyAll({
      title: `Custom duration requested — ${customerName}`,
      body: `"${requestedText.trim().slice(0, 120)}" — call ${phone}`,
      url: '/followups',
    }).catch((err) => this.logger.error(`Custom duration push failed: ${err.message}`));
    const reply = "Noted. We will check availability for that and get back to you here shortly.";
    await this.sendText(config, from, reply)
      .then((result: any) => this.storeMessage(from, leadId ?? null, 'out', reply, 'text', result?.messages?.[0]?.id))
      .catch(() => undefined);
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
      const consultant = leadId ? await this.getConsultantForLead(leadId) : { full_name: 'Errances Voyages', phone: '' };
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
  private async upsertLead(from: string, contactName?: string, referral?: WhatsAppReferral): Promise<string | undefined> {
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
      // From a click-to-WhatsApp ad (Meta sends the ad as "referral") or a customer who wrote in.
      source: referral ? 'meta_ads' : 'whatsapp',
      status: 'new',
      whatsappStatus: 'new',
      destination: this.config.get<string>('WHATSAPP_DEFAULT_TOUR_PLACE') || 'To be confirmed',
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
    await this.storeMessage(to, null, 'out', GREETING, 'interactive', listResult?.messages?.[0]?.id, undefined, { list: { button: 'View Packages', rows: packages.map((p: any) => String(p.name).slice(0, 24)) } }).catch(() => undefined);
  }

  private async sendItinerary(config: WhatsAppConfig, to: string, packageId: string, leadId?: string) {
    const { rows } = await this.pool.query(
      `SELECT name, itinerary_pdf_object_key, itinerary_pdf_file_name FROM tour_packages WHERE id = $1 AND is_deleted = false`,
      [packageId],
    );
    const pkg = rows[0];

    if (!pkg || !pkg.itinerary_pdf_object_key) {
      const text = "Thank you for your interest. The itinerary for that package is being prepared, and our team will share it with you shortly.";
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
    const ready = candidates.filter((pkg: any) => pkg.whatsapp_template_status === 'APPROVED' && pkg.whatsapp_template_name && pkg.itinerary_pdf_object_key && !pkg.auto_paused);
    if (!ready.length) {
      this.logger.warn(`Approved document template is not ready for any candidate package matching lead ${leadId}`);
      return false;
    }
    const { rows: consultants } = await this.pool.query(
      `SELECT COALESCE(u.full_name,'Errances Voyages') AS full_name, COALESCE(u.phone,'') AS phone
         FROM leads l LEFT JOIN users u ON u.id=l.assigned_to WHERE l.id=$1 LIMIT 1`, [leadId],
    );
    let anySent = false;
    let anyAlready = false;
    for (const pkg of ready) {
      const consultant = { ...(consultants[0] || { full_name:'Errances Voyages', phone:'' }) };
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
    return waNumber(phone);
  }

  async itineraryDeliveryStatus(packageId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM tour_packages WHERE id = $1 AND is_deleted = false`, [packageId]);
    const pkg = rows[0];
    if (!pkg) throw new BadRequestException('Itinerary not found');
    const leads = await this.leadsForPackage(pkg);
    const items = leads.map((l: any) => ({ id: l.id, name: l.customer_name, phone: l.phone, enquiry: l.destination || l.campaign_name || '', sent: !!l.sent_at, sentAt: l.sent_at, validPhone: !!this.toWaNumber(l.phone), createdAt: l.created_at }));
    const sent = items.filter((i) => i.sent).length;
    const pending = items.filter((i) => !i.sent && i.validPhone).length;
    // This was never actually returned before, so the frontend's `delivery.liveMode` check was
    // always undefined/falsy -- the "Test mode is ON" warning showed regardless of the real
    // setting, even after it had been switched to live.
    const { rows: automation } = await this.pool.query(`SELECT live_mode FROM whatsapp_automation_settings WHERE id=true`);
    const health = await this.recentDeliveryHealth(packageId);
    // One bar per template: the primary document's own tally, plus each additional document's own
    // -- a combined single number was hiding that e.g. everyone got document 1 but document 2 is
    // still only half-sent, which reads as "it's all fine" when it genuinely isn't.
    const { rows: docs } = await this.pool.query(
      `SELECT id, file_name, duration_days, duration_nights FROM package_itinerary_documents
        WHERE package_id=$1 AND object_key IS NOT NULL AND whatsapp_template_status='APPROVED' ORDER BY sort_order ASC`,
      [packageId],
    );
    const docStats: { id: string; label: string; sent: number; total: number }[] = [];
    if (docs.length) {
      const normalized = items.map((i) => this.toWaNumber(i.phone)).filter((n): n is string => !!n);
      for (const doc of docs) {
        const { rows: sentRows } = await this.pool.query(
          `SELECT count(*)::int AS n FROM package_document_sends WHERE document_id=$1 AND to_number = ANY($2::text[])`,
          [doc.id, normalized],
        );
        docStats.push({
          id: doc.id,
          label: doc.duration_days ? `${doc.duration_days}D/${doc.duration_nights ?? 0}N` : (doc.file_name || 'Document'),
          sent: sentRows[0]?.n ?? 0,
          total: normalized.length,
        });
      }
    }
    return {
      campaign: pkg.campaign_name, destination: (pkg.destinations || [])[0] || null,
      isActive: pkg.is_active, templateStatus: pkg.whatsapp_template_status,
      total: items.length, sent, pending, noPhone: items.filter((i) => !i.sent && !i.validPhone).length,
      leads: items.slice(0, 200), liveMode: !!automation[0]?.live_mode,
      stuckCount: health.stuckCount, throttled: health.stuckCount >= 10 || !!pkg.auto_paused,
      autoPaused: !!pkg.auto_paused, autoPausedAt: pkg.auto_paused_at ?? null,
      primaryLabel: pkg.duration_days ? `${pkg.duration_days}D/${pkg.duration_nights ?? 0}N` : 'Primary',
      additionalDocuments: docStats,
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
    // Auto cooldown: refuse to queue up another large batch while the circuit breaker (see
    // checkAutoPause) has this campaign paused, or while it's visibly trending that way right
    // now even if the periodic check hasn't caught up yet -- sending into that wall again only
    // makes the number's standing with Meta worse, not better.
    const health = await this.recentDeliveryHealth(packageId);
    if (pkg.auto_paused || health.stuckCount >= 10) throw new BadRequestException(`Meta appears to be throttling this campaign right now — ${health.stuckCount} recent sends never confirmed delivery. Sending is paused and will resume automatically once this clears.`);
    const pending = (await this.leadsForPackage(pkg)).filter((l: any) => !l.sent_at).slice(0, 100);
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
      // Even 5s/send at 150 in one run still tripped Meta's "healthy ecosystem
      // engagement" pacing (every one of those 150 sat stuck at "accepted" for
      // 35+ minutes with zero delivery confirmation) -- slower per-send pacing AND
      // a smaller batch cap per run (see .slice above) to cut total burst volume.
      await new Promise((resolve) => setTimeout(resolve, 8000));
    }
    return summary;
  }

  // A batch of sends that all still show "accepted" long after Meta normally confirms delivery
  // (seconds, not minutes) is the signature of Meta quietly throttling the number/template --
  // used to warn before a person queues up another large backlog send into the same wall.
  async recentDeliveryHealth(packageId: string) {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS stuck FROM whatsapp_logs
        WHERE package_id=$1 AND message_type='itinerary' AND status='accepted' AND sent_at < now() - interval '5 minutes' AND sent_at > now() - interval '6 hours'`,
      [packageId],
    );
    return { stuckCount: rows[0]?.stuck ?? 0 };
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
  // visibleTo: a salesperson's user id -- only their own (assigned/shared) leads' failed sends.
  async listFailedItineraries(visibleTo?: string) {
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
          ${visibleTo ? `AND ${leadVisibleSql('l.id', '$1')}` : ''}
        ORDER BY w.lead_id, w.package_id, w.created_at DESC`,
      visibleTo ? [visibleTo] : [],
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
  async leadCoverage(visibleTo?: string) {
    const { rows } = await this.pool.query(
      // "Received" means Meta actually confirmed it -- delivered or read. 'accepted'/'sent' only
      // means Meta agreed to try; that is not proof it reached anyone, so it is never counted as
      // received here (that was the exact false-confidence bug). A fresh accepted/sent send (under
      // 2 hours old) is still normal and counted separately as "in flight", not as a problem.
      `SELECT l.id, l.customer_name, l.created_at, l.destination, l.campaign_name, l.source, COALESCE(NULLIF(l.whatsapp_number,''), NULLIF(l.phone,'')) AS phone,
              EXISTS (SELECT 1 FROM whatsapp_logs w WHERE w.lead_id=l.id AND w.message_type='itinerary' AND w.is_deleted=false) AS attempted,
              (EXISTS (SELECT 1 FROM whatsapp_logs w WHERE w.lead_id=l.id AND w.message_type='itinerary' AND w.is_deleted=false AND w.status IN ('delivered','read')) OR EXISTS (SELECT 1 FROM manual_itinerary_sends m WHERE m.lead_id=l.id)) AS got,
              EXISTS (SELECT 1 FROM whatsapp_logs w WHERE w.lead_id=l.id AND w.message_type='itinerary' AND w.is_deleted=false AND w.status IN ('accepted','sent') AND w.created_at > now() - interval '2 hours') AS in_flight
         FROM leads l WHERE l.is_deleted = false ${visibleTo ? `AND ${leadVisibleSql('l.id', '$1')}` : ''}`,
      visibleTo ? [visibleTo] : [],
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

  // The name to greet someone by: the CRM lead's name first; if missing (or a placeholder like
  // "Test contact"), the name on their WhatsApp profile; else greetingFor's "Traveller".
  private async bestCustomerName(to: string, given?: string | null): Promise<string | null> {
    if (given && greetingFor(given) !== 'Traveller' && !/^test contact$/i.test(given.trim())) return given;
    const last10 = String(to || '').replace(/\D/g, '').slice(-10);
    if (!last10) return given ?? null;
    const { rows: lead } = await this.pool.query(
      `SELECT customer_name FROM leads WHERE is_deleted = false AND customer_name IS NOT NULL AND customer_name !~* '^test contact$'
          AND (right(regexp_replace(COALESCE(whatsapp_number,''), '\\D', '', 'g'), 10) = $1 OR right(regexp_replace(COALESCE(phone,''), '\\D', '', 'g'), 10) = $1)
        ORDER BY updated_at DESC LIMIT 1`, [last10]).catch(() => ({ rows: [] as any[] }));
    if (lead[0]?.customer_name && greetingFor(lead[0].customer_name) !== 'Traveller') return lead[0].customer_name;
    const { rows: conv } = await this.pool.query(
      `SELECT contact_name FROM whatsapp_conversations WHERE right(regexp_replace(phone_number, '\\D', '', 'g'), 10) = $1 AND contact_name IS NOT NULL ORDER BY last_message_at DESC NULLS LAST LIMIT 1`, [last10]).catch(() => ({ rows: [] as any[] }));
    return conv[0]?.contact_name || given || null;
  }

  // What the customer sees, reproduced for the CRM inbox (matches the approved template body).
  private renderItineraryText(pkg: any, leadName?: string | null, consultant?: { name?: string; phone?: string }) {
    const [p1, p2, p3] = splitItineraryMessage3(pkg.description || `Please review the ${pkg.name} itinerary.`);
    const expertName = consultant?.name || pkg.contact_name || 'Errances Voyages';
    const expertPhone = consultant?.phone || pkg.contact_number || '';
    const expert = [expertName, expertPhone].filter((x) => String(x).trim()).join(' · ');
    const greeting = `Dear ${greetingFor(leadName)},`;
    const tail = `Your expert: ${expert} — tap a button below to get in touch.`;
    return { greeting, paragraphs: [p1, p2, p3].filter(Boolean), tail, text: [greeting, p1, p2, p3, tail].filter(Boolean).join('\n\n') };
  }

  private async recordItineraryMessage(pkg: any, to: string, leadId: string | null, leadName: string | null | undefined, waId: string | null, consultant?: { name?: string; phone?: string }, opts?: { broadcast?: boolean; at?: string | Date | null; plain?: boolean }) {
    if (leadId && opts?.broadcast !== false) {
      // Test sends pass leadId = null, so this only fires for a real customer.
      this.pool.query(`SELECT assigned_to FROM leads WHERE id = $1`, [leadId]).then(({ rows }) => {
        this.realtime.broadcastItinerarySent({ lead_id: leadId, customer_name: leadName || 'Customer', phone: to, package_name: pkg.name, assigned_to: rows[0]?.assigned_to ?? null });
      }).catch(() => undefined);
    }
    try {
      const rendered = this.renderItineraryText(pkg, await this.bestCustomerName(to, leadName), consultant);
      let buttons: { type: string; text: string }[] = [];
      // A plain chat document carries no template buttons -- don't show ones the customer never got.
      // Otherwise: exactly the buttons, in exactly the order, of the template Meta approved.
      if (!opts?.plain) {
        const approved = pkg.whatsapp_template_name ? (await this.templateLayout(pkg.whatsapp_template_name)).buttons : [];
        if (approved.length) buttons = approved.map((b) => ({ type: b.type, text: b.text }));
        else { try { buttons = buildMetaButtons(pkg).meta.map((b: any) => ({ type: b.type, text: b.text })); } catch { /* keep empty */ } }
      }
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
      `SELECT COALESCE(u.full_name, 'Errances Voyages') AS full_name, COALESCE(u.phone, '') AS phone
         FROM leads l LEFT JOIN users u ON u.id = l.assigned_to WHERE l.id = $1 LIMIT 1`,
      [leadId],
    );
    return rows[0] || { full_name: 'Errances Voyages', phone: '' };
  }

  // One professional caption used everywhere we attach the itinerary
  // document to a single WhatsApp message: thanks the customer, names the
  // destination, and hands them off to their assigned consultant.
  private buildItineraryCaption(pkg: { name: string; description?: string | null }, consultant: { full_name: string; phone: string }): string {
    const intro =
      pkg.description ||
      `Thank you for choosing Errances Voyages. Your *${pkg.name}* itinerary is attached — please have a look.`;
    return `${intro}\n\nPlease open the itinerary above 👆\n\nFor personalised help, contact your travel consultant *${consultant.full_name}* on *${consultant.phone}*.`;
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
    // Twilio takes over WhatsApp whenever its settings are present.
    if (this.twilio.isConfigured()) return { provider: 'twilio', phone_number_id: TWILIO_PSEUDO_ID, business_account_id: TWILIO_PSEUDO_ID, access_token: TWILIO_PSEUDO_ID };
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
    if (config.provider === 'twilio') return this.twilio.send(payload);
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
    const response = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(accessToken)}`);
    const data: any = await response.json();
    if (!response.ok || !data?.data?.app_id) throw new BadRequestException('Could not resolve the Meta App ID from the configured WhatsApp token');
    return String(data.data.app_id);
  }

  // A message staff sent from the WhatsApp Business app on the phone -- recorded as ours, on the
  // matching lead, unless the CRM already stored it (same message id).
  private async storeEchoMessage(echo: any) {
    const to = String(echo?.to || '');
    if (!to || !echo?.id) return;
    const { rows: seen } = await this.pool.query(`SELECT 1 FROM whatsapp_messages WHERE wa_message_id = $1 LIMIT 1`, [echo.id]);
    if (seen.length) return;
    const last10 = to.replace(/\D/g, '').slice(-10);
    const { rows: lead } = await this.pool.query(
      `SELECT id FROM leads WHERE is_deleted = false AND (right(regexp_replace(COALESCE(whatsapp_number,''), '\\D', '', 'g'), 10) = $1 OR right(regexp_replace(COALESCE(phone,''), '\\D', '', 'g'), 10) = $1) ORDER BY created_at DESC LIMIT 1`, [last10]);
    const type = String(echo.type || 'text');
    const media = ['image', 'document', 'audio', 'video', 'sticker'].includes(type) ? echo[type] : null;
    const body = echo.text?.body || media?.caption || media?.filename || (type === 'template' ? '[Template sent from the phone]' : `[${type}]`);
    await this.storeMessage(to, lead[0]?.id ?? null, 'out', String(body), media ? 'text' : (type === 'text' ? 'text' : type), echo.id, undefined, { echo: true });
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
    if (config.provider === 'twilio') return this.twilio.billing().catch((e) => { throw new BadRequestException(`Could not read billing from Twilio: ${e.message}`); });
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
  // A chat message's stored photo/file (customer uploads, agent attachments). Storage is
  // private, so the browser can't load the saved storage address directly; this reads it here.
  async messageMedia(messageId: string): Promise<{ leadId: string | null; body: Buffer; contentType: string } | null> {
    const { rows } = await this.pool.query(`SELECT lead_id, meta FROM whatsapp_messages WHERE id = $1`, [messageId]);
    const meta = rows[0]?.meta || {};
    const url = String(meta.url || '');
    let key: string | null = meta.objectKey || null;
    if (!key && url) {
      const m = url.match(/\/((?:whatsapp-inbound|whatsapp-attachments|uploads|packages)\/[^?#]+)/);
      key = m ? decodeURIComponent(m[1]) : null;
    }
    if (!key && this.twilio.isTwilioMediaUrl(url)) {
      const file = await this.twilio.fetchMedia(url);
      return file ? { leadId: rows[0].lead_id, body: file.body, contentType: meta.mimeType || file.contentType } : null;
    }
    if (!key) return null;
    const obj = await this.r2.getObject(key);
    return obj ? { leadId: rows[0].lead_id, body: obj.body, contentType: meta.mimeType || obj.contentType } : null;
  }

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
    const atPosition = ordered[Number(position)];
    const button = atPosition?.type === 'chat' ? atPosition : ordered.find((b) => b.type === 'chat');
    if (!button) return null;
    const number = waNumber(button.phone || ordered.find((c) => c.type === 'call')?.phone || rows[0].contact_number);
    if (!number) return null;
    const place = rows[0].destinations?.[0] || 'your trip';
    const text = (button.reply?.trim() || 'Hi, I am interested to know more about {destination}').replace(/\{destination\}/g, place);
    return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
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
  private readonly UNREAD_BASELINE = '2026-09-27T00:00:00+05:30';  async inboxState(visibleTo?: string) {
    const { rows } = await this.pool.query(
      `SELECT l.id AS lead_id, COALESCE(s.status,'open') AS status,
              (SELECT count(*)::int FROM whatsapp_messages m WHERE m.lead_id=l.id AND m.direction='in' AND m.created_at > COALESCE(s.last_read_at, $1::timestamptz)) AS unread,
              lm.body AS last_body, lm.direction AS last_direction, lm.msg_type AS last_type, lm.created_at AS last_at,
              -- The customer wrote something in the last 30 days and no person has answered since. A
              -- button tap counts only when nothing at all (not even the bot) went out after it.
              -- Opening the chat does not clear this; a reply or Done does.
              (COALESCE(s.status,'open') <> 'done' AND EXISTS (
                 SELECT 1 FROM whatsapp_messages i WHERE i.lead_id = l.id AND i.direction = 'in' AND i.msg_type <> 'reaction'
                    AND i.created_at > now() - interval '30 days'
                    AND (i.msg_type NOT IN ('button','interactive') OR NOT EXISTS (SELECT 1 FROM whatsapp_messages b WHERE b.lead_id = l.id AND b.direction = 'out' AND b.created_at > i.created_at))
                    AND NOT EXISTS (SELECT 1 FROM whatsapp_messages o WHERE o.lead_id = l.id AND o.direction = 'out' AND (o.sent_by IS NOT NULL OR o.meta->>'echo' = 'true') AND o.created_at > i.created_at))) AS needs_reply
         FROM leads l
         LEFT JOIN whatsapp_chat_state s ON s.lead_id = l.id
         LEFT JOIN LATERAL (SELECT body, direction, msg_type, created_at FROM whatsapp_messages m WHERE m.lead_id=l.id ORDER BY created_at DESC LIMIT 1) lm ON true        WHERE l.is_deleted=false AND (lm.created_at IS NOT NULL OR s.lead_id IS NOT NULL)
          ${visibleTo ? `AND ${leadVisibleSql('l.id', '$2')}` : ''}`,
      visibleTo ? [this.UNREAD_BASELINE, visibleTo] : [this.UNREAD_BASELINE],
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
    // A lead saved under its phone number (or as ".") has no name to greet; "To be confirmed" is not a destination.
    const name = /\p{L}/u.test(String(lead.customer_name || '')) ? lead.customer_name : 'there';
    const destination = /^to be confirmed$/i.test(String(lead.destination || '').trim()) ? '' : lead.destination || '';
    return this.sendReopenTemplate(phone, name, destination, leadId);
  }

  // The approved "travel_enquiry_welcome" template, sent only when staff press "Send template to
  // re-open" on a closed chat (new leads no longer get it). Stored with its real footer and
  // buttons so the Inbox shows exactly what the customer sees.
  private async sendReopenTemplate(to: string, customerName: string, destination: string, leadId: string) {
    const config = await this.getConfig();
    if (!config) throw new BadRequestException('WhatsApp is not configured');
    const normalized = waNumber(to) || String(to).replace(/\D/g, '');
    const name = customerName.slice(0, 60);
    const dest = (destination || 'your preferred destination').slice(0, 60);
    // The newer re-open message (no "Yes, send itinerary" button) once Meta has approved it.
    const { rows: tpl } = await this.pool.query(`SELECT template_name FROM utility_templates WHERE kind = 'chat_reopen' AND template_status = 'APPROVED' AND template_name IS NOT NULL`).catch(() => ({ rows: [] as any[] }));
    if (tpl[0]?.template_name) {
      const tplName: string = tpl[0].template_name;
      const sent = await this.callWhatsAppApi(config, {
        to: normalized,
        type: 'template',
        template: { name: tplName, language: { code: 'en_US' }, components: [{ type: 'body', parameters: [{ type: 'text', text: name }, { type: 'text', text: destination ? dest : 'travel' }] }] },
      });
      await this.pool.query(
        `INSERT INTO whatsapp_logs (to_number, template_name, status, sent_at, message_id, lead_id, message_type) VALUES ($1, $2, 'accepted', now(), $3, $4, 'template')`,
        [normalized, tplName, sent?.messages?.[0]?.id ?? null, leadId],
      );
      const lay = await this.templateLayout(tplName);
      const text = lay.body ? lay.body.replace('{{1}}', name).replace('{{2}}', destination ? dest : 'travel') : `Hello ${name}, this is Errances Voyages regarding your enquiry.`;
      await this.storeMessage(normalized, leadId, 'out', text, 'text', sent?.messages?.[0]?.id ?? undefined, undefined, { template: tplName, footer: lay.footer, buttons: lay.buttons }).catch(() => undefined);
      return sent;
    }
    const result = await this.callWhatsAppApi(config, {
      to: normalized,
      type: 'template',
      template: { name: 'travel_enquiry_welcome', language: { code: 'en_US' }, components: [{ type: 'body', parameters: [{ type: 'text', text: name }, { type: 'text', text: dest }] }] },
    });
    await this.pool.query(
      `INSERT INTO whatsapp_logs (to_number, template_name, status, sent_at, message_id, lead_id, message_type) VALUES ($1, 'travel_enquiry_welcome', 'accepted', now(), $2, $3, 'template')`,
      [normalized, result?.messages?.[0]?.id ?? null, leadId],
    );
    const layout = await this.templateLayout('travel_enquiry_welcome');
    const body = layout.body ? layout.body.replace('{{1}}', name).replace('{{2}}', dest) : `Hello ${name}, thank you for choosing Errances Voyages.`;
    await this.storeMessage(normalized, leadId, 'out', body, 'text', result?.messages?.[0]?.id ?? undefined, undefined, { template: 'travel_enquiry_welcome', footer: layout.footer, buttons: layout.buttons }).catch(() => undefined);
    return result;
  }

  // A template's real body / footer / buttons, straight from Meta (cached 1h), for faithful
  // Inbox rendering.
  private templateLayoutCache = new Map<string, { at: number; body: string | null; footer: string | null; buttons: { type: string; text: string; url?: string }[] }>();
  private async templateLayout(name: string) {
    const hit = this.templateLayoutCache.get(name);
    if (hit && Date.now() - hit.at < 3600_000) return hit;
    const empty = { at: Date.now(), body: null as string | null, footer: null as string | null, buttons: [] as { type: string; text: string; url?: string }[] };
    try {
      const config = await this.getConfig();
      if (!config?.business_account_id) return empty;
      const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
      const res = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${config.business_account_id}/message_templates?name=${encodeURIComponent(name)}&fields=name,components&access_token=${encodeURIComponent(config.access_token)}`);
      const data: any = await res.json();
      const comps: any[] = data?.data?.find((t: any) => t.name === name)?.components ?? [];
      const out = {
        at: Date.now(),
        body: comps.find((c) => c.type === 'BODY')?.text ?? null,
        footer: comps.find((c) => c.type === 'FOOTER')?.text ?? null,
        buttons: (comps.find((c) => c.type === 'BUTTONS')?.buttons ?? []).map((b: any) => ({ type: String(b.type), text: String(b.text), ...(b.url ? { url: String(b.url) } : {}) })),
      };
      this.templateLayoutCache.set(name, out);
      return out;
    } catch { return empty; }
  }

  // Re-send the lead's itinerary PDF as an in-session document (no template, no charge).
  private async resendItineraryPdfInSession(config: WhatsAppConfig, to: string, leadId: string) {
    const { rows } = await this.pool.query(
      `SELECT p.id, p.name, p.itinerary_pdf_object_key, p.itinerary_pdf_file_name FROM whatsapp_logs w JOIN tour_packages p ON p.id = w.package_id
        WHERE w.lead_id = $1 AND w.message_type = 'itinerary' AND w.is_deleted = false AND p.itinerary_pdf_object_key IS NOT NULL
        ORDER BY w.created_at DESC LIMIT 1`, [leadId]);
    const pkg = rows[0];
    if (!pkg) return false;
    const fileName = pkg.itinerary_pdf_file_name || `${pkg.name}.pdf`;
    const link = await this.r2.getPresignedDownloadUrl(pkg.itinerary_pdf_object_key, 7 * 24 * 3600);
    const caption = `Here is your ${String(pkg.name).replace(/\s*itinerary\s*$/i, '')} itinerary again. Tap to open it.`;
    const result = await this.sendDocument(config, to, link, fileName, caption);
    await this.storeMessage(to, leadId, 'out', caption, 'document', result?.messages?.[0]?.id, undefined, { url: link, filename: fileName, mimeType: 'application/pdf' }).catch(() => undefined);
    return true;
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
    sectionTitle: string = 'Our Packages',
  ) {
    return this.callWhatsAppApi(config, {
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: bodyText },
        action: {
          button: buttonText,
          sections: [{ title: sectionTitle, rows }],
        },
      },
    });
  }

  // Bare API call only -- the claim, the log row, and failure alerting all live
  // in dispatchItinerary now (every caller of this goes through it).
  private sendDocument(config: WhatsAppConfig, to: string, link: string, filename: string, caption?: string) {
    return this.callWhatsAppApi(config, { to, type: 'document', document: { link, filename, caption } });
  }

  // Up to 3 real quick-reply buttons rendered together -- unlike an interactive "list" message
  // (sendInteractiveList), which Meta only ever gives a single action button, these appear as
  // separate tappable rows stacked under the body text, exactly like the package message's own
  // Call/Chat/Explore buttons.
  private sendInteractiveButtons(config: WhatsAppConfig, to: string, bodyText: string, buttons: { id: string; title: string }[]) {
    return this.callWhatsAppApi(config, {
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: { buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })) },
      },
    });
  }

  // Reads a free-typed duration out of a customer's message ("3N/4D", "3 nights 4 days",
  // just "5 nights"). Only nights OR days is required -- the other is inferred as
  // nights+1/days-1, the near-universal travel-package convention. Returns null for anything
  // that isn't clearly a duration ask, so normal conversation never gets misfired on.
  private parseDurationRequest(text: string): { nights: number; days: number } | null {
    const t = String(text || '').toLowerCase();
    const nightsMatch = t.match(/(\d+)\s*n(?:ight)?s?\b/);
    const daysMatch = t.match(/(\d+)\s*d(?:ay)?s?\b/);
    if (!nightsMatch && !daysMatch) return null;
    const nights = nightsMatch ? parseInt(nightsMatch[1], 10) : Math.max(parseInt(daysMatch![1], 10) - 1, 0);
    const days = daysMatch ? parseInt(daysMatch[1], 10) : parseInt(nightsMatch![1], 10) + 1;
    if (!Number.isFinite(nights) || !Number.isFinite(days) || (nights <= 0 && days <= 0)) return null;
    return { nights, days };
  }

  // The lead's most recently-confirmed package, and every duration we actually have for it --
  // the primary itinerary plus any tagged additional document. Shared by the tap-to-pick list
  // (preferred) and the free-text fallback below.
  // Which trip's itineraries to offer. An explicit package (the template message the customer
  // tapped, or the trip carried in a list/button id) always wins; otherwise the latest itinerary
  // that went out -- 'unconfirmed' included, since those were sent while delivery webhooks were
  // down and the customer demonstrably has them (they're tapping their buttons).
  private async getDurationCandidates(leadId: string, packageIdHint?: string | null) {
    let packageId: string | undefined = packageIdHint || undefined;
    if (!packageId) {
      const { rows: logRows } = await this.pool.query(
        `SELECT package_id FROM whatsapp_logs WHERE lead_id=$1 AND message_type='itinerary' AND is_deleted=false AND status IN ('accepted','sent','delivered','read','unconfirmed') AND package_id IS NOT NULL ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 1`,
        [leadId],
      );
      packageId = logRows[0]?.package_id;
    }
    if (!packageId) return null;

    const { rows: pkgRows } = await this.pool.query(
      `SELECT id, name, buttons, contact_number, duration_nights, duration_days, itinerary_pdf_object_key, itinerary_pdf_file_name FROM tour_packages WHERE id=$1 AND is_deleted=false`,
      [packageId],
    );
    const pkg = pkgRows[0];
    if (!pkg) return null;
    const { rows: docs } = await this.pool.query(
      `SELECT id, file_name, object_key, duration_nights, duration_days FROM package_itinerary_documents WHERE package_id=$1 AND duration_nights IS NOT NULL AND duration_days IS NOT NULL`,
      [packageId],
    );

    type Candidate = { id: string; nights: number; days: number; objectKey: string; fileName: string; isPrimary: boolean };
    const candidates: Candidate[] = [];
    if (pkg.duration_nights != null && pkg.duration_days != null && pkg.itinerary_pdf_object_key) {
      candidates.push({ id: 'primary', nights: pkg.duration_nights, days: pkg.duration_days, objectKey: pkg.itinerary_pdf_object_key, fileName: pkg.itinerary_pdf_file_name || `${pkg.name}.pdf`, isPrimary: true });
    }
    for (const d of docs) candidates.push({ id: d.id, nights: d.duration_nights, days: d.duration_days, objectKey: d.object_key, fileName: d.file_name || 'Itinerary.pdf', isPrimary: false });
    return candidates.length ? { pkg, candidates } : null;
  }

  // Tapped "Explore More Itineraries" -- instead of asking them to type a duration (which
  // risks typos and confusion), show exactly what we actually have as a tappable list, straight
  // away (no message-then-button step in between). Picking a row sends that document directly
  // (see handleDurationListReply), no guessing involved. bodyText lets the loop in
  // sendDurationCandidate re-show this with a "want another?" intro instead of the first-time
  // wording; when omitted, the first-time prompt comes from the duration button's own configured
  // "reply" text (set in the package form, same field chat buttons use for their starting
  // message) so it's editable there, not hardcoded here.
  private async sendDurationOptionsList(config: WhatsAppConfig, to: string, leadId: string, bodyText?: string, packageId?: string | null): Promise<boolean> {
    const found = await this.getDurationCandidates(leadId, packageId);
    // The primary itinerary is the one they already have -- listing it back as a choice here
    // just gets "that's the same one above 👆" as the reply, which reads as the bot not having
    // listened. Only the OTHER itineraries are genuinely worth offering as options.
    const others = found?.candidates.filter((c) => !c.isPrimary) ?? [];
    // Documents already sent to THIS number also drop off the list entirely -- same reasoning,
    // offering back something they already have just invites "I already have this" replies.
    const { rows: sentRows } = others.length
      ? await this.pool.query(`SELECT document_id FROM package_document_sends WHERE to_number = $1 AND document_id = ANY($2)`, [to, others.map((c) => c.id)])
      : { rows: [] as { document_id: string }[] };
    const alreadySent = new Set(sentRows.map((r) => r.document_id));
    const remaining = others.filter((c) => !alreadySent.has(c.id));
    if (!found || remaining.length < 1) {
      // Run out of itineraries to offer (not just "only ever had one") -- go straight to the
      // callback-request flow instead of a dead-end message, matching "Call our experts" being
      // the fallback once the duration list hits zero.
      if (others.length) {
        await this.handleCallbackRequest(config, to, undefined, leadId, "You now have every itinerary we offer for this trip. Our travel expert will call you shortly to help you plan and book.");
        return true;
      }
      // Only one itinerary exists for this trip: end the chain the same way as reaching zero --
      // "that's everything we have" with a single "Call our experts" button.
      await this.askExploreMore(config, to, leadId, found?.pkg.id ?? '');
      return true;
    }
    // Two itineraries can genuinely share the same Days/Nights (e.g. two different places, same
    // length) -- not blocked, but the 2nd+ occurrence gets "(same as Option N)" in its
    // description so it's at least distinguishable on the list instead of two identical-looking
    // rows (matches the editor's own duplicate warning, see labelDurationOptions in the form).
    const firstSeenAt: Record<string, number> = {};
    const rows = remaining.map((c, idx) => {
      const sig = `${c.nights}N${c.days}D`;
      const firstIdx = firstSeenAt[sig];
      if (firstIdx === undefined) firstSeenAt[sig] = idx;
      const description = firstIdx !== undefined ? `Same as Option ${firstIdx + 1}` : 'Different duration';
      return { id: `dur:${found.pkg.id}:${c.id}`, title: durationWords(c.nights, c.days).slice(0, 24), description: description.slice(0, 72) };
    });
    // A trailing row for "none of these" -- taps it, we ask them to type what they actually
    // want, and that reply gets flagged to staff (Callback Requests list + push) instead of
    // silently trying to match it to one of the fixed durations above. Its label defaults to
    // "Need other days/nights?" but is editable per-package (set in the package form).
    const customLabel = resolveButtons(found.pkg).find((b) => b.type === 'duration')?.customLabel?.trim() || 'Need other days/nights?';
    rows.push({ id: `dur:${found.pkg.id}:custom`, title: customLabel.slice(0, 24), description: 'Tell us what you have in mind' });
    const prompt = bodyText || resolveButtons(found.pkg).find((b) => b.type === 'duration')?.reply?.trim() || 'Which duration would you like to see?';
    // WhatsApp allows up to 3 reply buttons on a message. With 3 or fewer choices they show
    // straight away (no "Choose" tap); more than that needs the list. The "other days/nights"
    // row only fits when there's room for it.
    const durationRows = rows.filter((r) => !r.id.endsWith(':custom'));
    if (durationRows.length <= 3) {
      const btns = (durationRows.length < 3 ? rows : durationRows).map((r) => ({ id: r.id, title: (r.id.endsWith(':custom') ? 'Other days/nights' : r.title).slice(0, 20) }));
      const res = await this.sendInteractiveButtons(config, to, prompt, btns);
      await this.storeMessage(to, leadId, 'out', prompt, 'text', res?.messages?.[0]?.id, undefined, { buttons: btns.map((b) => ({ type: 'QUICK_REPLY', text: b.title })) }).catch(() => undefined);
      return true;
    }
    const result = await this.sendInteractiveList(config, to, prompt, 'Choose', rows, 'Available Durations');
    await this.storeMessage(to, leadId, 'out', prompt, 'text', result?.messages?.[0]?.id, undefined, { list: { button: 'Choose', rows: rows.map((r) => r.title) } }).catch(() => undefined);
    return true;
  }

  // Tapped a specific duration on the list -- send exactly that one, no matching/guessing.
  // "custom" (the trailing "Need other days/nights?" row) instead asks them to type what they
  // want and marks the conversation so the very next free-text reply gets captured as that
  // request (see processWebhookPayload's awaiting_custom_duration check) instead of being
  // routed anywhere else.
  private async handleDurationListReply(config: WhatsAppConfig, to: string, leadId: string, packageId: string, candidateId: string): Promise<boolean> {
    const found = await this.getDurationCandidates(leadId, packageId);
    if (!found) return false;
    if (candidateId === 'custom') {
      const expert = this.expertNumber(found.pkg);
      const prompt = `Please type the number of days and nights you would like, and our travel expert will get back to you with the options.${expert ? `\n\nPrefer to talk? Call our expert on ${expert}.` : ''}`;
      const btns = [{ id: `durmore:no:${packageId}`, title: 'Call our experts' }];
      const result = await this.sendInteractiveButtons(config, to, prompt, btns);
      await this.storeMessage(to, leadId, 'out', prompt, 'text', result?.messages?.[0]?.id, undefined, { buttons: [{ type: 'QUICK_REPLY', text: 'Call our experts' }] }).catch(() => undefined);
      await this.upsertConversation(to, 'awaiting_custom_duration', { packageId }, undefined, leadId);
      return true;
    }
    const chosen = found.candidates.find((c) => c.id === candidateId);
    if (!chosen) return false;
    return this.sendDurationCandidate(config, to, leadId, found.pkg.id, found.pkg.name, chosen);
  }

  // Finds whichever duration we actually have closest to what the customer free-typed (e.g.
  // "3N/4D"), and sends it -- kept as a fallback for anyone who types instead of tapping the list.
  private async handleDurationRequest(config: WhatsAppConfig, to: string, leadId: string, target: { nights: number; days: number }): Promise<boolean> {
    const found = await this.getDurationCandidates(leadId);
    if (!found) return false;
    const sorted = [...found.candidates].sort((a, b) =>
      (Math.abs(a.nights - target.nights) + Math.abs(a.days - target.days)) - (Math.abs(b.nights - target.nights) + Math.abs(b.days - target.days)),
    );
    return this.sendDurationCandidate(config, to, leadId, found.pkg.id, found.pkg.name, sorted[0]);
  }

  // After a pick, a quick 2-button check instead of immediately re-showing the full list again
  // -- "Explore More Itineraries" reopens the duration list (sendDurationOptionsList), "Call our
  // experts" goes to the callback-request flow. Asking first is less noisy than dumping the
  // whole list back on them every single time.
  private async askExploreMore(config: WhatsAppConfig, to: string, leadId: string, pkgId: string) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const left = await this.remainingItineraryCount(to, leadId, pkgId || null);
    // Counts down with every pick; once nothing is left the only next step is our expert.
    const prompt = left > 0
      ? `Would you like to see another itinerary? ${left} more option${left === 1 ? '' : 's'} available.`
      : `You now have every itinerary we offer for this trip. Call our experts to plan and book yours${await this.expertNumberFor(pkgId)}.`;
    const buttons = left > 0
      ? [{ id: `durmore:yes:${pkgId}`, title: `More itineraries (${left})`.slice(0, 20) }, { id: `durmore:no:${pkgId}`, title: 'Call our experts' }]
      : [{ id: `durmore:no:${pkgId}`, title: 'Call our experts' }];
    const result = await this.sendInteractiveButtons(config, to, prompt, buttons);
    await this.storeMessage(to, leadId, 'out', prompt, 'text', result?.messages?.[0]?.id, undefined, { buttons: buttons.map((b) => ({ type: 'QUICK_REPLY', text: b.title })) }).catch(() => undefined);
  }

  // The expert's phone as customers should dial it, from the package's Call button.
  private expertNumber(pkg: any): string {
    const number = waNumber(resolveButtons(pkg).find((b) => b.type === 'call')?.phone || pkg?.contact_number || '');
    return number ? displayPhone(number) : '';
  }
  private async expertNumberFor(pkgId: string): Promise<string> {
    if (!pkgId) return '';
    const { rows } = await this.pool.query(`SELECT buttons, contact_number FROM tour_packages WHERE id = $1`, [pkgId]).catch(() => ({ rows: [] as any[] }));
    const n = rows[0] ? this.expertNumber(rows[0]) : '';
    return n ? ` on ${n}` : '';
  }

  // How many uploaded itineraries (other than the one in the first template) this number hasn't
  // received yet -- the same rule sendDurationOptionsList uses to build its list.
  private async remainingItineraryCount(to: string, leadId: string, packageId?: string | null): Promise<number> {
    const found = await this.getDurationCandidates(leadId, packageId).catch(() => null);
    const others = found?.candidates.filter((c) => !c.isPrimary) ?? [];
    if (!others.length) return 0;
    const { rows } = await this.pool.query(`SELECT count(*)::int AS n FROM package_document_sends WHERE to_number = $1 AND document_id = ANY($2)`, [to, others.map((c) => c.id)]);
    return Math.max(0, others.length - (rows[0]?.n ?? 0));
  }

  // Sends one specific duration candidate as a plain in-session message (no template, no Meta
  // approval needed: this only ever runs from inside the webhook, i.e. within the 24h window
  // their own message just opened). Reuses the same package_document_sends claim as the
  // automatic catch-up, so this can never double-send a document the lead already has. After a
  // real send, asks "want to explore more?" so the customer can pick another duration straight
  // away instead of having to tap the original button again.
  private async sendDurationCandidate(config: WhatsAppConfig, to: string, leadId: string, pkgId: string, pkgName: string, best: { id: string; nights: number; days: number; objectKey: string; fileName: string; isPrimary: boolean }): Promise<boolean> {
    if (best.isPrimary) {
      const result = await this.sendText(config, to, `That is the ${durationWords(best.nights, best.days)} itinerary we already sent you above 👆`);
      await this.storeMessage(to, leadId, 'out', pkgName, 'text', result?.messages?.[0]?.id).catch(() => undefined);
      // Picking the primary one used to end the flow here with no way back to the list short of
      // tapping the original "Explore More Itineraries" button again -- now always asks "want to
      // explore more?" the same way every other pick does.
      await this.askExploreMore(config, to, leadId, pkgId);
      return true;
    }
    const { rowCount } = await this.pool.query(`INSERT INTO package_document_sends (document_id, to_number) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [best.id, to]);
    if (!rowCount) {
      const result = await this.sendText(config, to, `You already have our ${durationWords(best.nights, best.days)} itinerary — please check above 👆`);
      await this.storeMessage(to, leadId, 'out', pkgName, 'text', result?.messages?.[0]?.id).catch(() => undefined);
      await this.askExploreMore(config, to, leadId, pkgId);
      return true;
    }
    try {
      const link = await this.r2.getPresignedDownloadUrl(best.objectKey, 600);
      const result = await this.sendDocument(config, to, link, best.fileName, `Here is your ${durationWords(best.nights, best.days)} itinerary. Tap to open it.`);
      await this.storeMessage(to, leadId, 'out', pkgName, 'itinerary', result?.messages?.[0]?.id).catch(() => undefined);
      await this.askExploreMore(config, to, leadId, pkgId);
      return true;
    } catch (err) {
      await this.pool.query(`DELETE FROM package_document_sends WHERE document_id=$1 AND to_number=$2`, [best.id, to]).catch(() => undefined);
      throw err;
    }
  }

  private async sendDocumentTemplate(config: WhatsAppConfig, to: string, name: string, link: string, filename: string, message: string, consultantName: string, consultantPhone: string, pkg?: any, leadName?: string) {
    // Same 4-slot approved template structure (greeting / paragraph 1 / paragraph 2 / expert) --
    // adding "download above" as a new 5th parameter would break the send, since it would no
    // longer match what Meta approved. Instead it rides inside the last paragraph, which is a
    // free-text parameter, so this applies to every package without touching approval status.
    // v10+ templates have a separate slot for each of the three message paragraphs (download
    // line, hook, offer) so they display on their own lines -- older v1-v9 templates still only
    // have two content slots and must keep getting the old 4-param shape until they're
    // resubmitted, since Meta rejects a param-count mismatch against what it approved.
    const nameForGreeting = await this.bestCustomerName(to, leadName);
    const isNewFormat = name.startsWith(V2_TEMPLATE_PREFIX);
    const isLegacyV = !isNewFormat && /^campaign_itinerary_v\d+_/.test(name);
    const expertText = [String(consultantName).slice(0,60), String(consultantPhone || '').slice(0,30)].filter((part) => part.trim()).join(' · ') || 'Errances Voyages';
    let bodyParams: any[];
    if (isNewFormat) {
      const [p1, p2, p3] = splitItineraryMessage3(message);
      bodyParams = [{ type:'text', text: greetingFor(nameForGreeting) }, { type:'text', text: p1.slice(0, 450) }, { type:'text', text: p2.slice(0, 450) }, { type:'text', text: p3.slice(0, 450) }, { type:'text', text: expertText }];
    } else if (isLegacyV) {
      const [p1, p2] = splitItineraryMessage(message);
      bodyParams = [{ type:'text', text: greetingFor(nameForGreeting) }, { type:'text', text: p1.slice(0, 450) }, { type:'text', text: `${p2} Please open the itinerary above 👆`.slice(0, 450) }, { type:'text', text: expertText }];
    } else {
      bodyParams = [{ type:'text', text:String(message).slice(0,900) }, { type:'text', text:String(consultantName).slice(0,60) }, { type:'text', text:String(consultantPhone).slice(0,30) }];
    }
    // The parameter type sent here has to match whatever header format Meta actually approved
    // the template under (see metaHeaderMedia at submission time) -- sending 'document' for a
    // template approved as an IMAGE header (or vice versa) fails the send outright, same root
    // cause as the format being hardcoded at submission.
    const { headerFormat } = metaHeaderMedia(filename);
    const headerParam = headerFormat === 'IMAGE' ? { type: 'image', image: { link } } : { type: 'document', document: { link, filename } };
    const components: any[] = [{
      type:'header', parameters:[headerParam],
    }, {
      type:'body', parameters: bodyParams,
    }];
    // v2 templates carry a "Request a call back" quick-reply button (index 1,
    // after the static tap-to-call button); its payload comes back to our
    // webhook when the customer taps it.
    if (name.startsWith('campaign_itinerary_v')) {
      const approved = (await this.templateLayout(name)).buttons;
      if (approved.length && pkg?.id) {
        approved.forEach((b, index) => {
          if (b.type === 'URL' && String(b.url || '').includes('{{1}}')) components.push({ type:'button', sub_type:'url', index:String(index), parameters:[{ type:'text', text:`${pkg.id}.${index}` }] });
          else if (b.type === 'QUICK_REPLY') components.push({ type:'button', sub_type:'quick_reply', index:String(index), parameters:[{ type:'payload', payload:'duration' }] });
        });
      } else {
        const built = pkg?.id ? buildMetaButtons(pkg) : null;
        for (const index of built?.quickReplyIndexes ?? []) components.push({ type:'button', sub_type:'url', index:String(index), parameters:[{ type:'text', text:`${pkg.id}.${index}` }] });
        if (built?.durationButtonIndex != null) components.push({ type:'button', sub_type:'quick_reply', index:String(built.durationButtonIndex), parameters:[{ type:'payload', payload:'duration' }] });
      }
    }
    return this.callWhatsAppApi(config, { to, type:'template', template:{ name, language:{ code:'en_US' }, components } });
  }

  // Business name and logo exactly as customers see them in WhatsApp, for the
  // itinerary preview.
  async getBusinessProfile() {
    const fallback = { name: 'Errances Voyages', phone: null as string | null, pictureUrl: null as string | null };
    const config = await this.getConfig();
    if (!config) return fallback;
    if (config.provider === 'twilio') {
      const h = await this.twilio.health().catch(() => null);
      return { name: h?.senderName || fallback.name, phone: this.twilio.from.replace('whatsapp:', ''), pictureUrl: null };
    }
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
