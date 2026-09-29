import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';

@Injectable()
export class FinanceRepository {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  // ---------------- Invoices ----------------

  async findInvoices(params: { branchId?: string; status?: string; type?: string }) {
    const conds: string[] = ['i.is_deleted = false'];
    const args: any[] = [];
    if (params.branchId) { args.push(params.branchId); conds.push(`i.branch_id = $${args.length}`); }
    if (params.status) { args.push(params.status); conds.push(`i.status = $${args.length}::payment_status`); }
    if (params.type) { args.push(params.type); conds.push(`i.type = $${args.length}`); }
    const { rows } = await this.pool.query(
      `SELECT i.*, b.booking_number, c.full_name AS customer_name
         FROM invoices i
         LEFT JOIN bookings b ON b.id = i.booking_id
         LEFT JOIN customers c ON c.id = i.customer_id
        WHERE ${conds.join(' AND ')}
        ORDER BY i.created_at DESC`,
      args,
    );
    return { data: rows, total: rows.length };
  }

  async createInvoice(dto: { bookingId: string; type?: string; dueDate?: string }, branchId: string, userId: string | null) {
    const { rows: bRows } = await this.pool.query(
      `SELECT id, customer_id, total_amount, branch_id FROM bookings WHERE id = $1`,
      [dto.bookingId],
    );
    const booking = bRows[0];
    if (!booking) return null;
    const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;
    const { rows } = await this.pool.query(
      `INSERT INTO invoices (invoice_number, booking_id, customer_id, amount, tax_amount, total_amount, type, due_date, branch_id, created_by)
       VALUES ($1,$2,$3,$4,0,$4,$5,$6,$7,$8) RETURNING *`,
      [invoiceNumber, booking.id, booking.customer_id, booking.total_amount, dto.type ?? 'tax_invoice', dto.dueDate ?? null, booking.branch_id ?? branchId, userId],
    );
    return rows[0];
  }

  async updateInvoice(id: string, dto: { status?: string; dueDate?: string; type?: string }) {
    const sets: string[] = [];
    const args: any[] = [];
    if (dto.status !== undefined) { args.push(dto.status); sets.push(`status = $${args.length}::payment_status`); }
    if (dto.dueDate !== undefined) { args.push(dto.dueDate); sets.push(`due_date = $${args.length}`); }
    if (dto.type !== undefined) { args.push(dto.type); sets.push(`type = $${args.length}`); }
    if (!sets.length) return this.findInvoiceById(id);
    args.push(id);
    const { rows } = await this.pool.query(
      `UPDATE invoices SET ${sets.join(', ')}, updated_at = now() WHERE id = $${args.length} AND is_deleted = false RETURNING *`,
      args,
    );
    return rows[0] || null;
  }

  async findInvoiceById(id: string) {
    const { rows } = await this.pool.query(`SELECT * FROM invoices WHERE id = $1 AND is_deleted = false`, [id]);
    return rows[0] || null;
  }

