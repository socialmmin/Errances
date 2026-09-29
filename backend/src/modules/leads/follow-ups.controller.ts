import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';
import { PushService } from '../../common/push/push.service';

// Follow-ups are created from a lead's own page and shown both there and on one
// central Follow-ups page (same rows, two views) -- that's the whole point of them.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class FollowUpsController {
  constructor(@Inject(PG_POOL) private pool: Pool, private push: PushService) {}

  @Get('leads/:leadId/follow-ups')
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)
  async forLead(@Param('leadId') leadId: string) {
    const { rows } = await this.pool.query(
      `SELECT f.*, u.full_name AS created_by_name FROM lead_follow_ups f
       LEFT JOIN users u ON u.id = f.created_by
       WHERE f.lead_id = $1 ORDER BY f.due_at ASC`,
      [leadId],
    );
    return { data: rows };
  }

  @Post('leads/:leadId/follow-ups')
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)
  async create(@Param('leadId') leadId: string, @Body() dto: { dueAt: string; note?: string }, @Req() req: any) {
    // One open follow-up per lead: creating a new one replaces (cancels) any other still pending,
    // instead of leaving several open reminders for the same person.
    await this.pool.query(`UPDATE lead_follow_ups SET status = 'cancelled', updated_at = now() WHERE lead_id = $1 AND status = 'pending'`, [leadId]);
    const { rows } = await this.pool.query(
      `INSERT INTO lead_follow_ups(lead_id, due_at, note, created_by) VALUES($1,$2,$3,$4) RETURNING *`,
      [leadId, dto.dueAt, dto.note ?? null, req.user?.userId ?? null],
    );
    await this.pool.query(`UPDATE leads SET status = CASE WHEN status = 'new' THEN 'follow_up' ELSE status END, updated_at = now() WHERE id = $1`, [leadId]);
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
      conditions.push(`f.status = 'pending' AND f.due_at::date = now()::date`);
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
