import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PushService } from '../../common/push/push.service';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { Inject } from '@nestjs/common';
import { TwilioWhatsAppService, TWILIO_PSEUDO_ID } from '../integrations/whatsapp/twilio-whatsapp.service';
import { waNumber } from '../integrations/whatsapp/whatsapp-bot.service';
import { PG_POOL } from '../../common/db/pool.module';
import { FinanceRepository } from './finance.repository';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';

@Injectable()
export class FinanceService implements OnModuleInit {
  private logger = new Logger('FinanceService');

  constructor(
    private repo: FinanceRepository,
    @Inject(PG_POOL) private pool: Pool,
    private config: ConfigService,
    private push: PushService,
    private twilio: TwilioWhatsAppService,
  ) {}

  findInvoices(params: { branchId?: string; status?: string; type?: string; visibleTo?: string }) {
    return this.repo.findInvoices(params);
  }

  async assertInvoiceVisible(id: string, user: { userId?: string; roleName?: string } | undefined) {
    if (user?.roleName === 'super_admin') return;
    if (!user?.userId || !(await this.repo.invoiceVisible(id, user.userId))) throw new ForbiddenException("You don't have access to this invoice");
  }

  async findInvoiceById(id: string) {
    const invoice = await this.repo.findInvoiceById(id);
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async recordPayment(id: string, dto: RecordPaymentDto, branchId: string, userId: string | null) {
    const invoice = await this.repo.recordInvoicePayment(id, dto, branchId, userId);
    if (!invoice) throw new NotFoundException('Invoice not found');
    // Tell the customer straight away. Never fails the payment itself: the result says whether
    // the WhatsApp confirmation went out.
    const receipt = await this.sendPaymentReceipt(invoice, dto).catch((e) => ({ sent: false, reason: String(e?.message || e).slice(0, 200) }));
    const removedQuotations = await this.closeRequirement(id);
    return { ...invoice, receipt, removedQuotations };
  }

  // Record a payment against a quotation: its invoice is created on the spot if the customer
  // hasn't approved through the link yet, then this is a normal invoice payment.
  async recordQuotationPayment(quotationId: string, dto: RecordPaymentDto, branchId: string, userId: string | null, user?: { userId?: string; roleName?: string }) {
    if (user && user.roleName !== 'super_admin' && !(user.userId && await this.repo.quotationVisible(quotationId, user.userId))) throw new ForbiddenException("You don't have access to this quotation");
    const invoiceId = await this.repo.ensureInvoiceForQuotation(quotationId, userId);
    if (!invoiceId) throw new NotFoundException('Quotation not found');
    return this.recordPayment(invoiceId, dto, branchId, userId);
  }

  // WhatsApp needs the country code (see waNumber: Indian mobiles get 91, French 0X numbers 33).
  private waNumber(phone: string) {
    return waNumber(phone) || String(phone || '').replace(/\D/g, '');
  }

  private money(n: number) {
    return 'Rs. ' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  }

  // "Payment received" WhatsApp: the approved template when there is one (reaches the customer
  // any time), otherwise a plain message (only delivered inside WhatsApp's 24-hour window).
  private async sendPaymentReceipt(invoice: any, dto: RecordPaymentDto): Promise<{ sent: boolean; reason?: string; usedTemplate?: boolean }> {
    const phone: string | undefined = invoice.customer_phone;
    if (!phone) return { sent: false, reason: 'No customer phone number on this invoice' };
    const cfg = await this.whatsappConfig();
    const to = this.waNumber(phone);
    const baseUrl = (this.config.get<string>('ALLOWED_ORIGIN') || 'https://errances.socialmm.in').split(',')[0];
    const link = invoice.public_share_token ? `${baseUrl}/i/${invoice.public_share_token}` : null;
    const name = String(invoice.customer_name || 'there').slice(0, 60);
    const amount = this.money(dto.amount);
    const paid = this.money(invoice.paid_amount);
    const balance = this.money(invoice.balance_due);
    const tpl = await this.getTemplate('payment_receipt');
    const useTemplate = tpl.templateStatus === 'APPROVED' && !!tpl.templateName && !!invoice.public_share_token;
    const text = `Hi ${name}! ✅ We have received your payment of *${amount}* (${dto.method}${dto.reference ? `, ref ${dto.reference}` : ''}) for invoice *${invoice.invoice_number}*.\n\nPaid so far: ${paid}\nBalance: ${balance}${link ? `\n\nView and download your invoice: ${link}` : ''}\n\nThank you for choosing Errances Voyages! 🙏`;
    const body = useTemplate
      ? { messaging_product: 'whatsapp', to, type: 'template', template: { name: tpl.templateName, language: { code: 'en_US' }, components: [
          { type: 'body', parameters: [name, amount, String(invoice.invoice_number), paid, balance].map((t) => ({ type: 'text', text: t })) },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: invoice.public_share_token }] },
        ] } }
      : { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } };
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const res = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${cfg.phone_number_id}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.access_token_encrypted}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) return { sent: false, usedTemplate: useTemplate, reason: useTemplate ? (data?.error?.message || 'WhatsApp refused the message') : 'The customer has not messaged in the last 24 hours, and the payment-receipt template is not approved yet' };
    // Keep a copy in the lead's chat so the Inbox shows what the customer received.
    await this.pool.query(
      `INSERT INTO whatsapp_messages (phone_number, lead_id, direction, msg_type, body, wa_message_id, meta)
       SELECT $1, (SELECT q.lead_id FROM quotations q WHERE q.id = $2), 'out', 'text', $3, $4, $5`,
      [to, invoice.quotation_id ?? null, text, data?.messages?.[0]?.id ?? null, JSON.stringify({ waId: data?.messages?.[0]?.id ?? null, ...(useTemplate ? { template: tpl.templateName, buttons: [{ type: 'URL', text: 'View invoice' }] } : {}) })],
    ).catch(() => undefined);
    return { sent: true, usedTemplate: useTemplate };
  }

  // ---- Shared utility templates: payment_reminder and payment_receipt ----
  private readonly TEMPLATES: Record<string, { name: string; body: string; example: string[]; button?: boolean; quickReply?: string; category?: string }> = {
    payment_reminder: {
      name: 'payment_reminder_v2',
      body: 'Dear {{1}}, this is a payment reminder from Errances Voyages for invoice {{2}}. Amount received so far: {{3}} (last payment: {{4}}). Balance pending: {{5}}. Kindly make the remaining payment, or reply here if you have any questions. Thank you.',
      example: ['Mr. Ramesh', 'INV-1024', 'Rs. 10,000', '5 Oct 2026', 'Rs. 15,000'],
    },
    payment_receipt: {
      name: 'payment_receipt_v2',
      body: 'Hi {{1}}, we have received your payment of {{2}} for invoice {{3}}. Paid so far: {{4}}. Balance: {{5}}. Tap below to view and download your invoice. Thank you for choosing Errances Voyages!',
      example: ['Mr. Ramesh', 'Rs. 10,000', 'INV-1024', 'Rs. 10,000', 'Rs. 15,000'],
      button: true,
    },
    // Sent by staff from a closed chat ("Send template to re-open"). Replaces the old welcome
    // message, whose "Yes, send itinerary" button confused customers who already had the itinerary.
    chat_reopen: {
      name: 'chat_reopen_v1',
      body: 'Hello {{1}}, this is Errances Voyages regarding your {{2}} enquiry. Our travel expert is ready to help you plan your trip. Please reply to this message with your questions, or tap the button below and we will call you.',
      example: ['Mr. Martin', 'Bali'],
      quickReply: 'Call our experts',
      category: 'MARKETING',
    },
  };

  // Meta never tells us when it approves; re-check every 15 minutes while anything is pending.
  onModuleInit() {
    setInterval(() => this.runDueReminders().catch((e) => this.logger.warn(`Scheduled reminders failed: ${e.message}`)), 60 * 1000);
    setInterval(async () => {
      for (const kind of Object.keys(this.TEMPLATES)) {
        const t = await this.getTemplate(kind).catch(() => null);
        if (t?.templateId && t.templateStatus === 'PENDING') await this.syncTemplate(kind).catch((e) => this.logger.warn(`${kind} template check failed: ${e.message}`));
      }
    }, 15 * 60 * 1000);
  }

  private async whatsappConfig() {
    if (this.twilio.isConfigured()) return { phone_number_id: TWILIO_PSEUDO_ID, business_account_id: TWILIO_PSEUDO_ID, access_token_encrypted: TWILIO_PSEUDO_ID };
    const { rows } = await this.pool.query(
      `SELECT phone_number_id, business_account_id, access_token_encrypted FROM whatsapp_config WHERE is_configured = true ORDER BY created_at DESC LIMIT 1`);
    const cfg = rows[0];
    if (!cfg?.phone_number_id || !cfg?.access_token_encrypted) throw new BadRequestException('WhatsApp is not configured (Settings > WhatsApp)');
    return cfg as { phone_number_id: string; business_account_id: string; access_token_encrypted: string };
  }

  private assertKind(kind: string) {
    if (!this.TEMPLATES[kind]) throw new BadRequestException('Unknown template');
  }

  async getTemplate(kind: string) {
    this.assertKind(kind);
    const { rows } = await this.pool.query(`SELECT * FROM utility_templates WHERE kind = $1`, [kind]);
    const row = rows[0];
    // The exact wording Meta is asked to approve, and the same wording with sample values filled in.
    const def = this.TEMPLATES[kind];
    const preview = def.body.replace(/\{\{(\d+)\}\}/g, (_m: string, n: string) => def.example[Number(n) - 1] ?? '');
    return { kind, body: def.body, preview, button: def.button ? 'View invoice' : (def.quickReply ?? null), templateId: row?.template_id ?? null, templateName: row?.template_name ?? null, templateStatus: row?.template_status ?? null, templateRejectionReason: row?.template_rejection_reason ?? null };
  }

  async getTemplates() {
    return { payment_reminder: await this.getTemplate('payment_reminder'), payment_receipt: await this.getTemplate('payment_receipt'), chat_reopen: await this.getTemplate('chat_reopen') };
  }

  async submitTemplate(kind: string) {
    this.assertKind(kind);
    const cfg = await this.whatsappConfig();
    if (!cfg.business_account_id) throw new BadRequestException('WhatsApp business account ID is not configured');
    const existing = await this.getTemplate(kind);
    if (existing.templateId && existing.templateStatus !== 'REJECTED') return existing;
    const def = this.TEMPLATES[kind];
    const baseUrl = (this.config.get<string>('ALLOWED_ORIGIN') || 'https://errances.socialmm.in').split(',')[0];
    const components: any[] = [{ type: 'BODY', text: def.body, example: { body_text: [def.example] } }];
    if (def.button) components.push({ type: 'BUTTONS', buttons: [{ type: 'URL', text: 'View invoice', url: `${baseUrl}/i/{{1}}`, example: [`${baseUrl}/i/sample-token`] }] });
    if (def.quickReply) components.push({ type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: def.quickReply }] });
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const res = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${cfg.business_account_id}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.access_token_encrypted}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: def.name, language: 'en_US', category: def.category ?? 'UTILITY', components }),
    });
    const created: any = await res.json();
    if (!res.ok || !created.id) throw new BadRequestException(`Meta template submission failed: ${created?.error?.error_user_msg || created?.error?.message || res.status}`);
    await this.pool.query(
      `INSERT INTO utility_templates (kind, template_id, template_name, template_status, submitted_at, checked_at) VALUES ($1, $2, $3, $4, now(), now())
       ON CONFLICT (kind) DO UPDATE SET template_id=$2, template_name=$3, template_status=$4, template_rejection_reason=NULL, submitted_at=now(), checked_at=now()`,
      [kind, created.id, def.name, String(created.status || 'PENDING').toUpperCase()]);
    return this.getTemplate(kind);
  }

  async syncTemplate(kind: string) {
    const cfg = await this.whatsappConfig();
    const existing = await this.getTemplate(kind);
    if (!existing.templateId) throw new BadRequestException('No template submitted yet');
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const res = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${existing.templateId}?fields=id,name,status,rejected_reason&access_token=${encodeURIComponent(cfg.access_token_encrypted)}`);
    const data: any = await res.json();
    if (!res.ok) throw new BadRequestException(data?.error?.message || 'Could not check template status');
    await this.pool.query(`UPDATE utility_templates SET template_status=$2, template_rejection_reason=$3, checked_at=now() WHERE kind=$1`,
      [kind, String(data.status || existing.templateStatus).toUpperCase(), data.rejected_reason && data.rejected_reason !== 'NONE' ? data.rejected_reason : null]);
    return this.getTemplate(kind);
  }

  // Kept for the invoice screen's existing calls.
  getReminderTemplate() { return this.getTemplate('payment_reminder'); }
  submitReminderTemplate() { return this.submitTemplate('payment_reminder'); }
  syncReminderTemplate() { return this.syncTemplate('payment_reminder'); }

  // Manual reminder, sent on request only -- no auto-nagging. With the approved template it
  // reaches the customer any time; until then it falls back to a plain message, which Meta only
  // delivers if the customer wrote to us in the last 24 hours.
  async sendPaymentReminder(id: string, userId: string | null) {
    const invoice = await this.repo.findInvoiceById(id);
    if (!invoice) throw new NotFoundException('Invoice not found');
    const phone: string | undefined = invoice.customer_phone;
    if (!phone) throw new BadRequestException('This invoice has no customer/lead phone number to send to');
    if (invoice.cancelled_at) throw new BadRequestException('This booking is cancelled -- there is nothing to remind about');
    if (Number(invoice.balance_due || 0) <= 0) throw new BadRequestException('This invoice is fully paid -- there is nothing to remind about');
    const cfg = await this.whatsappConfig();
    const tpl = await this.getReminderTemplate();

    const rupees = (n: any) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n) || 0);
    const name = String(invoice.customer_name || 'Customer').slice(0, 60);
    const paid = Number(invoice.paid_amount || 0);
    const lastPayment = (invoice.payments ?? []).filter((p: any) => p.status === 'completed')[0];
    const lastPaidOn = lastPayment ? new Date(lastPayment.paid_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : 'no payment yet';
    const baseUrl = (this.config.get<string>('ALLOWED_ORIGIN') || 'https://errances.socialmm.in').split(',')[0];
    const link = invoice.public_share_token ? `${baseUrl}/i/${invoice.public_share_token}` : '';
    const body = `Dear ${name},\n\nThis is a payment reminder from Errances Voyages for invoice *${invoice.invoice_number}*.\n\n` +
      `*Invoice total:* ${rupees(invoice.total_amount)}\n` +
      (paid > 0 ? `*Received so far:* ${rupees(paid)} (last payment on ${lastPaidOn})\n` : '') +
      `*Balance pending:* ${rupees(invoice.balance_due)}\n\nKindly make the remaining payment.` +
      (link ? `\n\nView your invoice and how to pay:\n${link}` : '') + `\n\nThank you.\nErrances Voyages`;
    const useTemplate = tpl.templateStatus === 'APPROVED' && !!tpl.templateName;
    const to = this.waNumber(phone);
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const res = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${cfg.phone_number_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.access_token_encrypted}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(useTemplate
        ? { messaging_product: 'whatsapp', to, type: 'template', template: { name: tpl.templateName, language: { code: 'en_US' }, components: [{ type: 'body', parameters: [name, invoice.invoice_number, rupees(paid), lastPaidOn, rupees(invoice.balance_due)].map((text) => ({ type: 'text', text: String(text) })) }] } }
        : { messaging_product: 'whatsapp', to, type: 'text', text: { body, preview_url: true } }),
    });
    if (!res.ok) {
      const text = await res.text();
      let reason = '';
      try { reason = JSON.parse(text)?.error?.error_data?.details || JSON.parse(text)?.error?.message || ''; } catch { /* not JSON */ }
      throw new BadRequestException(`WhatsApp did not accept the reminder${reason ? `: ${reason}` : ''}${useTemplate ? '' : ' (until the reminder template is approved, it only reaches customers who messaged in the last 24 hours)'}`);
    }
    // Keep it in the customer's Inbox chat too, so the CRM mirrors the phone.
    const sent: any = await res.json().catch(() => null);
    const waId: string | null = sent?.messages?.[0]?.id ?? null;
    const { rows: leadRow } = await this.pool.query(`SELECT q.lead_id FROM invoices i LEFT JOIN quotations q ON q.id = i.quotation_id WHERE i.id = $1`, [id]).catch(() => ({ rows: [] as any[] }));
    await this.pool.query(
      `INSERT INTO whatsapp_messages(phone_number, lead_id, direction, msg_type, body, wa_message_id, sent_by, meta) VALUES($1,$2,'out','text',$3,$4,$5,$6)`,
      [to, leadRow[0]?.lead_id ?? null, body, waId, userId, waId ? JSON.stringify({ waId }) : null],
    ).catch((err) => this.logger.warn(`Could not save the reminder to the Inbox: ${err.message}`));
    return { success: true, sentTo: phone, usedTemplate: useTemplate };
  }

  // ---- Reminders set for a date and time ----
  paymentReminderBoard(visibleTo?: string) {
    return this.repo.paymentReminderBoard(visibleTo);
  }

  async listReminders(invoiceId: string) {
    const { rows } = await this.pool.query(
      `SELECT r.id, r.send_at, r.status, r.error, r.sent_at, r.created_at, u.full_name AS created_by_name
         FROM invoice_reminders r LEFT JOIN users u ON u.id = r.created_by WHERE r.invoice_id = $1 ORDER BY r.send_at DESC LIMIT 50`, [invoiceId]);
    return { data: rows };
  }

  async scheduleReminder(invoiceId: string, sendAt: string, userId: string | null) {
    const when = new Date(sendAt);
    if (isNaN(when.getTime())) throw new BadRequestException('Choose a date and time for the reminder');
    if (when.getTime() < Date.now() + 60_000) throw new BadRequestException('Choose a time in the future (or use Send now)');
    const invoice = await this.repo.findInvoiceById(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (Number(invoice.balance_due || 0) <= 0) throw new BadRequestException('This invoice is fully paid -- there is nothing to remind about');
    // One open reminder per customer: a new date replaces the one already set, on this invoice
    // and on any other invoice of the same customer.
    const { rowCount: replaced } = await this.pool.query(
      `UPDATE invoice_reminders r SET status = 'cancelled', error = 'Rescheduled'
        WHERE r.status = 'scheduled' AND (r.invoice_id = $1 OR r.invoice_id IN (
              SELECT i2.id FROM invoices i1 JOIN quotations q1 ON q1.id = i1.quotation_id JOIN quotations q2 ON q2.lead_id = q1.lead_id JOIN invoices i2 ON i2.quotation_id = q2.id
               WHERE i1.id = $1 AND q1.lead_id IS NOT NULL))`,
      [invoiceId],
    );
    const { rows } = await this.pool.query(`INSERT INTO invoice_reminders(invoice_id, send_at, created_by) VALUES($1,$2,$3) RETURNING *`, [invoiceId, when.toISOString(), userId]);
    return { ...rows[0], rescheduled: (replaced ?? 0) > 0 };
  }

  async cancelReminder(reminderId: string) {
    const { rows } = await this.pool.query(`UPDATE invoice_reminders SET status = 'cancelled' WHERE id = $1 AND status = 'scheduled' RETURNING id, invoice_id`, [reminderId]);
    if (!rows[0]) throw new NotFoundException('This reminder is no longer scheduled');
    return rows[0];
  }

  // Runs every minute: sends each reminder whose time has come, once.
  private async runDueReminders() {
    const { rows } = await this.pool.query(
      `UPDATE invoice_reminders SET status = 'sending' WHERE id IN (SELECT id FROM invoice_reminders WHERE status = 'scheduled' AND send_at <= now() ORDER BY send_at LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING id, invoice_id, created_by`);
    for (const r of rows) {
      const invoice = await this.repo.findInvoiceById(r.invoice_id).catch(() => null);
      if (!invoice || Number(invoice.balance_due || 0) <= 0) {
        await this.pool.query(`UPDATE invoice_reminders SET status = 'skipped', error = $2 WHERE id = $1`, [r.id, invoice ? 'Invoice was already fully paid' : 'Invoice no longer exists']);
        continue;
      }
      const who = `${invoice.customer_name || 'Customer'} · ${invoice.invoice_number} · balance ${this.money(invoice.balance_due)}`;
      await this.sendPaymentReminder(r.invoice_id, r.created_by)
        .then(async () => {
          await this.pool.query(`UPDATE invoice_reminders SET status = 'sent', sent_at = now() WHERE id = $1`, [r.id]);
          this.push.notifyAll({ title: 'Payment reminder sent', body: `${who}. Follow up to collect it.`, url: '/payment-reminders' }).catch(() => undefined);
        })
        .catch(async (e) => {
          await this.pool.query(`UPDATE invoice_reminders SET status = 'failed', error = $2 WHERE id = $1`, [r.id, String(e.message || e).slice(0, 500)]);
          this.push.notifyAll({ title: 'Payment reminder could not be sent', body: `${who}. Call the customer or send it from WhatsApp.`, url: '/payment-reminders' }).catch(() => undefined);
        });
    }
  }

  // One requirement can have several quotations. When the invoice of one of them is paid in full,
  // that quotation is the one that happened: the others for the same requirement move to the
  // Trash straight away (restorable for 60 days). The paid one is never removed automatically.
  private async closeRequirement(invoiceId: string): Promise<number> {
    const { rows } = await this.pool.query(
      `UPDATE quotations o SET is_deleted = true, updated_at = now()
         FROM invoices i JOIN quotations q ON q.id = i.quotation_id
        WHERE i.id = $1 AND i.is_deleted = false AND i.status = 'paid'
          AND o.lead_id = q.lead_id AND o.requirement_no = q.requirement_no AND o.id <> q.id AND o.is_deleted = false
          AND NOT EXISTS (SELECT 1 FROM payments p JOIN invoices oi ON oi.id = p.invoice_id WHERE oi.quotation_id = o.id AND oi.is_deleted = false AND p.is_deleted = false AND p.status = 'completed')
        RETURNING o.id`,
      [invoiceId],
    ).catch((e) => { this.logger.warn(`Could not close the requirement for invoice ${invoiceId}: ${e.message}`); return { rows: [] as any[] }; });
    if (rows.length) {
      // their unpaid invoices (if a customer had approved one of them) go with them
      await this.pool.query(`UPDATE invoices SET is_deleted = true, updated_at = now() WHERE quotation_id = ANY($1::uuid[]) AND is_deleted = false`, [rows.map((r) => r.id)]).catch(() => undefined);
      this.logger.log(`Invoice ${invoiceId} paid in full: ${rows.length} other quotation(s) of the same requirement moved to the Trash`);
    }
    return rows.length;
  }

  // ---- Cancellation and refund ----
  // Cancel the booking behind an invoice and/or refund money against it. The refund is whatever
  // the cancellation policy allows (never more than was paid and not yet refunded); the rest
  // stays with the company and shows as "retained".
  async cancelOrRefund(invoiceId: string, dto: { cancel?: boolean; reason?: string; refundAmount?: number; method?: string; reference?: string; policyNote?: string; deductionAmount?: number }, userId: string | null) {
    const invoice = await this.repo.findInvoiceById(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found');
    const refund = Number(dto.refundAmount) || 0;
    const refundable = Math.max(Number(invoice.paid_amount) - Number(invoice.refunded_amount), 0);
    if (refund < 0) throw new BadRequestException('The refund cannot be negative');
    if (refund > refundable) throw new BadRequestException(`The refund cannot be more than ${this.money(refundable)} (what was paid and not yet refunded)`);
    if (!dto.cancel && refund <= 0) throw new BadRequestException('Enter a refund amount, or choose to cancel the booking');
    if (dto.cancel && invoice.cancelled_at) throw new BadRequestException('This booking is already cancelled');
    const reason = String(dto.reason || '').trim().slice(0, 500) || null;
    if (dto.cancel && !reason) throw new BadRequestException('Note the reason for the cancellation');
    const policy = String(dto.policyNote || '').trim().slice(0, 1000) || null;
    if (refund > 0) {
      await this.pool.query(
        `INSERT INTO refunds(invoice_id, booking_id, amount, reason, method, reference, status, branch_id, created_by, approved_by) VALUES($1,$2,$3,$4,$5,$6,'completed',$7,$8,$8)`,
        [invoiceId, invoice.booking_id ?? null, Math.round(refund), reason, dto.method || 'bank_transfer', String(dto.reference || '').trim() || null, invoice.branch_id ?? null, userId],
      ).catch((e) => { throw new BadRequestException(`Could not record the refund: ${e.message}`); });
    }
    if (dto.cancel) {
      await this.pool.query(`UPDATE invoices SET cancelled_at = now(), cancelled_by = $2, cancel_reason = $3, cancel_policy = $4, cancel_deduction = $5, updated_at = now() WHERE id = $1`,
        [invoiceId, userId, reason, policy, Math.round(Math.max(refundable - refund, 0))]);
      await this.pool.query(`UPDATE invoice_reminders SET status = 'cancelled', error = 'Booking cancelled' WHERE invoice_id = $1 AND status = 'scheduled'`, [invoiceId]);
    }
    return this.repo.findInvoiceById(invoiceId);
  }

  // Undo a cancellation made by mistake (refunds already recorded stay as they are).
  async reopenInvoice(invoiceId: string) {
    const { rows } = await this.pool.query(`UPDATE invoices SET cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL, cancel_policy = NULL, cancel_deduction = NULL, updated_at = now() WHERE id = $1 AND cancelled_at IS NOT NULL RETURNING id`, [invoiceId]);
    if (!rows[0]) throw new NotFoundException('This booking is not cancelled');
    return this.repo.findInvoiceById(invoiceId);
  }

  // ---- Correcting a payment that was entered wrongly ----
  async updatePayment(paymentId: string, dto: { amount?: number; method?: string; reference?: string; paidAt?: string }) {
    const sets: string[] = [];
    const args: any[] = [];
    if (dto.amount !== undefined) { const a = Number(dto.amount); if (!(a > 0)) throw new BadRequestException('Enter an amount above zero'); args.push(a); sets.push(`amount = $${args.length}`); }
    if (dto.method !== undefined) { args.push(dto.method); sets.push(`method = $${args.length}`); }
    if (dto.reference !== undefined) { args.push(dto.reference || null); sets.push(`reference = $${args.length}`); }
    if (dto.paidAt) { const d = new Date(dto.paidAt); if (isNaN(d.getTime())) throw new BadRequestException('That payment date is not valid'); args.push(d.toISOString()); sets.push(`paid_at = $${args.length}`); }
    if (!sets.length) throw new BadRequestException('Nothing to change');
    args.push(paymentId);
    const { rows } = await this.pool.query(`UPDATE payments SET ${sets.join(', ')} WHERE id = $${args.length} AND is_deleted = false RETURNING invoice_id`, args)
      .catch((e) => { throw new BadRequestException(`Could not save the payment: ${e.message}`); });
    if (!rows[0]) throw new NotFoundException('Payment not found');
    const refreshed = await this.refreshInvoiceStatus(rows[0].invoice_id);
    if (rows[0].invoice_id) await this.closeRequirement(rows[0].invoice_id);
    return refreshed;
  }

  async removePayment(paymentId: string) {
    const { rows } = await this.pool.query(`UPDATE payments SET is_deleted = true WHERE id = $1 AND is_deleted = false RETURNING invoice_id`, [paymentId]);
    if (!rows[0]) throw new NotFoundException('Payment not found');
    return this.refreshInvoiceStatus(rows[0].invoice_id);
  }

  async paymentInvoiceId(paymentId: string): Promise<string | null> {
    const { rows } = await this.pool.query(`SELECT invoice_id FROM payments WHERE id = $1 AND is_deleted = false`, [paymentId]);
    return rows[0]?.invoice_id ?? null;
  }

  private async refreshInvoiceStatus(invoiceId: string | null) {
    if (!invoiceId) return null;
    await this.pool.query(
      `UPDATE invoices i SET updated_at = now(), status = (CASE
           WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.is_deleted = false AND p.status = 'completed'), 0) >= i.total_amount THEN 'paid'
           WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.is_deleted = false AND p.status = 'completed'), 0) > 0 THEN 'partial' ELSE 'pending' END)::payment_status
        WHERE i.id = $1`, [invoiceId]);
    return this.repo.findInvoiceById(invoiceId);
  }

  async createInvoice(dto: CreateInvoiceDto, branchId: string, userId: string | null) {
    const invoice = await this.repo.createInvoice(dto, branchId, userId);
    if (!invoice) throw new NotFoundException('Booking not found');
    return invoice;
  }

  async updateInvoice(id: string, dto: UpdateInvoiceDto) {
    const updated = await this.repo.updateInvoice(id, dto);
    if (!updated) throw new NotFoundException('Invoice not found');
    return updated;
  }

  async removeInvoice(id: string) {
    const deleted = await this.repo.softDeleteInvoice(id);
    if (!deleted) throw new NotFoundException('Invoice not found');
    return deleted;
  }

  kpis(branchId?: string) {
    return this.repo.kpis(branchId);
  }

  findPayments(params: { branchId?: string; status?: string }) {
    return this.repo.findPayments(params);
  }

  findOverdueInstallments(branchId?: string) {
    return this.repo.findOverdueInstallments(branchId);
  }

  findTodayPtaCollections(branchId?: string) {
    return this.repo.findTodayPtaCollections(branchId);
  }

  async verifyPayment(id: string, userId: string | null) {
    const payment = await this.repo.verifyPayment(id, userId);
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async rejectPayment(id: string, userId: string | null, reason: string | null) {
    const payment = await this.repo.rejectPayment(id, userId, reason);
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }
}
