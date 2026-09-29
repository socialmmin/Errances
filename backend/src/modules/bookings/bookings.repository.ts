import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';

export interface BookingListParams {
  branchId?: string;
  status?: string;
  search?: string;
  page: number;
  pageSize: number;
}

const DEFAULT_CHECKLIST = [
  'Passport & visa collected',
  'Advance payment confirmed',
  'Hotel vouchers issued',
  'Flight tickets issued',
  'Itinerary shared with customer',
  'Emergency contact shared',
];

@Injectable()
export class BookingsRepository {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async findAll(params: BookingListParams) {
    const conditions: string[] = ['b.is_deleted = false'];
    const values: any[] = [];

    if (params.branchId) {
      values.push(params.branchId);
      conditions.push(`b.branch_id = $${values.length}`);
    }
    if (params.status) {
      values.push(params.status);
      conditions.push(`b.status = $${values.length}`);
    }
    if (params.search) {
      values.push(`%${params.search}%`);
      conditions.push(`(b.booking_number ILIKE $${values.length} OR c.full_name ILIKE $${values.length})`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const offset = (params.page - 1) * params.pageSize;
    values.push(params.pageSize);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const { rows } = await this.pool.query(
      `SELECT b.*, c.full_name AS customer_name, c.phone AS customer_phone,
              u.full_name AS ops_executive_name,
              GREATEST(b.total_amount - b.paid_amount, 0) AS balance_amount
         FROM bookings b
         LEFT JOIN customers c ON c.id = b.customer_id
         LEFT JOIN users u ON u.id = b.ops_executive_id
         ${where}
         ORDER BY b.created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      values,
    );
    const countValues = values.slice(0, values.length - 2);
    const { rows: countRows } = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM bookings b LEFT JOIN customers c ON c.id = b.customer_id ${where}`,
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
      `SELECT COUNT(*)::int AS total_bookings,
              COALESCE(SUM(GREATEST(total_amount - paid_amount, 0)), 0)::bigint AS balance_due,
              COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_count
         FROM bookings ${where}`,
      values,
    );
    return rows[0];
  }

  async findOne(id: string) {
    const { rows } = await this.pool.query(
      `SELECT b.*, c.full_name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
              u.full_name AS ops_executive_name, ab.full_name AS approved_by_name,
              GREATEST(b.total_amount - b.paid_amount, 0) AS balance_amount
         FROM bookings b
         LEFT JOIN customers c ON c.id = b.customer_id
         LEFT JOIN users u ON u.id = b.ops_executive_id
         LEFT JOIN users ab ON ab.id = b.approved_by
        WHERE b.id = $1 AND b.is_deleted = false`,
      [id],
    );
    const booking = rows[0];
    if (!booking) return null;

    const [checklist, travelers, hotels, flights, transports, payments, installments, vendorPayments] =
      await Promise.all([
        this.pool.query(`SELECT * FROM booking_checklist WHERE booking_id = $1 ORDER BY created_at`, [id]),
        this.pool.query(
          `SELECT * FROM booking_travelers WHERE booking_id = $1 AND is_deleted = false ORDER BY is_lead_traveler DESC, created_at`,
          [id],
        ),
        this.pool.query(
          `SELECT hb.*, h.name AS hotel_name, v.name AS vendor_name
             FROM hotel_bookings hb
             LEFT JOIN hotels h ON h.id = hb.hotel_id
             LEFT JOIN vendors v ON v.id = hb.vendor_id
            WHERE hb.booking_id = $1 AND hb.is_deleted = false ORDER BY hb.check_in`,
          [id],
        ),
        this.pool.query(
          `SELECT * FROM flight_bookings WHERE booking_id = $1 AND is_deleted = false ORDER BY departure_at`,
          [id],
        ),
        this.pool.query(
          `SELECT tb.*, v.name AS vendor_name
             FROM transport_bookings tb
             LEFT JOIN vendors v ON v.id = tb.vendor_id
            WHERE tb.booking_id = $1 AND tb.is_deleted = false ORDER BY tb.from_date`,
          [id],
        ),
        this.pool.query(
          `SELECT p.*, u.full_name AS created_by_name FROM payments p LEFT JOIN users u ON u.id = p.created_by
            WHERE p.booking_id = $1 AND p.is_deleted = false ORDER BY p.paid_at DESC`,
          [id],
        ),
        this.pool.query(
          `SELECT * FROM payment_installments WHERE booking_id = $1 ORDER BY due_date`,
          [id],
        ),
        this.pool.query(
          `SELECT vp.*, v.name AS vendor_name FROM vendor_payments vp LEFT JOIN vendors v ON v.id = vp.vendor_id
            WHERE vp.booking_id = $1 AND vp.is_deleted = false ORDER BY vp.created_at DESC`,
          [id],
        ),
      ]);

    return {
      ...booking,
      checklist: checklist.rows,
      travelers: travelers.rows,
      hotels: hotels.rows,
      flights: flights.rows,
      transports: transports.rows,
      payments: payments.rows,
      installments: installments.rows,
      vendorPayments: vendorPayments.rows,
    };
  }

  async create(dto: CreateBookingDto, createdBy: string | null) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const bookingNumber = `BK-${Date.now().toString(36).toUpperCase()}`;

      let itinerarySnapshot: any = null;
      let totalAmount = dto.totalAmount ?? 0;
      let packageId = dto.packageId ?? null;
      let travelFrom = dto.travelFrom ?? null;
      let travelTo = dto.travelTo ?? null;
      let adults = dto.adults ?? 1;
      let children = dto.children ?? 0;

      if (dto.quotationId) {
        const qRes = await client.query(`SELECT * FROM quotations WHERE id = $1 AND is_deleted = false`, [dto.quotationId]);
        const quotation = qRes.rows[0];
        if (quotation) {
          totalAmount = dto.totalAmount ?? quotation.final_amount;
          packageId = packageId ?? quotation.package_id;
          travelFrom = travelFrom ?? quotation.travel_from;
          travelTo = travelTo ?? quotation.travel_to;
          adults = dto.adults ?? quotation.adults;
          children = dto.children ?? quotation.children;
          const itemsRes = await client.query(
            `SELECT * FROM quotation_items WHERE quotation_id = $1 AND is_deleted = false ORDER BY created_at`,
            [dto.quotationId],
          );
          // Captured once at conversion time — never re-fetched live afterwards.
          itinerarySnapshot = JSON.stringify({ quotation, items: itemsRes.rows });
        }
      }

      const { rows } = await client.query(
        `INSERT INTO bookings
          (booking_number, quotation_id, customer_id, package_id, itinerary_snapshot, travel_from, travel_to,
           adults, children, total_amount, paid_amount, status, approval_status, branch_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,'pending_approval','pending_approval',$11,$12)
         RETURNING *`,
        [
          bookingNumber,
          dto.quotationId ?? null,
          dto.customerId,
          packageId,
          itinerarySnapshot,
          travelFrom,
          travelTo,
          adults,
          children,
          totalAmount,
          dto.branchId,
          createdBy,
        ],
      );
      const booking = rows[0];

      for (const item of DEFAULT_CHECKLIST) {
        await client.query(`INSERT INTO booking_checklist (booking_id, item) VALUES ($1, $2)`, [booking.id, item]);
      }

      if (dto.quotationId) {
        await client.query(`UPDATE quotations SET status = 'converted' WHERE id = $1`, [dto.quotationId]);
      }

      await client.query('COMMIT');
      return this.findOne(booking.id);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async update(id: string, dto: UpdateBookingDto) {
    const fieldMap: Record<string, string> = {
      customerId: 'customer_id',
      packageId: 'package_id',
      travelFrom: 'travel_from',
      travelTo: 'travel_to',
      adults: 'adults',
      children: 'children',
      totalAmount: 'total_amount',
    };
    const setClauses: string[] = ['updated_at = now()'];
    const values: any[] = [];
    for (const [key, col] of Object.entries(fieldMap)) {
      const val = (dto as any)[key];
      if (val !== undefined) {
        values.push(val);
        setClauses.push(`${col} = $${values.length}`);
      }
    }
    values.push(id);
    const { rows } = await this.pool.query(
      `UPDATE bookings SET ${setClauses.join(', ')} WHERE id = $${values.length} AND is_deleted = false RETURNING id`,
      values,
    );
    if (!rows[0]) return null;
    return this.findOne(id);
  }

  async approve(id: string, approvedBy: string | null) {
    const { rows } = await this.pool.query(
      `UPDATE bookings SET approval_status = 'approved', approval_status_changed_at = now(),
              approved_by = $2, approved_at = now(), status = CASE WHEN status = 'pending_approval' THEN 'confirmed' ELSE status END,
              updated_at = now()
        WHERE id = $1 AND is_deleted = false RETURNING id`,
      [id, approvedBy],
    );
    if (!rows[0]) return null;
    return this.findOne(id);
  }

  async assignPta(id: string, userId: string) {
    const { rows } = await this.pool.query(
      `UPDATE bookings SET ops_executive_id = $2, updated_at = now()
        WHERE id = $1 AND is_deleted = false RETURNING id`,
      [id, userId],
    );
    if (!rows[0]) return null;
    return this.findOne(id);
  }

  async updateStatus(id: string, status: string) {
    const { rows } = await this.pool.query(
      `UPDATE bookings SET status = $2, updated_at = now() WHERE id = $1 AND is_deleted = false RETURNING id`,
      [id, status],
    );
    if (!rows[0]) return null;
    return this.findOne(id);
  }

  async toggleChecklistItem(bookingId: string, itemId: string, isDone: boolean, userId: string | null) {
    const { rows } = await this.pool.query(
      `UPDATE booking_checklist SET is_done = $3, done_by = CASE WHEN $3 THEN $4::uuid ELSE NULL END,
              done_at = CASE WHEN $3 THEN now() ELSE NULL END
        WHERE id = $2 AND booking_id = $1 RETURNING *`,
      [bookingId, itemId, isDone, userId],
    );
    return rows[0] || null;
  }

  async addChecklistItem(bookingId: string, item: string) {
    const { rows } = await this.pool.query(
      `INSERT INTO booking_checklist (booking_id, item) VALUES ($1, $2) RETURNING *`,
      [bookingId, item],
    );
    return rows[0];
  }

  async recordPayment(
    bookingId: string,
    amount: number,
    method: string | null,
    reference: string | null,
    branchId: string,
    createdBy: string | null,
    status: string = 'completed',
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO payments (booking_id, amount, method, reference, branch_id, created_by, status, collected_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$6)`,
        [bookingId, amount, method, reference, branchId, createdBy, status],
      );
      // paid_amount is always recomputed from the payments table itself —
      // never trust a client-sent running total. Only 'completed' payments
      // count (pending PTA field collections and rejected/failed ones must
      // not move the ledger until the Finance module verifies them).
      await client.query(
        `UPDATE bookings SET paid_amount = (SELECT COALESCE(SUM(amount),0) FROM payments WHERE booking_id = $1 AND is_deleted = false AND status = 'completed'),
                advance_confirmed_at = COALESCE(advance_confirmed_at, now()), updated_at = now()
          WHERE id = $1`,
        [bookingId],
      );
      await client.query('COMMIT');
      return this.findOne(bookingId);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async addVendorPayment(bookingId: string, vendorId: string, amount: number, notes: string | null, branchId: string, createdBy: string | null) {
    const { rows } = await this.pool.query(
      `INSERT INTO vendor_payments (vendor_id, booking_id, amount, notes, branch_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [vendorId, bookingId, amount, notes, branchId, createdBy],
    );
    return rows[0];
  }

  async softDelete(id: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE bookings SET is_deleted = true WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows[0]) {
        // Cascade the soft-delete to child records — otherwise a deleted
        // booking's payments keep counting toward Finance KPIs (today's/
        // month collection) forever.
        await client.query(`UPDATE payments SET is_deleted = true WHERE booking_id = $1`, [id]);
        await client.query(`DELETE FROM payment_installments WHERE booking_id = $1`, [id]);
        await client.query(`UPDATE vendor_payments SET is_deleted = true WHERE booking_id = $1`, [id]);
      }
      await client.query('COMMIT');
      return rows[0] || null;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
