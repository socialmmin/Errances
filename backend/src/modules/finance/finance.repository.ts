import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { advanceLeadStatus } from '../../common/leads/advance-lead-status';
import { leadVisibleSql } from '../../common/leads/lead-visibility';

@Injectable()
export class FinanceRepository {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  // ---------------- Invoices ----------------

  // A salesperson sees an invoice only when its quotation (direct, or via the booking) is theirs:
  // they created it, or it belongs to a lead assigned/shared to them.
  private invoiceVisibleSql(userParam: string) {
    return `EXISTS (SELECT 1 FROM quotations qv LEFT JOIN bookings bv ON bv.id = i.booking_id
      WHERE qv.id = COALESCE(i.quotation_id, bv.quotation_id) AND (qv.created_by = ${userParam} OR ${leadVisibleSql('qv.lead_id', userParam)}))`;
  }

  // The Payment Reminders page: every invoice that still has a balance, with its one open
  // reminder (if any) and the last reminder that went out.
  async paymentReminderBoard(visibleTo?: string) {
    const args: any[] = [];
    let scope = '';
    if (visibleTo) { args.push(visibleTo); scope = `AND ${this.invoiceVisibleSql('$1')}`; }
    const { rows } = await this.pool.query(
      `SELECT i.id AS invoice_id, i.invoice_number, i.created_at AS invoice_date, i.total_amount::float AS total_amount, q.id AS quotation_id, q.quotation_number, q.lead_id, q.destination,
              COALESCE(c.full_name, l.customer_name) AS customer_name, COALESCE(c.phone, l.phone) AS customer_phone,
              COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.is_deleted = false AND p.status = 'completed'), 0)::float AS paid_amount,
              (SELECT max(p.paid_at) FROM payments p WHERE p.invoice_id = i.id AND p.is_deleted = false AND p.status = 'completed') AS last_paid_at,
              r.id AS reminder_id, r.send_at, ru.full_name AS reminder_by,
              lr.status AS last_status, lr.sent_at AS last_sent_at, lr.send_at AS last_send_at, lr.error AS last_error
         FROM invoices i
         LEFT JOIN quotations q ON q.id = i.quotation_id
         LEFT JOIN customers c ON c.id = i.customer_id
         LEFT JOIN leads l ON l.id = q.lead_id
         LEFT JOIN LATERAL (SELECT * FROM invoice_reminders x WHERE x.invoice_id = i.id AND x.status = 'scheduled' ORDER BY x.send_at LIMIT 1) r ON true
         LEFT JOIN users ru ON ru.id = r.created_by
         LEFT JOIN LATERAL (SELECT * FROM invoice_reminders x WHERE x.invoice_id = i.id AND x.status IN ('sent','failed','skipped') ORDER BY COALESCE(x.sent_at, x.send_at) DESC LIMIT 1) lr ON true
        WHERE i.is_deleted = false AND i.cancelled_at IS NULL ${scope}
          AND i.total_amount > COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.is_deleted = false AND p.status = 'completed'), 0)
        ORDER BY r.send_at NULLS LAST, i.created_at DESC LIMIT 1000`,
      args,
    );
    return { data: rows };
  }

  async quotationVisible(id: string, userId: string) {
    const { rows } = await this.pool.query(`SELECT 1 FROM quotations qv WHERE qv.id = $1 AND qv.is_deleted = false AND (qv.created_by = $2 OR ${leadVisibleSql('qv.lead_id', '$2')})`, [id, userId]);
    return rows.length > 0;
  }

  async invoiceVisible(id: string, userId: string) {
    const { rows } = await this.pool.query(`SELECT 1 FROM invoices i WHERE i.id = $1 AND ${this.invoiceVisibleSql('$2')}`, [id, userId]);
    return rows.length > 0;
  }

