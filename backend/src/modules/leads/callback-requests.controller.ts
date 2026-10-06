import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';
import { RequireAccess } from '../../common/access/access.service';
import { assertLeadVisible, leadVisibleSql, seesAllLeads } from '../../common/leads/lead-visibility';

// A customer tapping "Call our experts" must never just fade into a popup
// nobody remembers. This stays on this list, pending, until someone actually
// makes the call and marks it done here.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireAccess('callbacks', 'dashboard.calls')
@Controller('callback-requests')
export class CallbackRequestsController {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  @Get()
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)  async list(@Req() req: any) {
    // Salespeople only see callbacks for leads assigned/shared to them. A callback with no matching
    // lead (unknown number) is only visible to a super admin until the lead is created and assigned.
    const scoped = !seesAllLeads(req.user);
    const { rows } = await this.pool.query(
      `SELECT c.*, u.full_name AS called_by_name, l.destination
         FROM callback_requests c
         LEFT JOIN users u ON u.id = c.called_by
         LEFT JOIN leads l ON l.id = c.lead_id
        ${scoped ? `WHERE c.lead_id IS NOT NULL AND ${leadVisibleSql('c.lead_id', '$1')}` : ''}
        ORDER BY (c.called_at IS NULL) DESC, c.requested_at DESC LIMIT 500`,
      scoped ? [req.user.userId] : [],
    );
    return { data: rows };
  }

  // What happens next, picked in the "Mark called" popup. Each maps to a concrete next step,
  // not just a label -- the frontend uses the same key to decide where to send the person.
  private static readonly OUTCOME_STATUS: Record<string, string> = {
    busy: 'follow_up',
    quotation: 'interested',
    itinerary: 'interested',
    converted: 'advance_paid',
    not_interested: 'not_interested',
  };
  private static readonly OUTCOME_LABEL: Record<string, string> = {
    busy: 'Busy — follow up again',
    quotation: 'Move to quotation',
    itinerary: 'Send itinerary',
    converted: 'Converted / paid',
    not_interested: 'Not interested',
  };

  @Patch(':id/mark-called')
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)
  async markCalled(@Param('id') id: string, @Body() dto: { note?: string; outcome?: string; nextFollowUpAt?: string }, @Req() req: any) {
    const note = String(dto?.note || '').trim();    const outcome = dto?.outcome && CallbackRequestsController.OUTCOME_LABEL[dto.outcome] ? dto.outcome : null;
    // Closing the lead from here needs the reason typed, the same as everywhere else.
    if (outcome === 'not_interested' && note.replace(/\s+/g, ' ').length < 10) throw new BadRequestException('Type what the customer said before marking this lead as Not Interested');
    if (!seesAllLeads(req.user)) {
      const { rows: owner } = await this.pool.query(`SELECT lead_id FROM callback_requests WHERE id = $1`, [id]);
      await assertLeadVisible(this.pool, owner[0]?.lead_id, req.user);
    }
const { rows } = await this.pool.query(
      `UPDATE callback_requests SET called_at = now(), called_by = $2, outcome = $3, note = $4 WHERE id = $1 RETURNING *`,
      [id, req.user?.userId ?? null, outcome, note || null],
    );
    const request = rows[0];
    if (request?.lead_id) {
      // What was said on the call goes straight into the lead's Notes tab, so the
      // outcome lives with the lead, not only on this list.
      const label = outcome ? CallbackRequestsController.OUTCOME_LABEL[outcome] : null;
      await this.pool.query(
        `INSERT INTO lead_notes(lead_id, body, created_by) VALUES($1,$2,$3)`,
        [request.lead_id, `Callback made${label ? ` — ${label}` : ''}${note ? `: ${note}` : ''}`, req.user?.userId ?? null],
      );
      if (outcome) {
        await this.pool.query(
          `UPDATE leads SET status = $2::lead_status, lost_reason = COALESCE($3, lost_reason), updated_at = now() WHERE id = $1`,
          [request.lead_id, CallbackRequestsController.OUTCOME_STATUS[outcome], outcome === 'not_interested' ? `Said on callback — ${note.replace(/\s+/g, ' ').slice(0, 480)}` : null],
        );
      }
      // "Busy -- follow up again" schedules the one open follow-up for this lead right here,
      // instead of a separate trip to Follow-ups. One open follow-up per lead: any other pending
      // one for this lead is replaced.
      if (outcome === 'busy' && dto?.nextFollowUpAt) {
        await this.pool.query(`UPDATE lead_follow_ups SET status = 'cancelled', updated_at = now() WHERE lead_id = $1 AND status = 'pending'`, [request.lead_id]);
        await this.pool.query(
          `INSERT INTO lead_follow_ups(lead_id, due_at, note, created_by) VALUES($1,$2,$3,$4)`,
          [request.lead_id, dto.nextFollowUpAt, note ? `Follow-up after callback: ${note}` : 'Follow-up after callback', req.user?.userId ?? null],
        );
      }
    }
    return { ...request, outcome };
  }
}
