import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { leadVisibleSql } from '../../common/leads/lead-visibility';
import { PG_POOL } from '../../common/db/pool.module';
import { CreateQuotationDto, QuotationItemDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';

export interface QuotationListParams {
  branchId?: string;
  // Non-super-admins: only quotations they created or that belong to a lead they can see.
  visibleTo?: string;
  status?: string;
  search?: string;
  // created-on range (yyyy-mm-dd, India time), a line-item category, an exact destination
  from?: string;
  to?: string;
  category?: string;
  destination?: string;
  page: number;
  pageSize: number;
}

interface Pricing {
  baseAmount: number;
  discountAmount: number;
  gstAmount: number;
  finalAmount: number;
  costAmount: number;
  profitMargin: number;
  items: {
    category: string;
    description: string | null;
    quantity: number;
    unitCost: number;
    markupPct: number;
    sellingPrice: number;
    amount: number;
  }[];
}

// Server-side pricing computation — the client sends raw cost/markup/qty
// per line item plus discount%/gst%, and the server is the source of truth
// for every derived money figure (never trusts client-sent totals).
function computePricing(items: QuotationItemDto[], discountPct: number, gstPct: number): Pricing {
  const computedItems = items.map((item) => {
    const quantity = item.quantity ?? 1;
    const unitCost = Math.round(item.unitCost);
    const markupPct = item.markupPct ?? 0;
    const sellingPrice = Math.round(unitCost * (1 + markupPct / 100));
    const amount = sellingPrice * quantity;
    return {
      category: item.category,
      description: item.description ?? null,
      quantity,
      unitCost,
      markupPct,
      sellingPrice,
      amount,
    };
  });

  const baseAmount = computedItems.reduce((sum, i) => sum + i.amount, 0);
  const discountAmount = Math.round(baseAmount * (discountPct / 100));
  const taxable = baseAmount - discountAmount;
  const gstAmount = Math.round(taxable * (gstPct / 100));
  const finalAmount = taxable + gstAmount;
  const costAmount = computedItems.reduce((sum, i) => sum + i.unitCost * i.quantity, 0);
  const profit = finalAmount - costAmount;
  const profitMargin = finalAmount > 0 ? Math.round((profit / finalAmount) * 10000) / 100 : 0;

  return { baseAmount, discountAmount, gstAmount, finalAmount, costAmount, profitMargin, items: computedItems };
}

export function quotationVisibleSql(alias: string, userParam: string) {
  return `(${alias}.created_by = ${userParam} OR ${leadVisibleSql(`${alias}.lead_id`, userParam)})`;
}

@Injectable()
export class QuotationsRepository {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async findAll(params: QuotationListParams) {
    const conditions: string[] = ['q.is_deleted = false'];
    const values: any[] = [];

    if (params.branchId) {
      values.push(params.branchId);
      conditions.push(`q.branch_id = $${values.length}`);
    }    if (params.visibleTo) {
      values.push(params.visibleTo);
      conditions.push(quotationVisibleSql('q', `$${values.length}`));
    }
    if (params.status) {
      values.push(params.status);
      conditions.push(`q.status = $${values.length}`);
    }
    if (params.search) {
      values.push(`%${params.search}%`);
      conditions.push(`(q.quotation_number ILIKE $${values.length} OR q.destination ILIKE $${values.length} OR l.customer_name ILIKE $${values.length} OR l.phone ILIKE $${values.length} OR c.full_name ILIKE $${values.length})`);
    }
    if (params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from)) {
      values.push(params.from);
      conditions.push(`(q.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $${values.length}::date`);
    }
    if (params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to)) {
      values.push(params.to);
      conditions.push(`(q.created_at AT TIME ZONE 'Asia/Kolkata')::date <= $${values.length}::date`);
    }
    if (params.destination) {
      values.push(params.destination.trim());
      conditions.push(`lower(trim(q.destination)) = lower($${values.length})`);
    }
    if (params.category) {
      values.push(params.category);
      conditions.push(`EXISTS (SELECT 1 FROM quotation_items qi WHERE qi.quotation_id = q.id AND qi.is_deleted = false AND qi.category = $${values.length})`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const offset = (params.page - 1) * params.pageSize;

    values.push(params.pageSize);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const { rows } = await this.pool.query(
      `SELECT q.*,
              GREATEST(1, (SELECT count(*)::int FROM quotations x WHERE x.lead_id = q.lead_id AND x.requirement_no = q.requirement_no AND x.created_at <= q.created_at)) AS option_no,
              (SELECT count(*)::int FROM quotations x WHERE x.lead_id = q.lead_id AND x.requirement_no = q.requirement_no AND x.is_deleted = false) AS option_count,
              (SELECT i.id FROM invoices i WHERE i.quotation_id = q.id AND i.is_deleted = false ORDER BY i.created_at LIMIT 1) AS invoice_id,
              (SELECT i.invoice_number FROM invoices i WHERE i.quotation_id = q.id AND i.is_deleted = false ORDER BY i.created_at LIMIT 1) AS invoice_number,
              COALESCE((SELECT SUM(p.amount) FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.quotation_id = q.id AND i.is_deleted = false AND p.is_deleted = false AND p.status = 'completed'), 0)::float AS paid_amount,
              c.full_name AS customer_name, c.phone AS customer_phone,
              l.customer_name AS lead_customer_name, l.phone AS lead_phone, l.email AS lead_email
         FROM quotations q
         LEFT JOIN customers c ON c.id = q.customer_id
         LEFT JOIN leads l ON l.id = q.lead_id
         ${where}
         ORDER BY q.created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      values,
    );
    const countValues = values.slice(0, values.length - 2);
    const { rows: countRows } = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM quotations q LEFT JOIN customers c ON c.id = q.customer_id LEFT JOIN leads l ON l.id = q.lead_id ${where}`,
      countValues,
    );
    return { data: rows, total: countRows[0].total };
  }  // The requirements this customer already has quotations for, so a new quotation can be filed
  // under one of them or started as the next requirement.
  async requirementsForLead(leadId: string) {
    const { rows } = await this.pool.query(
      `SELECT q.requirement_no, count(*)::int AS quotations,
              (array_agg(q.destination ORDER BY q.created_at DESC))[1] AS destination,
              bool_or(q.status IN ('accepted','converted') OR EXISTS (SELECT 1 FROM invoices i WHERE i.quotation_id = q.id AND i.is_deleted = false)) AS approved,
              bool_or(EXISTS (SELECT 1 FROM invoices i WHERE i.quotation_id = q.id AND i.is_deleted = false AND (i.status = 'paid' OR i.cancelled_at IS NOT NULL))) AS closed,
              -- numbers are never reused, even after a quotation is deleted
              (SELECT count(*)::int FROM quotations a WHERE a.lead_id = $1 AND a.requirement_no = q.requirement_no) AS used
         FROM quotations q WHERE q.lead_id = $1 AND q.is_deleted = false GROUP BY q.requirement_no ORDER BY q.requirement_no`,
      [leadId],
    );
    const open = rows.filter((r) => !r.closed);
    return { data: rows, next: rows.length ? Math.max(...rows.map((r) => Number(r.requirement_no))) + 1 : 1, openRequirement: open.length ? Number(open[open.length - 1].requirement_no) : null };
  }

  async stats(branchId?: string, visibleTo?: string) {
    const conditions: string[] = ['q.is_deleted = false'];
    const values: any[] = [];
    if (branchId) {
      values.push(branchId);
      conditions.push(`q.branch_id = $${values.length}`);
    }
    if (visibleTo) {
      values.push(visibleTo);
      conditions.push(quotationVisibleSql('q', `$${values.length}`));
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS total_count,
              COALESCE(SUM(q.final_amount), 0)::bigint AS total_value,
              COUNT(*) FILTER (WHERE q.status = 'draft')::int AS draft_count,
              -- sent to the customer and not approved yet: the sidebar badge
              COUNT(*) FILTER (WHERE q.status = 'sent' AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.quotation_id = q.id AND i.is_deleted = false))::int AS awaiting_count,
              -- approved by the customer and not fully paid yet: the sidebar badge
              COUNT(*) FILTER (WHERE (q.status IN ('accepted','converted') OR EXISTS (SELECT 1 FROM invoices i WHERE i.quotation_id = q.id AND i.is_deleted = false))
                                 AND COALESCE((SELECT SUM(p.amount) FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.quotation_id = q.id AND i.is_deleted = false AND p.is_deleted = false AND p.status = 'completed'), 0) < q.final_amount)::int AS approved_unpaid_count
         FROM quotations q ${where}`,
      values,
    );
    return rows[0];
  }

  async findOne(id: string) {
    const { rows } = await this.pool.query(
      `SELECT q.*,
              (SELECT i.id FROM invoices i WHERE i.quotation_id = q.id AND i.is_deleted = false ORDER BY i.created_at LIMIT 1) AS invoice_id,
              (SELECT i.invoice_number FROM invoices i WHERE i.quotation_id = q.id AND i.is_deleted = false ORDER BY i.created_at LIMIT 1) AS invoice_number,
              COALESCE((SELECT SUM(p.amount) FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.quotation_id = q.id AND i.is_deleted = false AND p.is_deleted = false AND p.status = 'completed'), 0)::float AS paid_amount,
              c.full_name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
              l.customer_name AS lead_customer_name, l.phone AS lead_phone, l.email AS lead_email
         FROM quotations q
         LEFT JOIN customers c ON c.id = q.customer_id
         LEFT JOIN leads l ON l.id = q.lead_id
        WHERE q.id = $1 AND q.is_deleted = false`,
      [id],
    );
    const quotation = rows[0];
    if (!quotation) return null;

    const itemsRes = await this.pool.query(
      `SELECT * FROM quotation_items WHERE quotation_id = $1 AND is_deleted = false ORDER BY created_at`,
      [id],
    );
    return { ...quotation, items: itemsRes.rows };
  }

  async findByShareToken(token: string) {
    const { rows } = await this.pool.query(
      `SELECT q.id, q.quotation_number, q.destination, q.travel_from, q.travel_to, q.adults, q.children, q.infants,
              q.base_amount::float, q.discount_amount::float, q.gst_amount::float, q.final_amount::float, q.status, q.valid_until, q.notes,
              q.created_at, q.signature_data,
              c.full_name AS customer_name, l.customer_name AS lead_customer_name, COALESCE(c.phone, l.phone) AS customer_phone,
              i.invoice_number AS invoice_number, i.total_amount::float AS invoice_total, i.created_at AS invoice_date, i.cancelled_at AS invoice_cancelled_at,
              COALESCE((SELECT SUM(rf.amount) FROM refunds rf WHERE rf.invoice_id = i.id AND rf.is_deleted = false), 0)::float AS refunded_amount,
              COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.is_deleted = false AND p.status = 'completed'), 0)::float AS paid_amount
         FROM quotations q
         LEFT JOIN customers c ON c.id = q.customer_id
         LEFT JOIN leads l ON l.id = q.lead_id
         LEFT JOIN invoices i ON i.quotation_id = q.id AND i.is_deleted = false
        WHERE q.public_share_token = $1 AND q.is_deleted = false`,
      [token],
    );
    const quotation = rows[0];
    if (!quotation) return null;

    const itemsRes = await this.pool.query(
      `SELECT category, description, quantity, unit_price::float, total_price::float FROM quotation_items WHERE quotation_id = $1 AND is_deleted = false ORDER BY created_at`,
      [quotation.id],
    );
    // Letterhead, footer and payment details on the customer's copy come from Settings > Company.
    const { rows: company } = await this.pool.query(
      `SELECT company_name, legal_name, logo_url, phone, email, website, address, gstin,
              bank_name, bank_account_name, bank_account_number, bank_ifsc, bank_branch, upi_id
         FROM company_settings WHERE id = true`,
    ).catch(() => ({ rows: [] as any[] }));
    // Each payment received, with its date, for the invoice copy.
    const { rows: payments } = await this.pool.query(
      `SELECT p.paid_at, p.amount::float AS amount, p.method::text AS method, p.reference
         FROM payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE i.quotation_id = $1 AND i.is_deleted = false AND p.is_deleted = false AND p.status = 'completed' ORDER BY p.paid_at`,
      [quotation.id],
    ).catch(() => ({ rows: [] as any[] }));
    return { ...quotation, items: itemsRes.rows, payments, company: company[0] ?? null };
  }

  // Client-facing approval, reached only via the unguessable public_share_token (see
  // PublicQuotationsController) -- creates the invoice directly from the quotation, no
  // booking required. Idempotent: pressing Approve twice (double-tap, page refresh) never
  // creates a second invoice for the same quotation.
  async approveByToken(token: string, signature?: string | null) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT * FROM quotations WHERE public_share_token = $1 AND is_deleted = false FOR UPDATE`,
        [token],
      );
      const quotation = rows[0];
      if (!quotation) { await client.query('ROLLBACK'); return null; }

      const { rows: existingInvoice } = await client.query(
        `SELECT * FROM invoices WHERE quotation_id = $1 AND is_deleted = false LIMIT 1`,
        [quotation.id],
      );
      if (existingInvoice[0]) {
        await client.query('COMMIT');
        return { quotation, invoice: existingInvoice[0], alreadyApproved: true };
      }

      if (quotation.status === 'rejected' || quotation.status === 'expired') {
        await client.query('ROLLBACK');
        throw new Error(`This quotation is ${quotation.status} and can no longer be approved`);
      }

      const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;
      const taxableAmount = quotation.final_amount - quotation.gst_amount;
      const { rows: invRows } = await client.query(
        `INSERT INTO invoices (invoice_number, quotation_id, customer_id, amount, tax_amount, total_amount, type, branch_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'tax_invoice',$7,NULL) RETURNING *`,
        [invoiceNumber, quotation.id, quotation.customer_id, taxableAmount, quotation.gst_amount, quotation.final_amount, quotation.branch_id],
      );
      await client.query(
        `UPDATE quotations SET status = 'accepted', approved_by = NULL, signature_data = $2, updated_at = now() WHERE id = $1`,
        [quotation.id, signature || null],
      );
      await client.query('COMMIT');
      return { quotation: { ...quotation, status: 'accepted' }, invoice: invRows[0], alreadyApproved: false };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Phone-only dedupe -- the same number always means the same person, but their name can be
  // typed/spelled differently each time, so matching on name would both miss real duplicates
  // and risk merging two different people who happen to share a name.
  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
  }

  private async resolveOrCreateLead(
    client: PoolClient,
    dto: CreateQuotationDto,
    createdBy: string | null,
  ): Promise<string | null> {
    if (dto.leadId) return dto.leadId;
    const name = dto.newCustomerName?.trim();
    const phone = dto.newCustomerPhone?.trim();
    if (!name || !phone) return null;
    const normalized = this.normalizePhone(phone);
    if (!normalized) return null;

    const { rows: existing } = await client.query(
      `SELECT id FROM leads WHERE is_deleted = false AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = $1 LIMIT 1`,
      [normalized],
    );
    if (existing[0]) return existing[0].id;

    const leadNumber = `LD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const { rows: created } = await client.query(
      `INSERT INTO leads (lead_number, customer_name, phone, email, destination, travel_from, travel_to, adults, children, infants, source, status, branch_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::lead_source,'new',$12,$13) RETURNING id`,
      [leadNumber, name, phone, dto.newCustomerEmail?.trim() || null, dto.destination ?? null, dto.travelFrom ?? null, dto.travelTo ?? null, dto.adults ?? 1, dto.children ?? 0, dto.infants ?? 0, dto.newCustomerSource || 'other', dto.branchId, createdBy],
    );
    return created[0].id;
  }

  // An email typed on the quotation is kept on the lead when the lead has none yet.
  private async fillLeadEmail(client: PoolClient, leadId: string | null | undefined, email: string | undefined) {
    const value = email?.trim();
    if (!leadId || !value) return;
    await client.query(`UPDATE leads SET email = $2, updated_at = now() WHERE id = $1 AND COALESCE(email, '') = ''`, [leadId, value]);
  }

  async create(dto: CreateQuotationDto, createdBy: string | null) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const pricing = computePricing(dto.items ?? [], dto.discountPct ?? 0, dto.gstPct ?? 5);
      const quotationNumber = `QUO-${Date.now().toString(36).toUpperCase()}`;
      const leadId = await this.resolveOrCreateLead(client, dto, createdBy);
      await this.fillLeadEmail(client, leadId, dto.newCustomerEmail);

      // A requirement can have several quotations (options), so a new one never replaces an
      // earlier draft. Autosave keeps updating the one row it created (the builder remembers its id).

      const { rows } = await client.query(
        `INSERT INTO quotations
          (quotation_number, lead_id, customer_id, package_id, destination, travel_from, travel_to,
           adults, children, infants, total_amount, discount_amount, final_amount, base_amount, gst_amount,
           cost_amount, profit_margin, status, valid_until, notes, internal_notes, branch_id, created_by, requirement_no)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'draft',$18,$19,$20,$21,$22,$23)
         RETURNING *`,
        [
          quotationNumber,
          leadId,
          dto.customerId ?? null,
          dto.packageId ?? null,
          dto.destination ?? null,
          dto.travelFrom ?? null,
          dto.travelTo ?? null,
          dto.adults ?? 1,
          dto.children ?? 0,
          dto.infants ?? 0,
          pricing.baseAmount,
          pricing.discountAmount,
          pricing.finalAmount,
          pricing.baseAmount,
          pricing.gstAmount,
          pricing.costAmount,
          pricing.profitMargin,
          dto.validUntil ?? null,
          dto.notes ?? null,
          dto.internalNotes ?? null,
          dto.branchId,
          createdBy,
          dto.requirementNo ?? 1,
        ],
      );
      const quotation = rows[0];
      await this.saveItems(client, quotation.id, pricing.items);
      await client.query('COMMIT');
      return this.findOne(quotation.id);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async update(id: string, dto: UpdateQuotationDto) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const existingRes = await client.query(`SELECT * FROM quotations WHERE id = $1 AND is_deleted = false`, [id]);
      const existing = existingRes.rows[0];
      if (!existing) {
        await client.query('ROLLBACK');
        return null;
      }

      let existingItems: QuotationItemDto[] = [];
      if (dto.items === undefined) {
        const itemsRes = await client.query(
          `SELECT category, description, quantity, unit_cost AS "unitCost", markup_pct AS "markupPct"
             FROM quotation_items WHERE quotation_id = $1 AND is_deleted = false`,
          [id],
        );
        existingItems = itemsRes.rows;
      }
      const items = dto.items ?? existingItems;
      const discountPct = dto.discountPct ?? (existing.base_amount > 0 ? (existing.discount_amount / existing.base_amount) * 100 : 0);
      const gstPct =
        dto.gstPct ??
        (existing.base_amount - existing.discount_amount > 0
          ? (existing.gst_amount / (existing.base_amount - existing.discount_amount)) * 100
          : 5);
      const pricing = computePricing(items, discountPct, gstPct);

      const setClauses: string[] = [
        'total_amount = $1',
        'discount_amount = $2',
        'final_amount = $3',
        'base_amount = $4',
        'gst_amount = $5',
        'cost_amount = $6',
        'profit_margin = $7',
        'updated_at = now()',
      ];
      const values: any[] = [
        pricing.baseAmount,
        pricing.discountAmount,
        pricing.finalAmount,
        pricing.baseAmount,
        pricing.gstAmount,
        pricing.costAmount,
        pricing.profitMargin,
      ];

      if (!dto.leadId && (dto.leadId === null || !existing.lead_id) && dto.newCustomerName && dto.newCustomerPhone) {
        const leadId = await this.resolveOrCreateLead(client, { ...dto, branchId: existing.branch_id } as CreateQuotationDto, existing.created_by ?? null);
        if (leadId) dto = { ...dto, leadId };
      }
      await this.fillLeadEmail(client, dto.leadId ?? existing.lead_id, dto.newCustomerEmail);

      const fieldMap: Record<string, keyof UpdateQuotationDto> = {
        lead_id: 'leadId',
        customer_id: 'customerId',
        package_id: 'packageId',
        destination: 'destination',
        travel_from: 'travelFrom',
        travel_to: 'travelTo',
        adults: 'adults',
        children: 'children',
        infants: 'infants',
        valid_until: 'validUntil',
        notes: 'notes',
        internal_notes: 'internalNotes',
        requirement_no: 'requirementNo',
      };
      for (const [col, key] of Object.entries(fieldMap)) {
        const val = dto[key];
        if (val !== undefined) {
          values.push(val);
          setClauses.push(`${col} = $${values.length}`);
        }
      }

      values.push(id);
      await client.query(
        `UPDATE quotations SET ${setClauses.join(', ')} WHERE id = $${values.length} AND is_deleted = false`,
        values,
      );

      if (dto.items !== undefined) {
        await client.query(`UPDATE quotation_items SET is_deleted = true WHERE quotation_id = $1`, [id]);
        await this.saveItems(client, id, pricing.items);
      }

      await client.query('COMMIT');
      return this.findOne(id);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async updateStatus(id: string, status: string, approvedBy: string | null) {
    const approvedClause = status === 'accepted' ? ', approved_by = $3' : '';
    const values: any[] = [status, id];
    if (status === 'accepted') values.push(approvedBy);
    const { rows } = await this.pool.query(
      `UPDATE quotations SET status = $1, updated_at = now()${approvedClause}
        WHERE id = $2 AND is_deleted = false RETURNING id`,
      values,
    );
    if (!rows[0]) return null;
    return this.findOne(id);
  }

  private async saveItems(client: PoolClient, quotationId: string, items: Pricing['items']) {
    for (const item of items) {
      await client.query(
        `INSERT INTO quotation_items
          (quotation_id, item_type, category, description, quantity, unit_price, total_price, unit_cost, markup_pct, selling_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          quotationId,
          item.category,
          item.category,
          item.description,
          item.quantity,
          item.sellingPrice,
          item.amount,
          item.unitCost,
          item.markupPct,
          item.sellingPrice,
        ],
      );
    }
  }

  async softDelete(id: string) {
    const { rows } = await this.pool.query(
      `UPDATE quotations SET is_deleted = true WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows[0] || null;
  }
}
