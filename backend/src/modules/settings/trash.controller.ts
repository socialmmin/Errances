import { BadRequestException, Controller, Get, Inject, Logger, NotFoundException, OnModuleInit, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';

const KEEP_DAYS = 60;

// Everything that can be deleted in the CRM is only hidden (is_deleted); this is where it can be
// seen and brought back. One entry per kind of record, in the order the page shows them.
const KINDS: { key: string; label: string; table: string; title: string; detail: string; purge: boolean; restoreExtra?: string }[] = [
  { key: 'lead', label: 'Leads', table: 'leads', title: `t.customer_name`, detail: `concat_ws(' · ', NULLIF(t.phone, ''), NULLIF(t.destination, ''))`, purge: false },
  { key: 'quotation', label: 'Quotations', table: 'quotations', title: `t.quotation_number`, detail: `concat_ws(' · ', NULLIF(t.destination, ''), '₹' || t.final_amount::text)`, purge: true },
  { key: 'invoice', label: 'Invoices', table: 'invoices', title: `t.invoice_number`, detail: `'₹' || t.total_amount::text`, purge: false },
  { key: 'package', label: 'Packages & itineraries', table: 'tour_packages', title: `t.name`, detail: `''`, purge: false },
  { key: 'customer', label: 'Customers', table: 'customers', title: `t.full_name`, detail: `COALESCE(t.phone, '')`, purge: true },
  { key: 'booking', label: 'Bookings', table: 'bookings', title: `COALESCE(t.booking_number, t.id::text)`, detail: `''`, purge: false },
  { key: 'vendor', label: 'Vendors', table: 'vendors', title: `t.name`, detail: `''`, purge: true },
  { key: 'task', label: 'Tasks', table: 'tasks', title: `t.title`, detail: `''`, purge: true },
  { key: 'user', label: 'Employees', table: 'users', title: `t.full_name`, detail: `COALESCE(t.email, '')`, purge: false, restoreExtra: `, is_active = true` },
];

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('settings/trash')
export class TrashController implements OnModuleInit {
  private logger = new Logger('Trash');
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  // After 60 days an item leaves the Trash for good. Records nothing else depends on are removed
  // from the database; leads, invoices, bookings, packages and employees are referenced by
  // history elsewhere (and a removed lead would be re-imported from Meta), so those stay hidden
  // and simply stop being restorable.
  onModuleInit() {
    const purge = async () => {
      for (const k of KINDS.filter((x) => x.purge)) {
        const { rows } = await this.pool.query(`SELECT id FROM ${k.table} WHERE is_deleted = true AND deleted_at < now() - interval '${KEEP_DAYS} days'`).catch(() => ({ rows: [] as any[] }));
        let removed = 0;
        for (const r of rows) await this.pool.query(`DELETE FROM ${k.table} WHERE id = $1`, [r.id]).then(() => { removed++; }).catch(() => undefined);
        if (removed) this.logger.log(`Permanently removed ${removed} ${k.label.toLowerCase()} after ${KEEP_DAYS} days in the Trash`);
      }
    };
    setTimeout(() => purge().catch(() => undefined), 60_000);
    setInterval(() => purge().catch(() => undefined), 12 * 3600 * 1000);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_USERS)
  async list() {
    const out: { key: string; label: string; items: any[] }[] = [];
    for (const k of KINDS) {
      const { rows } = await this.pool.query(
        `SELECT t.id, ${k.title} AS title, ${k.detail} AS detail, t.deleted_at,
                GREATEST(0, ${KEEP_DAYS} - floor(extract(epoch FROM now() - t.deleted_at) / 86400))::int AS days_left
           FROM ${k.table} t
          WHERE t.is_deleted = true AND t.deleted_at > now() - interval '${KEEP_DAYS} days'
          ORDER BY t.deleted_at DESC LIMIT 500`,
      ).catch((e) => { this.logger.warn(`Trash list for ${k.table} failed: ${e.message}`); return { rows: [] as any[] }; });
      out.push({ key: k.key, label: k.label, items: rows });
    }
    return { keepDays: KEEP_DAYS, total: out.reduce((n, c) => n + c.items.length, 0), categories: out };
  }

  @Post(':kind/:id/restore')
  @RequirePermissions(PERMISSIONS.SETTINGS_USERS)
  async restore(@Param('kind') kind: string, @Param('id') id: string, @Req() req: any) {
    const k = KINDS.find((x) => x.key === kind);
    if (!k) throw new BadRequestException('Unknown kind of record');
    const { rows } = await this.pool.query(
      `UPDATE ${k.table} SET is_deleted = false${k.restoreExtra ?? ''} WHERE id = $1 AND is_deleted = true AND deleted_at > now() - interval '${KEEP_DAYS} days' RETURNING id`,
      [id],
    ).catch((e) => { throw new BadRequestException(`Could not restore: ${e.message}`); });
    if (!rows[0]) throw new NotFoundException('This item is no longer in the Trash');
    this.logger.log(`${k.key} ${id} restored by ${req.user?.userId}`);
    return { restored: true };
  }
}
