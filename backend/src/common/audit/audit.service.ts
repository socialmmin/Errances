import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/pool.module';

export interface AuditEvent {
  userId?: string | null;
  branchId?: string | null;
  action: string; // e.g. 'login_failed', 'access_denied', 'invoice.delete', 'role.changed'
  resourceType: string; // e.g. 'invoice', 'booking', 'auth', 'user'
  resourceId?: string | null;
  result: 'success' | 'denied' | 'failed';
  requestId?: string | null;
  ip?: string | null;
  detail?: Record<string, unknown>; // never put passwords, tokens, API keys or full customer PII here
}

// A record of who did what -- specifically for the events that matter if something goes wrong:
// denied access attempts, login abuse, and changes to money/roles/users. Writing an audit row
// must NEVER throw and block the real action (a failed audit write is a logging problem, not a
// reason to fail someone's legitimate request), so every write is fire-and-forget with its own
// catch.
@Injectable()
export class AuditService {
  private logger = new Logger('Audit');
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  log(event: AuditEvent) {
    this.pool
      .query(
        `INSERT INTO audit_logs(user_id, branch_id, action, resource_type, resource_id, result, request_id, ip, detail)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          event.userId ?? null,
          event.branchId ?? null,
          event.action,
          event.resourceType,
          event.resourceId ?? null,
          event.result,
          event.requestId ?? null,
          event.ip ?? null,
          event.detail ? JSON.stringify(event.detail) : null,
        ],
      )
      .catch((err) => this.logger.error(`Could not write audit log (${event.action}): ${err.message}`));
  }
}