  async softDeleteInvoice(id: string) {
    const { rows } = await this.pool.query(
      `UPDATE invoices SET is_deleted = true, updated_at = now() WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows[0] || null;
  }

  // ---------------- KPIs ----------------

  async kpis(branchId?: string) {
    const args: any[] = [];
    let branchCond = '';
    if (branchId) { args.push(branchId); branchCond = ` AND p.branch_id = $${args.length}`; }

    const { rows: todayRows } = await this.pool.query(
      `SELECT COALESCE(SUM(p.amount),0) AS total FROM payments p
        WHERE p.status = 'completed' AND p.is_deleted = false
          AND p.paid_at >= date_trunc('day', now())${branchCond}`,
      args,
    );
    const { rows: monthRows } = await this.pool.query(
      `SELECT COALESCE(SUM(p.amount),0) AS total FROM payments p
        WHERE p.status = 'completed' AND p.is_deleted = false
          AND p.paid_at >= date_trunc('month', now())${branchCond}`,
      args,
    );

    const outstandingArgs: any[] = [];
    let outstandingBranchCond = '';
    if (branchId) { outstandingArgs.push(branchId); outstandingBranchCond = ` AND b.branch_id = $${outstandingArgs.length}`; }
    const { rows: outstandingRows } = await this.pool.query(
      `SELECT COALESCE(SUM(GREATEST(b.total_amount - b.paid_amount, 0)),0) AS total
         FROM bookings b
        WHERE b.is_deleted = false AND (b.total_amount - b.paid_amount) > 0${outstandingBranchCond}`,
      outstandingArgs,
    );

    const overdueArgs: any[] = [];
    let overdueBranchCond = '';
    if (branchId) { overdueArgs.push(branchId); overdueBranchCond = ` AND b.branch_id = $${overdueArgs.length}`; }
    const { rows: overdueRows } = await this.pool.query(
      `SELECT COUNT(*) AS cnt FROM payment_installments pi
         JOIN bookings b ON b.id = pi.booking_id
        WHERE pi.status IN ('pending','overdue') AND pi.due_date < CURRENT_DATE${overdueBranchCond}`,
      overdueArgs,
    );

    return {
      todayCollection: Number(todayRows[0].total),
      monthCollection: Number(monthRows[0].total),
      outstanding: Number(outstandingRows[0].total),
      overdueCount: Number(overdueRows[0].cnt),
    };
  }

  // ---------------- Payments ----------------

  async findPayments(params: { branchId?: string; status?: string }) {
    const conds: string[] = ['p.is_deleted = false'];
    const args: any[] = [];
    if (params.branchId) { args.push(params.branchId); conds.push(`p.branch_id = $${args.length}`); }
    if (params.status) { args.push(params.status); conds.push(`p.status = $${args.length}::payment_txn_status`); }
    const { rows } = await this.pool.query(
      `SELECT p.*, b.booking_number, c.full_name AS customer_name, u.full_name AS collected_by_name
         FROM payments p
         LEFT JOIN bookings b ON b.id = p.booking_id
         LEFT JOIN customers c ON c.id = b.customer_id
         LEFT JOIN users u ON u.id = p.collected_by
        WHERE ${conds.join(' AND ')}
        ORDER BY p.paid_at DESC`,
      args,
    );
    return { data: rows, total: rows.length };
  }

  async findOverdueInstallments(branchId?: string) {
    const args: any[] = [];
    let branchCond = '';
    if (branchId) { args.push(branchId); branchCond = ` AND b.branch_id = $${args.length}`; }
    const { rows } = await this.pool.query(
      `SELECT pi.*, b.booking_number, c.full_name AS customer_name,
              GREATEST((CURRENT_DATE - pi.due_date), 0) AS days_overdue
         FROM payment_installments pi
         JOIN bookings b ON b.id = pi.booking_id
         LEFT JOIN customers c ON c.id = b.customer_id
        WHERE pi.status IN ('pending','overdue') AND pi.due_date < CURRENT_DATE${branchCond}
        ORDER BY pi.due_date ASC`,
      args,
    );
    return rows;
  }

  // PTA = a user whose role is 'operations_executive' (field ops staff who
  // collect payments on-site; see bookings.ops_executive_id / assign-pta
  // flow already built in the Bookings module). Payments they record land
  // with status='pending' until an accountant verifies them here.
  async findTodayPtaCollections(branchId?: string) {
    const args: any[] = [];
    let branchCond = '';
    if (branchId) { args.push(branchId); branchCond = ` AND p.branch_id = $${args.length}`; }
    const { rows } = await this.pool.query(
      `SELECT p.*, b.booking_number, c.full_name AS customer_name, u.full_name AS pta_name
         FROM payments p
         JOIN users u ON u.id = p.collected_by
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN bookings b ON b.id = p.booking_id
         LEFT JOIN customers c ON c.id = b.customer_id
        WHERE p.is_deleted = false AND r.name = 'operations_executive'
          AND p.paid_at >= date_trunc('day', now())${branchCond}
        ORDER BY p.paid_at DESC`,
      args,
    );
    return rows;
  }

  async findPaymentById(id: string) {
    const { rows } = await this.pool.query(`SELECT * FROM payments WHERE id = $1 AND is_deleted = false`, [id]);
    return rows[0] || null;
  }

  // Verifying a PTA collection flips it to 'completed' and immediately
  // recomputes the booking's paid_amount the same way Bookings'
  // recordPayment does -- never a separate/duplicated running total.
  async verifyPayment(id: string, verifierId: string | null) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE payments SET status = 'completed', verified_by = $2, verified_at = now()
          WHERE id = $1 AND is_deleted = false RETURNING *`,
        [id, verifierId],
      );
      const payment = rows[0];
      if (!payment) { await client.query('ROLLBACK'); return null; }
      if (payment.booking_id) {
        await client.query(
          `UPDATE bookings SET paid_amount = (SELECT COALESCE(SUM(amount),0) FROM payments WHERE booking_id = $1 AND is_deleted = false AND status = 'completed'),
                  advance_confirmed_at = COALESCE(advance_confirmed_at, now()), updated_at = now()
            WHERE id = $1`,
          [payment.booking_id],
        );
      }
      await client.query('COMMIT');
      return payment;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // Rejecting does NOT touch the booking ledger -- a failed payment never
  // counted toward paid_amount (status defaults to 'pending' until
  // verified), so there is nothing to recompute.
  async rejectPayment(id: string, verifierId: string | null, reason: string | null) {
    const { rows } = await this.pool.query(
      `UPDATE payments SET status = 'failed', verified_by = $2, verified_at = now(), rejection_reason = $3
        WHERE id = $1 AND is_deleted = false RETURNING *`,
      [id, verifierId, reason],
    );
    return rows[0] || null;
  }
}
