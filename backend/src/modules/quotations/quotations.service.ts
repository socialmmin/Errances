import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { TwilioWhatsAppService, TWILIO_PSEUDO_ID } from '../integrations/whatsapp/twilio-whatsapp.service';
import { waNumber } from '../integrations/whatsapp/whatsapp-bot.service';
import { PG_POOL } from '../../common/db/pool.module';
import { QuotationsRepository, quotationVisibleSql } from './quotations.repository';
import { seesAllLeads } from '../../common/leads/lead-visibility';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { advanceLeadStatus } from '../../common/leads/advance-lead-status';
import { PushService } from '../../common/push/push.service';

@Injectable()
export class QuotationsService implements OnModuleInit {
  private logger = new Logger('QuotationsService');

  constructor(
    private repo: QuotationsRepository,
    @Inject(PG_POOL) private pool: Pool,
    private config: ConfigService,
    private push: PushService,
    private twilio: TwilioWhatsAppService,
  ) {}

  findAll(params: { branchId?: string; visibleTo?: string; status?: string; search?: string; from?: string; to?: string; category?: string; destination?: string; page?: number; pageSize?: number }) {
    return this.repo.findAll({      branchId: params.branchId,
      visibleTo: params.visibleTo,
      status: params.status,
      search: params.search,
      from: params.from, to: params.to, category: params.category, destination: params.destination,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 100,
    });
  }  stats(branchId?: string, visibleTo?: string) {
    return this.repo.stats(branchId, visibleTo);
  }  requirementsForLead(leadId: string) {
    return this.repo.requirementsForLead(leadId);
  }

  async findOne(id: string) {
    const quotation = await this.repo.findOne(id);
    if (!quotation) throw new NotFoundException('Quotation not found');
    return quotation;
  }

  // Salespeople may only open quotations they created or that belong to a lead they can see.
  async assertVisible(id: string, user: { userId?: string; roleName?: string } | undefined) {
    if (seesAllLeads(user)) return;
    const { rows } = await this.pool.query(
      `SELECT ${quotationVisibleSql('q', '$2')} AS ok FROM quotations q WHERE q.id = $1 AND q.is_deleted = false`,
      [id, user?.userId ?? null],
    );
    if (!rows[0]) throw new NotFoundException('Quotation not found');
    if (!rows[0].ok) throw new ForbiddenException("You don't have access to this quotation");
  }

  async findByShareToken(token: string) {
    const quotation = await this.repo.findByShareToken(token);
    if (!quotation) throw new NotFoundException('Quotation not found');
    return quotation;
  }

