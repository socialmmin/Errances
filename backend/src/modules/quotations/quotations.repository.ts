import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { CreateQuotationDto, QuotationItemDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';

export interface QuotationListParams {
  branchId?: string;
  status?: string;
  search?: string;
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

@Injectable()
export class QuotationsRepository {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async findAll(params: QuotationListParams) {
    const conditions: string[] = ['q.is_deleted = false'];
    const values: any[] = [];

    if (params.branchId) {
      values.push(params.branchId);
      conditions.push(`q.branch_id = $${values.length}`);
    }
    if (params.status) {
      values.push(params.status);
      conditions.push(`q.status = $${values.length}`);
    }
    if (params.search) {
      values.push(`%${params.search}%`);
      conditions.push(`(q.quotation_number ILIKE $${values.length} OR q.destination ILIKE $${values.length})`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const offset = (params.page - 1) * params.pageSize;

    values.push(params.pageSize);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const { rows } = await this.pool.query(
      `SELECT q.*,
              c.full_name AS customer_name, c.phone AS customer_phone,
              l.customer_name AS lead_customer_name, l.phone AS lead_phone
         FROM quotations q
         LEFT JOIN customers c ON c.id = q.customer_id
         LEFT JOIN leads l ON l.id = q.lead_id
         ${where}
         ORDER BY q.created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      values,
    );
    const countValues = values.slice(0, values.length - 2);
    const { rows: countRows } = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM quotations q ${where}`,
      countValues,
    );
    return { data: rows, total: countRows[0].total };
  }

  async stats(branchId?: string) {
    const conditions: string[] = ['is_deleted = false'];
    const values: any[] = [];
    if (branchId) {
      values.push(branchId);
      conditions.push(`branch_id = $${values.length}`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS total_count,
              COALESCE(SUM(final_amount), 0)::bigint AS total_value,
              COUNT(*) FILTER (WHERE status = 'draft')::int AS draft_count
         FROM quotations ${where}`,
      values,
    );
    return rows[0];
  }

  async findOne(id: string) {
    const { rows } = await this.pool.query(
      `SELECT q.*,
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
      `SELECT q.id, q.quotation_number, q.destination, q.travel_from, q.travel_to, q.adults, q.children,
              q.base_amount, q.discount_amount, q.gst_amount, q.final_amount, q.status, q.valid_until, q.notes,
              c.full_name AS customer_name, l.customer_name AS lead_customer_name
         FROM quotations q
         LEFT JOIN customers c ON c.id = q.customer_id
         LEFT JOIN leads l ON l.id = q.lead_id
        WHERE q.public_share_token = $1 AND q.is_deleted = false`,
      [token],
    );
    const quotation = rows[0];
    if (!quotation) return null;

    const itemsRes = await this.pool.query(
      `SELECT description, quantity, unit_price, total_price FROM quotation_items WHERE quotation_id = $1 AND is_deleted = false ORDER BY created_at`,
      [quotation.id],
    );
    return { ...quotation, items: itemsRes.rows };
  }

  async create(dto: CreateQuotationDto, createdBy: string | null) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const pricing = computePricing(dto.items ?? [], dto.discountPct ?? 0, dto.gstPct ?? 5);
      const quotationNumber = `QUO-${Date.now().toString(36).toUpperCase()}`;

      const { rows } = await client.query(
        `INSERT INTO quotations
          (quotation_number, lead_id, customer_id, package_id, destination, travel_from, travel_to,
           adults, children, total_amount, discount_amount, final_amount, base_amount, gst_amount,
           cost_amount, profit_margin, status, valid_until, notes, internal_notes, branch_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'draft',$17,$18,$19,$20,$21)
         RETURNING *`,
        [
          quotationNumber,
          dto.leadId ?? null,
          dto.customerId ?? null,
          dto.packageId ?? null,
          dto.destination ?? null,
          dto.travelFrom ?? null,
          dto.travelTo ?? null,
          dto.adults ?? 1,
          dto.children ?? 0,
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

      const fieldMap: Record<string, keyof UpdateQuotationDto> = {
        lead_id: 'leadId',
        customer_id: 'customerId',
        package_id: 'packageId',
        destination: 'destination',
        travel_from: 'travelFrom',
        travel_to: 'travelTo',
        adults: 'adults',
        children: 'children',
        valid_until: 'validUntil',
        notes: 'notes',
        internal_notes: 'internalNotes',
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