  async findInvoices(params: { branchId?: string; status?: string; type?: string; visibleTo?: string }) {
    const conds: string[] = ['i.is_deleted = false'];
    const args: any[] = [];
    if (params.visibleTo) { args.push(params.visibleTo); conds.push(this.invoiceVisibleSql(`${args.length}`)); }
    if (params.branchId) { args.push(params.branchId); conds.push(`i.branch_id = $${args.length}`); }
    if (params.status) { args.push(params.status); conds.push(`i.status = $${args.length}::payment_status`); }
    if (params.type) { args.push(params.type); conds.push(`i.type = $${args.length}`); }
    const { rows } = await this.pool.query(
      `SELECT i.*, b.booking_number, q.quotation_number, q.destination,
              (q.base_amount - q.discount_amount - q.cost_amount)::float AS margin_amount,
              (SELECT array_agg(DISTINCT qi.category) FROM quotation_items qi WHERE qi.quotation_id = q.id AND qi.is_deleted = false) AS categories,
              COALESCE(c.full_name, l.customer_name) AS customer_name,
              COALESCE(c.phone, l.phone) AS customer_phone, q.public_share_token,
              COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.is_deleted = false AND p.status = 'completed'), 0) AS paid_amount,
              COALESCE((SELECT SUM(rf.amount) FROM refunds rf WHERE rf.invoice_id = i.id AND rf.is_deleted = false), 0)::float AS refunded_amount,
              (SELECT min(r.send_at) FROM invoice_reminders r WHERE r.invoice_id = i.id AND r.status = 'scheduled') AS next_reminder_at,
              CASE WHEN i.cancelled_at IS NOT NULL THEN 0 ELSE GREATEST(i.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.is_deleted = false AND p.status = 'completed'), 0), 0) END AS balance_due
         FROM invoices i
         LEFT JOIN bookings b ON b.id = i.booking_id
         LEFT JOIN quotations q ON q.id = i.quotation_id
         LEFT JOIN customers c ON c.id = i.customer_id
         LEFT JOIN leads l ON l.id = q.lead_id
        WHERE ${conds.join(' AND ')}
        ORDER BY i.created_at DESC`,
      args,
    );
    return { data: rows, total: rows.length };
  }

