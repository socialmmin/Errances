import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { QuotationsRepository } from './quotations.repository';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';

@Injectable()
export class QuotationsService {
  private logger = new Logger('QuotationsService');

  constructor(
    private repo: QuotationsRepository,
    @Inject(PG_POOL) private pool: Pool,
    private config: ConfigService,
  ) {}

  findAll(params: { branchId?: string; status?: string; search?: string; page?: number; pageSize?: number }) {
    return this.repo.findAll({
      branchId: params.branchId,
      status: params.status,
      search: params.search,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
    });
  }

  stats(branchId?: string) {
    return this.repo.stats(branchId);
  }

  async findOne(id: string) {
    const quotation = await this.repo.findOne(id);
    if (!quotation) throw new NotFoundException('Quotation not found');
    return quotation;
  }

  async findByShareToken(token: string) {
    const quotation = await this.repo.findByShareToken(token);
    if (!quotation) throw new NotFoundException('Quotation not found');
    return quotation;
  }

  // Sends the customer-facing share link via WhatsApp, using the number on
  // the quotation's customer/lead record and the CRM's stored WhatsApp send
  // credentials (Settings > WhatsApp). This is deliberately a link-share,
  // not a PDF attachment -- no PDF-rendering pipeline exists yet.
  async sendViaWhatsApp(id: string, userId: string | null) {
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
    const body =
      `Hi ${customerName}! 👋 Here's your quotation *${quotation.quotation_number}*` +
      `${quotation.destination ? ` for ${quotation.destination}` : ''} — total *${amount}*.\n\n` +
      `View full details: ${link}\n\n` +
      `Let us know if you have any questions!`;

    await this.callWhatsAppApi(config, { to: toNumber.replace(/[^\d]/g, ''), type: 'text', text: { body } });

    if (quotation.status === 'draft') {
      await this.repo.updateStatus(id, 'sent', userId);
    }
    this.logger.log(`Quotation ${quotation.quotation_number} sent via WhatsApp to ${toNumber}`);
    return { success: true, sentTo: toNumber, link };
  }

  private async getWhatsAppConfig(): Promise<{ phone_number_id: string; access_token: string } | null> {
    const { rows } = await this.pool.query(
      `SELECT phone_number_id, access_token_encrypted FROM whatsapp_config WHERE is_configured = true ORDER BY created_at DESC LIMIT 1`,
    );
    const row = rows[0];
    if (!row?.phone_number_id || !row?.access_token_encrypted) return null;
    return { phone_number_id: row.phone_number_id, access_token: row.access_token_encrypted };
  }

  private async callWhatsAppApi(config: { phone_number_id: string; access_token: string }, payload: Record<string, unknown>) {
    const version = this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
    const res = await fetch(`https://graph.facebook.com/${version}/${config.phone_number_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`WhatsApp send failed: ${res.status} ${text}`);
      throw new BadRequestException('Failed to send WhatsApp message -- check WhatsApp configuration');
    }
  }

  create(dto: CreateQuotationDto, userId: string | null) {
    return this.repo.create(dto, userId);
  }

  async update(id: string, dto: UpdateQuotationDto) {
    const updated = await this.repo.update(id, dto);
    if (!updated) throw new NotFoundException('Quotation not found');
    return updated;
  }

  async updateStatus(id: string, status: string, userId: string | null) {
    const updated = await this.repo.updateStatus(id, status, userId);
    if (!updated) throw new NotFoundException('Quotation not found');
    return updated;
  }

  async remove(id: string) {
    const deleted = await this.repo.softDelete(id);
    if (!deleted) throw new NotFoundException('Quotation not found');
    return { success: true };
  }
}
