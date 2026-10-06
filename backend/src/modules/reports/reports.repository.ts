import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';

@Injectable()
export class ReportsRepository {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private branchFilter(branchId: string | undefined, col: string, args: any[]) {
    if (!branchId) return '';
    args.push(branchId);
    return ` AND ${col} = $${args.length}`;
  }

  async revenue(branchId: string | undefined, from: string | undefined, to: string | undefined) {
    const args: any[] = [];
    let cond = "p.status = 'completed' AND p.is_deleted = false";
    cond += this.branchFilter(branchId, 'p.branch_id', args);
    if (from) { args.push(from); cond += ` AND p.paid_at >= $${args.length}::date`; }
    if (to) { args.push(to); cond += ` AND p.paid_at <= ($${args.length}::date + interval '1 day')`; }
    const { rows } = await this.pool.query(
      `SELECT to_char(date_trunc('month', p.paid_at), 'Mon YY') AS month,
              date_trunc('month', p.paid_at) AS month_sort,
              COALESCE(SUM(p.amount), 0) AS amount
         FROM payments p
        WHERE ${cond}
        GROUP BY 1, 2
        ORDER BY 2`,
      args,
    );
    return rows.map((r) => ({ month: r.month, amount: Number(r.amount) }));
  }

  async conversionBySource(branchId?: string) {
    const args: any[] = [];
    const cond = `l.is_deleted = false${this.branchFilter(branchId, 'l.branch_id', args)}`;
    const { rows } = await this.pool.query(
      `SELECT COALESCE(l.source::text, 'unknown') AS source,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE l.status = 'won') AS booked
         FROM leads l
        WHERE ${cond}
        GROUP BY 1
        ORDER BY total DESC`,
      args,
    );
    return rows.map((r) => ({
      source: String(r.source).replace(/_/g, ' '),
      rawSource: r.source,
      total: Number(r.total),
      booked: Number(r.booked),
      rate: Number(r.total) > 0 ? Math.round((Number(r.booked) / Number(r.total)) * 100) : 0,
    }));
  }

  async lostReasons(branchId?: string) {
    const args: any[] = [];
    // Not Interested and Lost both count. A typed reason is stored as "Category — details"; group by the category.
    const cond = `l.is_deleted = false AND l.status IN ('lost', 'not_interested')${this.branchFilter(branchId, 'l.branch_id', args)}`;
    const { rows } = await this.pool.query(
      `SELECT COALESCE(NULLIF(trim(split_part(l.lost_reason, ' — ', 1)), ''), 'Not specified') AS name, COUNT(*) AS value
         FROM leads l WHERE ${cond} GROUP BY 1 ORDER BY value DESC`,
      args,
    );
    return rows.map((r) => ({ name: r.name, value: Number(r.value) }));
  }

  async destinations(branchId?: string) {
    const args: any[] = [];
    const cond = `l.is_deleted = false${this.branchFilter(branchId, 'l.branch_id', args)}`;
    const { rows } = await this.pool.query(
      `SELECT COALESCE(NULLIF(l.destination, ''), 'Not specified') AS destination,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE l.assigned_to IS NOT NULL) AS assigned,
              COUNT(*) FILTER (WHERE l.status = 'won') AS booked
         FROM leads l
        WHERE ${cond}
        GROUP BY 1
        ORDER BY total DESC`,
      args,
    );
    return rows.map((r) => ({
      destination: r.destination,
      total: Number(r.total),
      assigned: Number(r.assigned),
      unassigned: Number(r.total) - Number(r.assigned),
      booked: Number(r.booked),
      rate: Number(r.total) > 0 ? Math.round((Number(r.booked) / Number(r.total)) * 100) : 0,
    }));
  }

  async outstanding(branchId?: string) {
    const args: any[] = [];
    const cond = `b.is_deleted = false AND (b.total_amount - b.paid_amount) > 0${this.branchFilter(branchId, 'b.branch_id', args)}`;
    const { rows } = await this.pool.query(
      `SELECT b.id, b.booking_number, (b.total_amount - b.paid_amount) AS balance_amount, c.full_name AS customer_name
         FROM bookings b LEFT JOIN customers c ON c.id = b.customer_id
        WHERE ${cond}
        ORDER BY balance_amount DESC`,
      args,
    );
    return rows.map((r) => ({ ...r, balance_amount: Number(r.balance_amount) }));
  }

  async salesPerformance(branchId?: string) {
    const args: any[] = [];
    const cond = `l.is_deleted = false AND l.assigned_to IS NOT NULL${this.branchFilter(branchId, 'l.branch_id', args)}`;
    const { rows } = await this.pool.query(
      `SELECT u.id, u.full_name AS name,
              COUNT(*) AS assigned,
              COUNT(*) FILTER (WHERE l.status = 'won') AS converted,
              COALESCE(SUM(l.expected_revenue) FILTER (WHERE l.status = 'won'), 0) AS revenue
         FROM leads l JOIN users u ON u.id = l.assigned_to
        WHERE ${cond}
        GROUP BY u.id, u.full_name
        ORDER BY revenue DESC`,
      args,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      assigned: Number(r.assigned),
      converted: Number(r.converted),
      revenue: Number(r.revenue),
      rate: Number(r.assigned) > 0 ? Math.round((Number(r.converted) / Number(r.assigned)) * 100) : 0,
    }));
  }

  async executiveProfile(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.full_name, u.employee_code, r.name AS role_name
         FROM users u LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1 AND u.is_deleted = false`,
      [userId],
    );
    return rows[0] || null;
  }

  async executiveLeads(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT id, lead_number, customer_name, phone, destination, status, expected_revenue, created_at
         FROM leads WHERE assigned_to = $1 AND is_deleted = false ORDER BY created_at DESC`,
      [userId],
    );
    return rows;
  }
}