  async createInvoice(dto: { bookingId: string; type?: string; dueDate?: string }, branchId: string, userId: string | null) {
    const { rows: bRows } = await this.pool.query(
      `SELECT b.id, b.customer_id, b.total_amount, b.branch_id, q.lead_id
         FROM bookings b LEFT JOIN quotations q ON q.id = b.quotation_id
        WHERE b.id = $1`,
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
    await advanceLeadStatus(this.pool, booking.lead_id, 'booking_confirmed');
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
    const { rows } = await this.pool.query(
      `SELECT i.*, b.booking_number, q.quotation_number,
              (SELECT min(r.send_at) FROM invoice_reminders r WHERE r.invoice_id = i.id AND r.status = 'scheduled') AS next_reminder_at,
              COALESCE(c.full_name, l.customer_name) AS customer_name,
              COALESCE(c.phone, l.phone) AS customer_phone, q.public_share_token
         FROM invoices i
         LEFT JOIN bookings b ON b.id = i.booking_id
         LEFT JOIN quotations q ON q.id = i.quotation_id
         LEFT JOIN customers c ON c.id = i.customer_id
         LEFT JOIN leads l ON l.id = q.lead_id
        WHERE i.id = $1 AND i.is_deleted = false`,
      [id],
    );
    const invoice = rows[0];
    if (!invoice) return null;
    const { rows: payments } = await this.pool.query(
      `SELECT p.*, u.full_name AS collected_by_name FROM payments p LEFT JOIN users u ON u.id = p.collected_by
        WHERE p.invoice_id = $1 AND p.is_deleted = false ORDER BY p.paid_at DESC`,
      [id],
    );
    const paidAmount = payments.filter((p: any) => p.status === 'completed').reduce((sum: number, p: any) => sum + Number(p.amount), 0);
    const { rows: refunds } = await this.pool.query(
      `SELECT rf.id, rf.amount::float AS amount, rf.reason, rf.method, rf.reference, rf.refunded_at, u.full_name AS refunded_by_name
         FROM refunds rf LEFT JOIN users u ON u.id = rf.created_by WHERE rf.invoice_id = $1 AND rf.is_deleted = false ORDER BY rf.refunded_at DESC`, [id]).catch(() => ({ rows: [] as any[] }));
    const refunded = refunds.reduce((sum: number, r: any) => sum + Number(r.amount), 0);
    // A cancelled invoice has nothing left to collect. What was paid and not refunded stays with us.
    return { ...invoice, payments, refunds, paid_amount: paidAmount, refunded_amount: refunded, retained_amount: Math.max(paidAmount - refunded, 0),
      balance_due: invoice.cancelled_at ? 0 : Math.max(Number(invoice.total_amount) - paidAmount, 0) };
  }

  // Manual payment recording -- no payment gateway integration, staff type in what the
  // customer actually paid and how. Always lands as 'completed' immediately (unlike a PTA
  // field-collection, there's no separate verification step for something staff typed in
  // themselves at the desk). Invoice status is recomputed from the real running balance,
  // never set directly, so it can never drift from what the payments actually add up to.
  async recordInvoicePayment(invoiceId: string, dto: { amount: number; method: string; reference?: string }, branchId: string, userId: string | null) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: invRows } = await client.query(`SELECT * FROM invoices WHERE id = $1 AND is_deleted = false FOR UPDATE`, [invoiceId]);
      const invoice = invRows[0];
      if (!invoice) { await client.query('ROLLBACK'); return null; }
      await client.query(
        `INSERT INTO payments (invoice_id, amount, method, reference, branch_id, created_by, collected_by, status, verified_by, verified_at)
         VALUES ($1,$2,$3,$4,$5,$6,$6,'completed',$6,now())`,
        [invoiceId, dto.amount, dto.method, dto.reference || null, invoice.branch_id || branchId, userId],
      );
      const { rows: sumRows } = await client.query(
        `SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE invoice_id = $1 AND is_deleted = false AND status = 'completed'`,
        [invoiceId],
      );
      const paid = Number(sumRows[0].paid);
      const newStatus = paid <= 0 ? 'pending' : paid >= Number(invoice.total_amount) ? 'paid' : 'partial';
      await client.query(`UPDATE invoices SET status = $2::payment_status, updated_at = now() WHERE id = $1`, [invoiceId, newStatus]);
      await client.query('COMMIT');
      return this.findInvoiceById(invoiceId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // The invoice for a quotation, created on demand (first payment recorded before the customer
  // pressed Approve). Same shape as the public-approval path: one invoice per quotation.
  async ensureInvoiceForQuotation(quotationId: string, userId: string | null): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`SELECT * FROM quotations WHERE id = $1 AND is_deleted = false FOR UPDATE`, [quotationId]);
      const q = rows[0];
      if (!q) { await client.query('ROLLBACK'); return null; }
      const { rows: existing } = await client.query(`SELECT id FROM invoices WHERE quotation_id = $1 AND is_deleted = false ORDER BY created_at LIMIT 1`, [quotationId]);
      if (existing[0]) { await client.query('COMMIT'); return existing[0].id; }
      const { rows: inv } = await client.query(
        `INSERT INTO invoices (invoice_number, quotation_id, customer_id, amount, tax_amount, total_amount, type, branch_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'tax_invoice',$7,$8) RETURNING id`,
        [`INV-${Date.now().toString(36).toUpperCase()}`, q.id, q.customer_id, Number(q.final_amount) - Number(q.gst_amount), q.gst_amount, q.final_amount, q.branch_id, userId]);
      await client.query(`UPDATE quotations SET status = 'accepted', approved_by = COALESCE(approved_by, $2), updated_at = now() WHERE id = $1 AND status IN ('draft','sent')`, [q.id, userId]);
      await client.query('COMMIT');
      return inv[0].id;
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
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
      `SELECT p.*, b.booking_number, i.invoice_number, q.destination,
              COALESCE(c.full_name, ic.full_name, l.customer_name) AS customer_name, u.full_name AS collected_by_name
         FROM payments p
         LEFT JOIN bookings b ON b.id = p.booking_id
         LEFT JOIN customers c ON c.id = b.customer_id
         LEFT JOIN invoices i ON i.id = p.invoice_id
         LEFT JOIN customers ic ON ic.id = i.customer_id
         LEFT JOIN quotations q ON q.id = i.quotation_id
         LEFT JOIN leads l ON l.id = q.lead_id
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