  async approveByToken(token: string, signature?: string | null) {
    const result = await this.repo.approveByToken(token, signature).catch((err: Error) => {
      throw new BadRequestException(err.message);
    });
    if (!result) throw new NotFoundException('Quotation not found');
    // The customer just signed: tell the team straight away so the payment can be collected.
    if (!result.alreadyApproved) {
      const q = result.quotation;
      const { rows } = await this.pool.query(
        `SELECT COALESCE(c.full_name, l.customer_name, 'Customer') AS name FROM quotations q LEFT JOIN customers c ON c.id = q.customer_id LEFT JOIN leads l ON l.id = q.lead_id WHERE q.id = $1`, [q.id],
      ).catch(() => ({ rows: [] as any[] }));
      const amount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(q.final_amount) || 0);
      this.push.notifyAll({
        title: `Quotation approved — ${rows[0]?.name ?? 'Customer'}`,
        body: `${q.quotation_number}${q.destination ? ` · ${q.destination}` : ''} · ${amount} signed. Invoice ${result.invoice?.invoice_number ?? ''} is ready — collect the payment.`,
        url: '/quotations',
      }).catch((err) => this.logger.warn(`Approval push failed: ${err.message}`));
      await advanceLeadStatus(this.pool, q.lead_id, 'negotiation').catch(() => undefined);
    }
    return result;
  }

  // Sends the customer-facing share link via WhatsApp, using the number on
  // the quotation's customer/lead record and the CRM's stored WhatsApp send
  // credentials (Settings > WhatsApp). Uses the approved quotation template
  // (route + total + a "View quotation" button) once one exists; falls back
  // to a plain text message with the link when no approved template is set
  // up yet, same as before.
  // `customText` is the message as staff edited it in the preview pop-up; when given it is sent
  // exactly as written (a plain message), otherwise the approved template / default wording goes.
  // `edited` false = the standard wording untouched, so the approved template may go instead.
  async sendViaWhatsApp(id: string, userId: string | null, customText?: string, edited = true) {
    const quotation = await this.repo.findOne(id);
    if (!quotation) throw new NotFoundException('Quotation not found');

    const toNumber: string | undefined = quotation.customer_phone || quotation.lead_phone;
    if (!toNumber) {
      throw new BadRequestException('This quotation has no customer/lead phone number to send to');
    }
    const customerName = quotation.customer_name || quotation.lead_customer_name || 'there';

    const config = await this.getWhatsAppConfig();
    if (!config) {
      throw new BadRequestException('WhatsApp is not configured (Settings > WhatsApp) -- cannot send');
    }

    const baseUrl = (this.config.get<string>('ALLOWED_ORIGIN') || 'https://errances.socialmm.in').split(',')[0];
    const link = `${baseUrl}/q/${quotation.public_share_token}`;
    const amount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
      quotation.final_amount || 0,
    );
    const day = (d: any) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
    const route = quotation.travel_from && quotation.travel_to
      ? `${quotation.destination ? `${quotation.destination}, ` : ''}${day(quotation.travel_from)} to ${day(quotation.travel_to)}`
      : (quotation.destination || 'your trip');

    const templateSettings = await this.getTemplateSettings();
    const digits = toNumber.replace(/[^\d]/g, '');
    const text = customText?.trim();
    const templateReady = templateSettings.templateStatus === 'APPROVED' && !!templateSettings.templateName;
    const usePlain = !!text && (edited || !templateReady);
    const to = waNumber(digits) || digits;
    let sentBody = '';
    let sent: any;
    if (usePlain) {
      sentBody = text!.slice(0, 4000);
      sent = await this.callWhatsAppApi(config, { to, type: 'text', text: { body: sentBody, preview_url: true } });
    } else if (templateReady) {
      sentBody = `Hi ${customerName}! Your travel quotation *${quotation.quotation_number}* for ${route} is ready — total *${amount}*. Tap below to view full details and approve.\n${link}`;
      sent = await this.callWhatsAppApi(config, {
        to,
        type: 'template',
        template: {
          name: templateSettings.templateName,
          language: { code: 'en_US' },
          components: [
            { type: 'body', parameters: [
              { type: 'text', text: customerName },
              { type: 'text', text: quotation.quotation_number },
              { type: 'text', text: route },
              { type: 'text', text: amount },
            ] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: quotation.public_share_token }] },
          ],
        },
      });
    } else {
      const body =
        `Dear ${customerName},\n\nYour quotation *${quotation.quotation_number}*` +
        `${quotation.destination ? ` for ${quotation.destination}` : ''} is ready. Total: *${amount}*.\n\n` +
        `View the full details here:\n${link}\n\n` +
        `Errances Voyages`;
      sentBody = body;
      sent = await this.callWhatsAppApi(config, { to, type: 'text', text: { body, preview_url: true } });
    }
    const waId: string | null = sent?.messages?.[0]?.id ?? null;
    await this.pool.query(
      `INSERT INTO whatsapp_messages(phone_number, lead_id, direction, msg_type, body, wa_message_id, sent_by, meta) VALUES($1,$2,'out','text',$3,$4,$5,$6)`,
      [to, quotation.lead_id ?? null, sentBody, waId, userId, waId ? JSON.stringify({ waId }) : null],
    ).catch((err) => this.logger.warn(`Could not save the quotation message to the Inbox: ${err.message}`));

    if (quotation.status === 'draft') {
      await this.repo.updateStatus(id, 'sent', userId);
    }
    await advanceLeadStatus(this.pool, quotation.lead_id, 'quotation_sent');
    this.logger.log(`Quotation ${quotation.quotation_number} sent via WhatsApp to ${toNumber}`);
    return { success: true, sentTo: toNumber, link, usedTemplate: !usePlain && templateReady };
  }

  private async getWhatsAppConfig(): Promise<{ phone_number_id: string; business_account_id: string; access_token: string } | null> {
    if (this.twilio.isActive()) return { phone_number_id: TWILIO_PSEUDO_ID, business_account_id: TWILIO_PSEUDO_ID, access_token: TWILIO_PSEUDO_ID };
    const { rows } = await this.pool.query(
      `SELECT phone_number_id, business_account_id, access_token_encrypted FROM whatsapp_config WHERE is_configured = true ORDER BY created_at DESC LIMIT 1`,
    );
    const row = rows[0];
    if (!row?.phone_number_id || !row?.access_token_encrypted) return null;
    return { phone_number_id: row.phone_number_id, business_account_id: row.business_account_id, access_token: row.access_token_encrypted };
  }

  // Meta never tells us when it approves a template; without this a submitted template stays
  // "PENDING" in the CRM (and quotations keep going out as plain text) until someone presses
  // "Check status". Re-check every 15 minutes while it's pending.
  onModuleInit() {
    setInterval(async () => {
      const t = await this.getTemplateSettings().catch(() => null);
      if (t?.templateId && t.templateStatus === 'PENDING') {
        await this.syncTemplateStatus().catch((err) => this.logger.warn(`Quotation template check failed: ${err.message}`));
      }
    }, 15 * 60 * 1000);
  }

  async getTemplateSettings() {
    const { rows } = await this.pool.query(`SELECT * FROM quotation_template_settings WHERE id = true`);
    const row = rows[0];
    return {
      templateId: row?.template_id ?? null,
      templateName: row?.template_name ?? null,
      templateStatus: row?.template_status ?? null,
      templateRejectionReason: row?.template_rejection_reason ?? null,
    };
  }

  // Submits the one shared "quotation ready" template to Meta for approval, if not
  // already submitted. One template covers every quotation -- customer name, quotation
  // number, route and total are body variables; the button carries the share token as its
  // dynamic URL suffix so it lands on that specific quotation's public link.
  async submitTemplate() {
    const config = await this.getWhatsAppConfig();
    if (!config) throw new BadRequestException('WhatsApp is not configured (Settings > WhatsApp)');
    if (!config.business_account_id) throw new BadRequestException('WhatsApp business account ID is not configured');

    const existing = await this.getTemplateSettings();
    if (existing.templateId) return existing;

    const baseUrl = (this.config.get<string>('ALLOWED_ORIGIN') || 'https://errances.socialmm.in').split(',')[0];
    const templateName = 'quotation_ready_v1';
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
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
            text: `Hi {{1}}! Your travel quotation *{{2}}* for {{3}} is ready — total *{{4}}*. Tap below to view full details and approve.`,
            example: { body_text: [['Mr. Ramesh', 'Q-1024', 'Chennai to Bangkok', '₹85,000']] },
          },
          {
            type: 'BUTTONS',
            buttons: [{ type: 'URL', text: 'View Quotation', url: `${baseUrl}/q/{{1}}`, example: [`${baseUrl}/q/sample-token`] }],
          },
        ],
      }),
    });
    const created: any = await res.json();
    if (!res.ok || !created.id) throw new BadRequestException(`Meta template submission failed: ${created?.error?.error_user_msg || created?.error?.message || res.status}`);
    const status = String(created.status || 'PENDING').toUpperCase();
    await this.pool.query(
      `INSERT INTO quotation_template_settings (id, template_id, template_name, template_status, submitted_at, checked_at)
       VALUES (true, $1, $2, $3, now(), now())
       ON CONFLICT (id) DO UPDATE SET template_id=$1, template_name=$2, template_status=$3, template_rejection_reason=NULL, submitted_at=now(), checked_at=now()`,
      [created.id, templateName, status],
    );
    return this.getTemplateSettings();
  }

  async syncTemplateStatus() {
    const config = await this.getWhatsAppConfig();
    if (!config) throw new BadRequestException('WhatsApp is not configured (Settings > WhatsApp)');
    const existing = await this.getTemplateSettings();
    if (!existing.templateId) throw new BadRequestException('No template submitted yet');

    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const res = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${existing.templateId}?fields=id,name,status,rejected_reason&access_token=${encodeURIComponent(config.access_token)}`);
    const data: any = await res.json();
    if (!res.ok) throw new BadRequestException(data?.error?.message || 'Could not check template status');
    const status = String(data.status || existing.templateStatus).toUpperCase();
    await this.pool.query(
      `UPDATE quotation_template_settings SET template_status=$1, template_rejection_reason=$2, checked_at=now() WHERE id=true`,
      [status, data.rejected_reason || null],
    );
    return this.getTemplateSettings();
  }

  private async callWhatsAppApi(config: { phone_number_id: string; access_token: string }, payload: Record<string, unknown>) {
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const res = await this.twilio.graphFetch(`https://graph.facebook.com/${version}/${config.phone_number_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`WhatsApp send failed: ${res.status} ${text}`);
      let reason = '';
      try { reason = JSON.parse(text)?.error?.error_data?.details || JSON.parse(text)?.error?.message || ''; } catch { /* not JSON */ }
      throw new BadRequestException(`WhatsApp did not accept the message${reason ? `: ${reason}` : ''}`);
    }
    return res.json().catch(() => null);
  }

  create(dto: CreateQuotationDto, userId: string | null) {
    return this.repo.create(dto, userId);
  }

  // Once a quotation is approved (or has an invoice / a payment), what was agreed is frozen: the
  // existing line items and the discount/GST can't be changed or removed. Extra services can
  // still be ADDED as new lines; the linked invoice's total follows.
  async update(id: string, dto: UpdateQuotationDto) {
    const current = await this.repo.findOne(id);
    if (!current) throw new NotFoundException('Quotation not found');
    const locked = ['accepted', 'converted'].includes(current.status) || !!current.invoice_id;
    if (locked) {
      const sig = (i: any) => [i.category, String(i.description ?? '').trim(), Number(i.quantity ?? 1), Number(i.unitCost ?? i.unit_cost ?? 0), Number(i.markupPct ?? i.markup_pct ?? 0)].join('|');
      if (dto.items !== undefined) {
        const incoming = dto.items.map(sig);
        for (const old of (current.items ?? []).map(sig)) {
          const at = incoming.indexOf(old);
          if (at < 0) throw new BadRequestException('This quotation is approved -- the agreed items cannot be changed or removed. You can only add new services.');
          incoming.splice(at, 1);
        }
      }
      const base = Number(current.base_amount) || 0;
      const oldDiscount = base > 0 ? (Number(current.discount_amount) / base) * 100 : 0;
      const taxable = base - Number(current.discount_amount);
      const oldGst = taxable > 0 ? (Number(current.gst_amount) / taxable) * 100 : 0;
      if (dto.discountPct !== undefined && Math.abs(Number(dto.discountPct) - oldDiscount) > 0.01) throw new BadRequestException('This quotation is approved -- the agreed discount cannot be changed.');
      if (dto.gstPct !== undefined && Math.abs(Number(dto.gstPct) - oldGst) > 0.01) throw new BadRequestException('This quotation is approved -- the agreed GST cannot be changed.');
    }
    const updated = await this.repo.update(id, dto);
    if (!updated) throw new NotFoundException('Quotation not found');
    if (current.invoice_id) {
      // Added services raise the invoice to the new total (payments already made stay as they are).
      await this.pool.query(
        `UPDATE invoices SET amount = q.final_amount - q.gst_amount, tax_amount = q.gst_amount, total_amount = q.final_amount, updated_at = now(),
                status = (CASE WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = invoices.id AND p.is_deleted = false AND p.status = 'completed'), 0) >= q.final_amount THEN 'paid'
                               WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = invoices.id AND p.is_deleted = false AND p.status = 'completed'), 0) > 0 THEN 'partial' ELSE 'pending' END)::payment_status
           FROM quotations q WHERE q.id = $1 AND invoices.id = $2`, [id, current.invoice_id]).catch((e) => this.logger.warn(`Could not sync invoice total: ${e.message}`));
    }
    return updated;
  }

  async updateStatus(id: string, status: string, userId: string | null) {
    const updated = await this.repo.updateStatus(id, status, userId);
    if (!updated) throw new NotFoundException('Quotation not found');
    if (status === 'sent') await advanceLeadStatus(this.pool, updated.lead_id, 'quotation_sent');
    else if (status === 'accepted') await advanceLeadStatus(this.pool, updated.lead_id, 'negotiation');
    return updated;
  }

  async remove(id: string) {
    const deleted = await this.repo.softDelete(id);
    if (!deleted) throw new NotFoundException('Quotation not found');
    return { success: true };
  }
}
