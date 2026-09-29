import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';

export interface VendorListParams {
  branchId?: string;
  search?: string;
  page: number;
  pageSize: number;
}

@Injectable()
export class VendorsRepository {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async findAll(params: VendorListParams) {
    const conditions: string[] = ['is_deleted = false'];
    const values: any[] = [];

    if (params.branchId) {
      values.push(params.branchId);
      conditions.push(`branch_id = $${values.length}`);
    }
    if (params.search) {
      values.push(`%${params.search}%`);
      conditions.push(`(name ILIKE $${values.length} OR phone ILIKE $${values.length} OR email ILIKE $${values.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (params.page - 1) * params.pageSize;

    values.push(params.pageSize);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const { rows } = await this.pool.query(
      `SELECT * FROM vendors ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      values,
    );
    const countValues = values.slice(0, values.length - 2);
    const { rows: countRows } = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM vendors ${where}`,
      countValues,
    );
    return { data: rows, total: countRows[0].total };
  }

  async findOne(id: string) {
    const { rows } = await this.pool.query(`SELECT * FROM vendors WHERE id = $1 AND is_deleted = false`, [id]);
    return rows[0] || null;
  }

  async create(dto: CreateVendorDto, createdBy: string | null) {
    const { rows } = await this.pool.query(
      `INSERT INTO vendors (name, type, phone, email, address, gst_number, branch_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [dto.name, dto.type ?? null, dto.phone ?? null, dto.email ?? null, dto.address ?? null, dto.gstNumber ?? null, dto.branchId, createdBy],
    );
    return rows[0];
  }

  async update(id: string, dto: UpdateVendorDto) {
    const fieldMap: Record<string, any> = {
      name: dto.name,
      type: dto.type,
      phone: dto.phone,
      email: dto.email,
      address: dto.address,
      gst_number: dto.gstNumber,
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
      `UPDATE vendors SET ${setClauses.join(', ')} WHERE id = $${values.length} AND is_deleted = false RETURNING *`,
      values,
    );
    return rows[0] || null;
  }

  async softDelete(id: string) {
    const { rows } = await this.pool.query(`UPDATE vendors SET is_deleted = true WHERE id = $1 RETURNING id`, [id]);
    return rows[0] || null;
  }
}
