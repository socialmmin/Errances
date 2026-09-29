import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';

const VISIBLE_LIMIT = 10;
const PURGE_AFTER_DAYS = 45;

// The Notes tab is one combined timeline: freeform notes typed there directly
// (stored in lead_notes, the only table this ever deletes from), plus a
// read-only mirror of the notes already recorded on requirements, quotations
// and follow-ups for this lead -- so nothing typed anywhere for this lead is
// invisible, without duplicating those records into a second copy anywhere.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('leads/:leadId/notes-feed')
export class LeadNotesController {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  @Get()
  @RequirePermissions(PERMISSIONS.LEADS_VIEW)
  async list(@Param('leadId') leadId: string) {
    // Prune this lead's own freeform notes: keep the most recent 10 no matter how
    // old, and drop anything past #10 once it's also older than 45 days -- so a
    // slow lead never silently loses its last 10 notes, but old clutter doesn't
    // pile up forever either. Requirement/quotation/follow-up notes are never
    // touched here; they belong to those records, not to this scratchpad.
    await this.pool.query(
      `DELETE FROM lead_notes WHERE lead_id = $1 AND created_at < now() - interval '${PURGE_AFTER_DAYS} days'
         AND id NOT IN (SELECT id FROM lead_notes WHERE lead_id = $1 ORDER BY created_at DESC LIMIT ${VISIBLE_LIMIT})`,
      [leadId],
    );

    const [notes, requirements, quotations, followUps] = await Promise.all([
      this.pool.query(
        `SELECT n.id, n.body, n.created_at, u.full_name AS created_by_name
           FROM lead_notes n LEFT JOIN users u ON u.id = n.created_by
          WHERE n.lead_id = $1 ORDER BY n.created_at DESC LIMIT ${VISIBLE_LIMIT}`,
        [leadId],
      ),
      this.pool.query(
        `SELECT id, notes, destination, submitted_at FROM lead_requirements
          WHERE lead_id = $1 AND notes IS NOT NULL AND notes <> '' ORDER BY submitted_at DESC LIMIT ${VISIBLE_LIMIT}`,
        [leadId],
      ),
      this.pool.query(
        `SELECT id, notes, internal_notes, created_at FROM quotations
          WHERE lead_id = $1 AND (notes IS NOT NULL AND notes <> '' OR internal_notes IS NOT NULL AND internal_notes <> '')
          ORDER BY created_at DESC LIMIT ${VISIBLE_LIMIT}`,
        [leadId],
      ),
      this.pool.query(
        `SELECT id, note, created_at FROM lead_follow_ups
          WHERE lead_id = $1 AND note IS NOT NULL AND note <> '' ORDER BY created_at DESC LIMIT ${VISIBLE_LIMIT}`,
        [leadId],
      ),
    ]);

    const feed = [
      ...notes.rows.map((r) => ({ id: 'n-' + r.id, source: 'note' as const, label: 'Note', body: r.body, at: r.created_at, by: r.created_by_name || null })),
      ...requirements.rows.map((r) => ({ id: 'r-' + r.id, source: 'requirement' as const, label: `Requirement${r.destination ? ` — ${r.destination}` : ''}`, body: r.notes, at: r.submitted_at, by: null })),
      ...quotations.rows.flatMap((r) => [
        r.notes ? { id: 'q-' + r.id + '-c', source: 'quotation' as const, label: 'Quotation — customer notes', body: r.notes, at: r.created_at, by: null } : null,
        r.internal_notes ? { id: 'q-' + r.id + '-i', source: 'quotation' as const, label: 'Quotation — internal notes', body: r.internal_notes, at: r.created_at, by: null } : null,
      ].filter(Boolean)),
      ...followUps.rows.map((r) => ({ id: 'f-' + r.id, source: 'followup' as const, label: 'Follow-up', body: r.note, at: r.created_at, by: null })),
    ].sort((a: any, b: any) => new Date(b.at).getTime() - new Date(a.at).getTime());

    return { data: feed.slice(0, VISIBLE_LIMIT), notesOnly: notes.rows.length };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.LEADS_EDIT)
  async create(@Param('leadId') leadId: string, @Body() dto: { body: string }, @Req() req: any) {
    const body = String(dto?.body || '').trim();
    if (!body) return { skipped: true };
    const { rows } = await this.pool.query(
      `INSERT INTO lead_notes(lead_id, body, created_by) VALUES($1,$2,$3) RETURNING id, body, created_at`,
      [leadId, body, req.user?.userId ?? null],
    );
    return rows[0];
  }
}
