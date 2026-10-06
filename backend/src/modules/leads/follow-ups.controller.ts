import { Body, Controller, ForbiddenException, Get, Inject, Logger, OnModuleInit, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';
import { AccessService, RequireAccess } from '../../common/access/access.service';
import { PushService } from '../../common/push/push.service';
import { advanceLeadStatus } from '../../common/leads/advance-lead-status';
import { assertLeadVisible, leadVisibleSql, seesAllLeads } from '../../common/leads/lead-visibility';

// Follow-ups are created from a lead's own page and shown both there and on one
// central Follow-ups page (same rows, two views) -- that's the whole point of them.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireAccess('followups', 'dashboard.calls', 'leads')
@Controller()
export class FollowUpsController implements OnModuleInit {
  private readonly logger = new Logger('FollowUpsCleanup');

  constructor(@Inject(PG_POOL) private pool: Pool, private push: PushService, private access: AccessService) {}

  onModuleInit() {
    // Completed follow-ups have already done their job (the outcome is preserved on the lead's
    // own Notes tab), so keeping them here forever is just dead weight -- checked every 6 hours,
    // not on every request.
    const cleanup = () => this.pool.query(`DELETE FROM lead_follow_ups WHERE status = 'done' AND completed_at < now() - interval '365 days'`)
      .then((r) => { if (r.rowCount) this.logger.log(`Deleted ${r.rowCount} completed follow-up(s) older than a year`); })
      .catch((err) => this.logger.error(`Follow-up cleanup failed: ${err.message}`));
    cleanup();
    setInterval(cleanup, 6 * 3600 * 1000);
    // At a follow-up's time: one push to the person the lead is assigned to (and the super admins).
    const alertDue = async () => {
      const { rows } = await this.pool.query(
        `UPDATE lead_follow_ups f SET due_alerted_at = now()
           FROM leads l
          WHERE l.id = f.lead_id AND f.status = 'pending' AND f.due_alerted_at IS NULL AND f.due_at <= now() AND f.due_at > now() - interval '30 minutes'
          RETURNING f.id, f.lead_id, f.note, l.customer_name, COALESCE(l.whatsapp_number, l.phone) AS phone, l.assigned_to`);
      for (const r of rows) {
        await this.push.notifyUsers(r.assigned_to ? [r.assigned_to] : [], {
          title: `Follow-up due now — call ${r.customer_name}`,
          body: `${r.phone || ''}${r.note ? ` · ${String(r.note).slice(0, 100)}` : ''}`,
          url: `/leads/${r.lead_id}`,
        }).catch((err) => this.logger.warn(`Follow-up due push failed: ${err.message}`));
      }
    };
    setInterval(() => alertDue().catch((err) => this.logger.warn(`Follow-up due check failed: ${err.message}`)), 60 * 1000);
  }

  @Get('leads/:leadId/follow-ups')
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)
  async forLead(@Param('leadId') leadId: string, @Req() req: any) {
    await assertLeadVisible(this.pool, leadId, req.user);
    const { rows } = await this.pool.query(
      `SELECT f.*, u.full_name AS created_by_name FROM lead_follow_ups f
       LEFT JOIN users u ON u.id = f.created_by
       WHERE f.lead_id = $1 ORDER BY f.due_at ASC`,
      [leadId],
    );
    return { data: rows };
  }

  @Post('leads/:leadId/follow-ups')
  @RequireAccess('followups', 'leads')
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)  async create(@Param('leadId') leadId: string, @Body() dto: { dueAt: string; note?: string; followUpType?: string; priority?: string }, @Req() req: any) {
    await assertLeadVisible(this.pool, leadId, req.user);
// One open follow-up per lead: creating a new one replaces (cancels) any other still pending,
    // instead of leaving several open reminders for the same person.
    await this.pool.query(`UPDATE lead_follow_ups SET status = 'cancelled', updated_at = now() WHERE lead_id = $1 AND status = 'pending'`, [leadId]);
    const { rows } = await this.pool.query(
      `INSERT INTO lead_follow_ups(lead_id, due_at, note, created_by, follow_up_type, priority) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [leadId, dto.dueAt, dto.note ?? null, req.user?.userId ?? null, dto.followUpType ?? null, dto.priority ?? null],
    );
    await advanceLeadStatus(this.pool, leadId, 'follow_up');
    const { rows: leadRows } = await this.pool.query(`SELECT customer_name, assigned_to FROM leads WHERE id = $1`, [leadId]);
    const lead = leadRows[0];
    const dueTime = new Date(dto.dueAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    this.push
      .notifyUsers(lead?.assigned_to ? [lead.assigned_to] : [], {
        title: `Follow-up scheduled — ${lead?.customer_name || 'Lead'}`,
        body: `Reminder set for ${dueTime}${dto.note ? `: ${dto.note}` : ''}`,
        url: `/leads/${leadId}?tab=followup`,
      })
      .catch(() => undefined);
    return rows[0];
  }

  // The hero board's real totals -- computed independently of whatever filter/search is
  // currently applied to the list below, so Pending + Done + Cancelled always tallies to Total.
  @Get('follow-ups/stats')
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)
  async stats(@Req() req: any) {
    const scoped = !seesAllLeads(req.user);
    const { rows } = await this.pool.query(
      `SELECT
         count(*) FILTER (WHERE f.status = 'pending')::int AS pending,
         count(*) FILTER (WHERE f.status = 'pending' AND f.due_at < now())::int AS overdue,
         count(*) FILTER (WHERE f.status = 'pending' AND (f.due_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date)::int AS today,
         count(*) FILTER (WHERE f.status = 'pending' AND f.due_at >= now())::int AS upcoming,
         count(*) FILTER (WHERE f.status = 'done')::int AS done,
         count(*) FILTER (WHERE f.status = 'cancelled')::int AS cancelled,
         count(*)::int AS total
       FROM lead_follow_ups f JOIN leads l ON l.id = f.lead_id AND l.is_deleted = false
       ${scoped ? `WHERE ${leadVisibleSql('l.id', '$1')}` : ''}`,
      scoped ? [req.user.userId] : [],
    );
    return rows[0];
  }

  // Global list across every lead -- what "reflects overall" on the Follow-ups page.
  @Get('follow-ups')
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)
  async list(
    @Query('status') status?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('search') search?: string,
    @Req() req?: any,
  ) {
    const conditions: string[] = [];
    const values: any[] = [];
    if (status === 'pending' || status === 'done' || status === 'cancelled') {
      values.push(status);
      conditions.push(`f.status = $${values.length}`);
    } else if (status === 'overdue') {
      conditions.push(`f.status = 'pending' AND f.due_at < now()`);
    } else if (status === 'today') {
      conditions.push(`f.status = 'pending' AND (f.due_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date`);
    } else if (status === 'upcoming') {
      conditions.push(`f.status = 'pending' AND f.due_at >= now()`);
    }
    if (assignedTo) {
      values.push(assignedTo);
      conditions.push(`l.assigned_to = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      conditions.push(`(l.customer_name ILIKE $${values.length} OR l.phone ILIKE $${values.length})`);
    }
    if (!seesAllLeads(req?.user)) {
      values.push(req.user.userId);
      conditions.push(leadVisibleSql('l.id', `$${values.length}`));
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await this.pool.query(
      `SELECT f.*, l.customer_name, l.phone, l.whatsapp_number, l.destination, l.assigned_to, u.full_name AS assigned_to_name
       FROM lead_follow_ups f
       JOIN leads l ON l.id = f.lead_id AND l.is_deleted = false
       LEFT JOIN users u ON u.id = l.assigned_to
       ${where}
       ORDER BY (f.status = 'pending') DESC, f.due_at ASC LIMIT 500`,
      values,
    );
    return { data: rows };
  }

  @Patch('follow-ups/:id')
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)
  async update(
    @Param('id') id: string,
    @Body() dto: { dueAt?: string; note?: string; status?: 'pending' | 'done' | 'cancelled'; outcome?: string; nextFollowUpAt?: string },
    @Req() req: any,
  ) {
    // Completing/rescheduling and cancelling are separate switches in the access panel -- which one
    // applies depends on what this request is doing, so it can only be checked here, not by a decorator.
    if (req.user?.roleName !== 'super_admin') {
      const acc = await this.access.effectiveFor(req.user.userId, req.user.roleName);
      const needed = dto.status === 'cancelled' ? 'followups.cancel' : 'followups.complete';      if (!acc[needed]) throw new ForbiddenException(dto.status === 'cancelled' ? "You don't have permission to cancel follow-ups" : "You don't have permission to complete or reschedule follow-ups");
    }
    const { rows: owner } = await this.pool.query(`SELECT lead_id FROM lead_follow_ups WHERE id = $1`, [id]);
    await assertLeadVisible(this.pool, owner[0]?.lead_id, req.user);
const sets: string[] = ['updated_at = now()'];
    const values: any[] = [];
    if (dto.dueAt !== undefined) { values.push(dto.dueAt); sets.push(`due_at = $${values.length}`); }
    if (dto.note !== undefined) { values.push(dto.note); sets.push(`note = $${values.length}`); }
    if (dto.outcome !== undefined) { values.push(dto.outcome); sets.push(`outcome = $${values.length}`); }
    if (dto.status !== undefined) {
      values.push(dto.status);
      sets.push(`status = $${values.length}`);
      if (dto.status === 'done') {
        values.push(req.user?.userId ?? null);
        sets.push(`completed_by = $${values.length}`, `completed_at = now()`);
      }
    }
    values.push(id);
    const { rows } = await this.pool.query(`UPDATE lead_follow_ups SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
    const followUp = rows[0];
    // What was said on the call goes into the lead's Notes tab too, so the whole team sees it in
    // one place (not only on this follow-up row) -- and "schedule another meeting?" is answered
    // right here instead of a separate trip back to Follow-ups.
    if (dto.status === 'done' && followUp?.lead_id) {
      const outcome = String(dto.outcome || '').trim();
      if (outcome) {
        await this.pool.query(
          `INSERT INTO lead_notes(lead_id, body, created_by) VALUES($1,$2,$3)`,
          [followUp.lead_id, `Follow-up outcome: ${outcome}`, req.user?.userId ?? null],
        );
      }
      if (dto.nextFollowUpAt) {
        // One open follow-up per lead -- this one just went to 'done' above, so only OTHER pending
        // rows (if any) get cancelled here.
        await this.pool.query(`UPDATE lead_follow_ups SET status = 'cancelled', updated_at = now() WHERE lead_id = $1 AND status = 'pending'`, [followUp.lead_id]);
        await this.pool.query(
          `INSERT INTO lead_follow_ups(lead_id, due_at, note, created_by) VALUES($1,$2,$3,$4)`,
          [followUp.lead_id, dto.nextFollowUpAt, outcome ? `Next follow-up: ${outcome}` : 'Next follow-up', req.user?.userId ?? null],
        );
      }
    }
    return followUp;
  }
}
