import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/pool.module';
import { AuditService } from '../audit/audit.service';

// Customers, bookings, quotations and invoices had NO ownership/branch enforcement anywhere --
// `branchId` on their list endpoints was an optional filter the frontend could choose to send,
// not a real boundary, and GET/PATCH/DELETE by :id never checked the record's branch at all. Any
// user with the base "view"/"edit" permission for a module could read or modify ANY branch's
// records just by knowing/guessing an id. This is the shared check that closes that gap:
// super_admin bypasses (same rule Leads already uses), everyone else must match branch_id.
@Injectable()
export class BranchAccessService {
  constructor(@Inject(PG_POOL) private pool: Pool, private audit: AuditService) {}

  async assertAccess(table: string, id: string, user: { userId?: string; roleName?: string; branchId?: string | null } | undefined) {
    // Fail closed: every real caller sits behind JwtAuthGuard so `user` is never actually missing
    // in production, but this method shouldn't silently ALLOW just because the one thing it was
    // told to check (branch match) couldn't be evaluated -- a future caller added without that
    // guard must not get free access by accident.
    if (!user) {
      this.audit.log({ action: 'access_denied', resourceType: table, resourceId: id, result: 'denied', detail: { reason: 'no authenticated user' } });
      throw new ForbiddenException("You don't have access to this record");
    }
    if (user.roleName === 'super_admin') return;
    const { rows } = await this.pool.query(`SELECT branch_id FROM ${table} WHERE id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException();
    if (!user.branchId || rows[0].branch_id !== user.branchId) {
      this.audit.log({
        userId: user.userId ?? null,
        branchId: user.branchId ?? null,
        action: 'access_denied',
        resourceType: table,
        resourceId: id,
        result: 'denied',
        detail: { recordBranchId: rows[0].branch_id },
      });
      throw new ForbiddenException("You don't have access to this record");
    }
  }
}
