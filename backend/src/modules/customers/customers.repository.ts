import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

export interface CustomerListParams {
  branchId?: string;
  search?: string;
  page: number;
  pageSize: number;
}

@Injectable()
export class CustomersRepository {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async findAll(params: CustomerListParams) {
    const conditions: string[] = ['is_deleted = false'];
    const values: any[] = [];

    if (params.branchId) {
      values.push(params.branchId);
      conditions.push(`branch_id = $${values.length}`);
    }
    if (params.search) {
      values.push(`%${params.search}%`);
      conditions.push(`(full_name ILIKE $${values.length} OR phone ILIKE $${values.length} OR email ILIKE $${values.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (params.page - 1) * params.pageSize;

    values.push(params.pageSize);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const { rows } = await this.pool.query(
      `SELECT * FROM customers ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      values,
    );
    const countValues = values.slice(0, values.length - 2);
    const { rows: countRows } = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM customers ${where}`,
      countValues,
    );
    return { data: rows, total: countRows[0].total };
  }

  async findOne(id: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM customers WHERE id = $1 AND is_deleted = false`,
      [id],
    );
    return rows[0] || null;
  }

  async create(dto: CreateCustomerDto, createdBy: string | null) {
    const customerCode = `CUS-${Date.now().toString(36).toUpperCase()}`;
    const { rows } = await this.pool.query(
      `INSERT INTO customers
        (customer_code, full_name, phone, whatsapp_number, email, nationality, dob,
         anniversary_date, address, city, country, type, loyalty_points, referral_source,
         referred_by, lead_id, branch_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        customerCode,
        dto.fullName,
        dto.phone ?? null,
        dto.whatsappNumber ?? null,
        dto.email ?? null,
        dto.nationality ?? null,
        dto.dob ?? null,
        dto.anniversaryDate ?? null,
        dto.address ?? null,
        dto.city ?? null,
        dto.country ?? null,
        dto.type ?? 'individual',
        dto.loyaltyPoints ?? 0,
        dto.referralSource ?? null,
        dto.referredBy ?? null,
        dto.leadId ?? null,
        dto.branchId,
        createdBy,
      ],
    );
    return rows[0];
  }

  async update(id: string, dto: UpdateCustomerDto) {
    const fieldMap: Record<string, any> = {
      full_name: dto.fullName,
      phone: dto.phone,
      whatsapp_number: dto.whatsappNumber,
      email: dto.email,
      nationality: dto.nationality,
      dob: dto.dob,
      anniversary_date: dto.anniversaryDate,
      address: dto.address,
      city: dto.city,
      country: dto.country,
      type: dto.type,
      loyalty_points: dto.loyaltyPoints,
      referral_source: dto.referralSource,
      referred_by: dto.referredBy,
      lead_id: dto.leadId,
      branch_id: dto.branchId,
    };

    const setClauses: string[] = [];
    const values: any[] = [];
    for (const [col, val] of Object.entries(fieldMap)) {
      if (val !== undefined) {
        values.push(val);
        setClauses.push(`${col} = $${values.length}`);
      }
    }
    if (setClauses.length === 0) return this.findOne(id);

    values.push(id);
    const { rows } = await this.pool.query(
      `UPDATE customers SET ${setClauses.join(', ')} WHERE id = $${values.length} AND is_deleted = false RETURNING *`,
      values,
    );
    return rows[0] || null;
  }

  async softDelete(id: string) {
    const { rows } = await this.pool.query(
      `UPDATE customers SET is_deleted = true WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows[0] || null;
  }
}
