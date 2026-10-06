import { Body, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Put, Req, UseGuards, ConflictException, ForbiddenException, Query } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { openPassword, sealPassword } from '../../common/crypto/password-vault';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS, roleHasPermission } from '../../common/rbac/role-permissions';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuditService } from '../../common/audit/audit.service';
import { AccessService } from '../../common/access/access.service';
import { workBoardRows } from '../../common/work-board';
import { ACCESS_CATALOG, ACCESS_KEYS, effectiveAccess, roleDefaults } from '../../common/access/access-catalog';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(@Inject(PG_POOL) private pool: Pool, private audit: AuditService, private access: AccessService) {}

  // Lightweight active-user list for assignment dropdowns (leads, tasks) --
  // needs only leads:assign, not the full settings:users admin permission.
  // Self-service: this user's own notification preference (independent of the
  // browser's own permission state, which is a separate, per-device thing).
  // What the logged-in employee can see right now -- drives their sidebar and dashboard sections.
  // Declared before ':id/access' so "me" isn't captured as an id.
  @Get('me/access')
  async myAccess(@Req() req: any) {
    return { catalog: ACCESS_CATALOG, access: await this.access.effectiveFor(req.user.userId, req.user.roleName) };
  }  // Login ID + password for the Company Users "eye" reveal. Super admin only, audit-logged.
  // Employees created before the vault existed show password: null until it is reset once.
  @Get(':id/credentials')
  @RequirePermissions(PERMISSIONS.SETTINGS_USERS)
  async credentials(@Param('id') id: string, @Req() req: any) {
    if (req.user?.roleName !== 'super_admin') throw new ForbiddenException('Only a super admin can view passwords');
    const { rows } = await this.pool.query(`SELECT phone, email, password_enc FROM users WHERE id = $1 AND is_deleted = false`, [id]);
    if (!rows[0]) throw new NotFoundException('Employee not found');
    this.audit.log({ userId: req.user?.userId, branchId: req.user?.branchId, action: 'user.password_viewed', resourceType: 'user', resourceId: id, result: 'success' });
    return { loginId: rows[0].phone || rows[0].email, password: openPassword(rows[0].password_enc) };
  }

  // The access panel for one employee: their role's defaults, the overrides saved on top, and
  // the resulting effective access.
  @Get(':id/access')
  @RequirePermissions(PERMISSIONS.SETTINGS_USERS)
  async getAccess(@Param('id') id: string) {
    const { rows } = await this.pool.query(
      `SELECT u.page_access, r.name AS role_name, r.description AS role_description, u.id, u.full_name, u.email, u.phone, u.is_active, u.participate_round_robin, u.last_login_at, u.created_at,
              (SELECT COUNT(*)::int FROM leads l WHERE l.assigned_to = u.id AND l.is_deleted = false) AS assigned_leads
         FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND u.is_deleted = false`, [id],
    );
    if (!rows[0]) throw new NotFoundException('Employee not found');
    const roleName = rows[0].role_name;
    const { page_access, ...profile } = rows[0];
    return { catalog: ACCESS_CATALOG, roleName, user: profile, defaults: roleDefaults(roleName), access: effectiveAccess(roleName, page_access) };
  }

  // Saves the full set of switches. Only what differs from the role's defaults is stored, so if
  // the role is later changed the employee picks up the new role's defaults for everything the
  // admin never deliberately changed.
  @Put(':id/access')
  @RequirePermissions(PERMISSIONS.SETTINGS_USERS)
  async setAccess(@Param('id') id: string, @Body() dto: { access: Record<string, boolean> }, @Req() req: any) {
    const { rows } = await this.pool.query(
      `SELECT r.name AS role_name FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND u.is_deleted = false`, [id],
    );
    if (!rows[0]) throw new NotFoundException('Employee not found');
    if (rows[0].role_name === 'super_admin') throw new ForbiddenException('A super admin always has full access');
    const defaults = roleDefaults(rows[0].role_name);
    const overrides: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(dto?.access ?? {})) {
      if (ACCESS_KEYS.has(k) && typeof v === 'boolean' && v !== defaults[k]) overrides[k] = v;
    }
    await this.pool.query(`UPDATE users SET page_access = $2, updated_at = now() WHERE id = $1`, [id, Object.keys(overrides).length ? JSON.stringify(overrides) : null]);
    this.access.invalidate(id);
    this.audit.log({ userId: req.user?.userId, branchId: req.user?.branchId, action: 'user.access_changed', resourceType: 'user', resourceId: id, result: 'success', detail: { overrides } });
    return { access: effectiveAccess(rows[0].role_name, overrides) };
  }

  @Get('me/notifications')
  getMyNotificationPreference(@Req() req: any) {
    return this.pool.query(`SELECT notifications_enabled FROM users WHERE id = $1`, [req.user?.userId])
      .then(({ rows }) => ({ enabled: rows[0]?.notifications_enabled ?? true }));
  }

  @Patch('me/notifications')
  async setMyNotificationPreference(@Body() dto: { enabled: boolean }, @Req() req: any) {
    await this.pool.query(`UPDATE users SET notifications_enabled = $1 WHERE id = $2`, [!!dto.enabled, req.user?.userId]);
    return { enabled: !!dto.enabled };
  }

  // Round-robin distribution of every currently UNASSIGNED lead. GET previews the split; POST does
  // it. Super admin only. Leads go out oldest-first in rotation, so each person gets an even share
  // (differs by at most one), and the live rotation for new leads continues after the last person.
  @Get('lead-distribution')
  @RequirePermissions(PERMISSIONS.SETTINGS_USERS)
  async distributionPreview(@Req() req: any) {
    if (req.user?.roleName !== 'super_admin') throw new ForbiddenException('Only a super admin can distribute leads');
    const { rows: people } = await this.pool.query(
      `SELECT u.id, u.full_name, u.phone, r.name AS role_name, u.participate_round_robin, u.is_active,
              (SELECT count(*)::int FROM leads l WHERE l.assigned_to = u.id AND l.is_deleted = false) AS assigned_leads
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.is_deleted = false AND u.is_active = true AND r.name <> 'super_admin' ORDER BY u.created_at, u.id`);
    const { rows: c } = await this.pool.query(`SELECT count(*) FILTER (WHERE assigned_to IS NULL)::int AS unassigned, count(*)::int AS total FROM leads WHERE is_deleted = false`);
    return { unassigned: c[0].unassigned, total: c[0].total, people: people.filter((p: any) => roleHasPermission(p.role_name, PERMISSIONS.LEADS_VIEW)) };
  }

  @Post('lead-distribution')
  @RequirePermissions(PERMISSIONS.SETTINGS_USERS)
  async distribute(@Body() dto: { userIds: string[] }, @Req() req: any) {
    if (req.user?.roleName !== 'super_admin') throw new ForbiddenException('Only a super admin can distribute leads');
    const ids = Array.from(new Set((dto?.userIds ?? []).filter((x) => typeof x === 'string')));
    if (!ids.length) throw new ConflictException('Choose at least one person');
    const { rows: valid } = await this.pool.query(
      `SELECT u.id, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ANY($1::uuid[]) AND u.is_deleted = false AND u.is_active = true AND r.name <> 'super_admin'`, [ids]);
    const ok = new Set(valid.filter((v: any) => roleHasPermission(v.role_name, PERMISSIONS.LEADS_VIEW)).map((v: any) => v.id));
    const order = ids.filter((id) => ok.has(id));
    if (!order.length) throw new ConflictException('None of the chosen people can work on leads');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: branches } = await client.query(`SELECT DISTINCT branch_id FROM leads WHERE is_deleted = false AND assigned_to IS NULL AND branch_id IS NOT NULL`);
      for (const b of branches) await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`lead-round-robin:${b.branch_id}`]);
      const { rows } = await client.query(
        `WITH who AS (SELECT id, ord - 1 AS slot FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ord)),
              pending AS (SELECT id, (row_number() OVER (ORDER BY created_at, id) - 1) % $2 AS slot FROM leads WHERE is_deleted = false AND assigned_to IS NULL)
         UPDATE leads SET assigned_to = who.id, updated_at = now()
           FROM pending JOIN who ON who.slot = pending.slot
          WHERE leads.id = pending.id
         RETURNING leads.assigned_to`, [order, order.length]);
      // Continue the live rotation for new leads from where this split ended.
      const lastSlot = rows.length ? (rows.length - 1) % order.length : -1;
      if (lastSlot >= 0) for (const b of branches) {
        await client.query(`INSERT INTO lead_assignment_state(branch_id, last_user_id) VALUES($1,$2) ON CONFLICT(branch_id) DO UPDATE SET last_user_id=$2, updated_at=now()`, [b.branch_id, order[lastSlot]]);
      }
      await client.query('COMMIT');
      const perUser: Record<string, number> = {};
      for (const r of rows) perUser[r.assigned_to] = (perUser[r.assigned_to] ?? 0) + 1;
      this.audit.log({ userId: req.user?.userId, branchId: req.user?.branchId, action: 'leads.round_robin_distributed', resourceType: 'lead', result: 'success', detail: { assigned: rows.length, perUser } });
      return { assigned: rows.length, perUser };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }

  // Every lead this employee is handling, for the "Assigned leads" tab on their page.
  @Get(':id/assigned-leads')
  @RequirePermissions(PERMISSIONS.SETTINGS_USERS)
  async assignedLeads(@Param('id') id: string) {
    const { rows } = await this.pool.query(
      `SELECT l.id, l.lead_number, l.customer_name, l.phone, l.whatsapp_number, l.destination, l.status, l.priority, l.source, l.created_at,
              (SELECT max(m.created_at) FROM whatsapp_messages m WHERE m.lead_id = l.id) AS last_message_at,
              EXISTS (SELECT 1 FROM lead_follow_ups f WHERE f.lead_id = l.id AND f.status = 'pending') AS has_follow_up
         FROM leads l WHERE l.assigned_to = $1 AND l.is_deleted = false ORDER BY l.created_at DESC LIMIT 2000`, [id]);
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    return { data: rows, total: rows.length, byStatus };
  }

  // The period every report on an employee's page uses: whole days in India time. No dates = everything.
  private period(from?: string, to?: string) {
    const ok = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    return { from: ok(from) ?? '2000-01-01', to: ok(to) ?? '2100-01-01' };
  }

  // The work board: for every employee, each section of the sidebar as three numbers --
  //   to clear (pending / overdue: the number that should reach zero), upcoming, and done in the period.
  // "To clear" and "upcoming" are as of this moment; only "done" follows the chosen dates.
  // One employee (userId) for their Performance tab, or everyone for the team view.
  @Get('work-board')
  @RequirePermissions(PERMISSIONS.SETTINGS_USERS)
  async workBoard(@Query('from') from?: string, @Query('to') to?: string, @Query('userId') userId?: string) {
    const p = this.period(from, to);
    const one = userId && /^[0-9a-f-]{36}$/i.test(userId) ? userId : null;
    const rows = await workBoardRows(this.pool, p.from, p.to, one);
    return { period: p, asOf: new Date().toISOString(), data: rows };
  }

  // Everything this employee did in the CRM, newest first, for the "Activity" tab on their page.
  // Each row says what it was before and what it is now where that applies (a follow-up that
  // replaced an earlier one, a lead's stage, who a lead is assigned to).
  @Get(':id/activity')
  @RequirePermissions(PERMISSIONS.SETTINGS_USERS)
  async activity(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    const p = this.period(from, to);
    const within = (col: string) => `${col} >= ($2::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AND ${col} < ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'`;
    const events = `
      SELECT f.created_at AS at, 'followup_created' AS kind, COALESCE(f.note, '') AS detail, f.lead_id, l.customer_name, f.due_at AS due_at, f.status::text AS state,
             (SELECT to_char(p.due_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI am') FROM lead_follow_ups p
               WHERE p.lead_id = f.lead_id AND p.id <> f.id AND p.created_at < f.created_at AND p.status = 'cancelled' AND p.updated_at >= f.created_at - interval '1 minute' AND p.updated_at <= f.created_at + interval '1 minute'
               ORDER BY p.created_at DESC LIMIT 1) AS before_value,
             to_char(f.due_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI am') AS after_value
        FROM lead_follow_ups f LEFT JOIN leads l ON l.id = f.lead_id WHERE f.created_by::text = $1 AND ${within('f.created_at')}
      UNION ALL
      SELECT f.completed_at, 'followup_done', COALESCE(NULLIF(f.outcome, ''), f.note, ''), f.lead_id, l.customer_name, f.due_at, f.status::text, 'Pending', 'Completed'
        FROM lead_follow_ups f LEFT JOIN leads l ON l.id = f.lead_id WHERE f.completed_by::text = $1 AND ${within('f.completed_at')}
      UNION ALL
      SELECT ch.created_at, CASE WHEN ch.field = 'status' THEN 'stage_changed' ELSE 'lead_assigned' END, '', ch.lead_id, l.customer_name, NULL::timestamptz, NULL::text,
             CASE WHEN ch.field = 'status' THEN ch.old_value ELSE COALESCE((SELECT u.full_name FROM users u WHERE u.id::text = ch.old_value), 'Unassigned') END,
             CASE WHEN ch.field = 'status' THEN ch.new_value ELSE COALESCE((SELECT u.full_name FROM users u WHERE u.id::text = ch.new_value), 'Unassigned') END
        FROM lead_changes ch LEFT JOIN leads l ON l.id = ch.lead_id
       WHERE (ch.changed_by::text = $1 OR (ch.changed_by IS NULL AND ch.field = 'status' AND l.assigned_to::text = $1)) AND ${within('ch.created_at')}
      UNION ALL
      SELECT n.created_at, 'note', n.body, n.lead_id, l.customer_name, NULL::timestamptz, NULL::text, NULL::text, NULL::text
        FROM lead_notes n LEFT JOIN leads l ON l.id = n.lead_id WHERE n.created_by::text = $1 AND ${within('n.created_at')}
      UNION ALL
      SELECT m.created_at, 'whatsapp', left(COALESCE(m.body, ''), 220), m.lead_id, l.customer_name, NULL::timestamptz, NULL::text, NULL::text, NULL::text
        FROM whatsapp_messages m LEFT JOIN leads l ON l.id = m.lead_id WHERE m.sent_by::text = $1 AND m.direction = 'out' AND ${within('m.created_at')}
      UNION ALL
      SELECT COALESCE(w.sent_at, w.created_at), 'itinerary', COALESCE(w.template_name, ''), w.lead_id, l.customer_name, NULL::timestamptz, w.status::text, NULL::text, NULL::text
        FROM whatsapp_logs w LEFT JOIN leads l ON l.id = w.lead_id WHERE w.sent_by::text = $1 AND w.message_type = 'itinerary' AND w.is_deleted = false AND ${within('COALESCE(w.sent_at, w.created_at)')}
      UNION ALL
      SELECT s.marked_at, 'itinerary_manual', '', s.lead_id, l.customer_name, NULL::timestamptz, NULL::text, 'Not delivered', 'Sent by hand'
        FROM manual_itinerary_sends s LEFT JOIN leads l ON l.id = s.lead_id WHERE s.marked_by::text = $1 AND ${within('s.marked_at')}
      UNION ALL
      SELECT c.called_at, 'callback', COALESCE(c.note, ''), c.lead_id, COALESCE(l.customer_name, c.customer_name), NULL::timestamptz, c.outcome::text, 'Waiting for a call', 'Called'
        FROM callback_requests c LEFT JOIN leads l ON l.id = c.lead_id WHERE c.called_by::text = $1 AND ${within('c.called_at')}
      UNION ALL
      SELECT q.created_at, 'quotation', q.quotation_number || COALESCE(' · ' || q.destination, '') || ' · ₹' || q.final_amount::text, q.lead_id, l.customer_name, NULL::timestamptz, q.status::text, NULL::text, NULL::text
        FROM quotations q LEFT JOIN leads l ON l.id = q.lead_id WHERE q.created_by::text = $1 AND q.is_deleted = false AND ${within('q.created_at')}
      UNION ALL
      SELECT pm.created_at, 'payment', '₹' || pm.amount::text || ' · ' || pm.method::text || COALESCE(' · ' || i.invoice_number, ''), q.lead_id, l.customer_name, NULL::timestamptz, pm.status::text, NULL::text, NULL::text
        FROM payments pm LEFT JOIN invoices i ON i.id = pm.invoice_id LEFT JOIN quotations q ON q.id = i.quotation_id LEFT JOIN leads l ON l.id = q.lead_id
       WHERE COALESCE(pm.collected_by, pm.created_by)::text = $1 AND pm.is_deleted = false AND ${within('pm.created_at')}
      UNION ALL
      SELECT a.created_at, 'login', '', NULL::uuid, NULL::text, NULL::timestamptz, NULL::text, NULL::text, NULL::text
        FROM audit_logs a WHERE a.user_id::text = $1 AND a.action = 'login_succeeded' AND ${within('a.created_at')}`;
    const args = [id, p.from, p.to];
    const [{ rows: items }, { rows: counts }, { rows: contacted }] = await Promise.all([
      this.pool.query(`SELECT * FROM (${events}) x WHERE at IS NOT NULL ORDER BY at DESC LIMIT 1000`, args),
      this.pool.query(`SELECT kind, count(*)::int AS n FROM (${events}) x WHERE at IS NOT NULL GROUP BY kind`, args),
      this.pool.query(`SELECT count(DISTINCT lead_id)::int AS n FROM (${events}) x WHERE at IS NOT NULL AND lead_id IS NOT NULL AND kind <> 'lead_assigned'`, args),
    ]);
    const summary: Record<string, number> = {};
    for (const c of counts) summary[c.kind] = c.n;
    return { summary, leadsContacted: contacted[0]?.n ?? 0, total: counts.reduce((n, c) => n + c.n, 0), data: items };
  }

  // Every piece of work that belongs to this employee, section by section (the same sections as
  // the sidebar), plus the numbers for the chosen period. The page sorts each list into
  // pending / overdue / completed itself.
  @Get(':id/work')
  @RequirePermissions(PERMISSIONS.SETTINGS_USERS)
  async work(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    const p = this.period(from, to);
    const within = (col: string) => `${col} >= ($2::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AND ${col} < ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'`;
    const one = (sql: string, args: any[] = [id]) => this.pool.query(sql, args).then((r) => r.rows).catch((e) => { console.warn(`work query failed: ${e.message}`); return [] as any[]; });
    const [leads, followUps, callbacks, itineraries, quotations, invoices, inbox, perf, dueDates] = await Promise.all([
      one(`SELECT l.id, l.customer_name, l.phone, l.whatsapp_number, l.destination, l.status::text AS status, l.created_at, l.updated_at,
                  (SELECT min(f.due_at) FROM lead_follow_ups f WHERE f.lead_id = l.id AND f.status = 'pending') AS next_follow_up,
                  (SELECT max(m.created_at) FROM whatsapp_messages m WHERE m.lead_id = l.id) AS last_message_at
             FROM leads l WHERE l.assigned_to = $1 AND l.is_deleted = false ORDER BY l.created_at DESC LIMIT 3000`),
      one(`SELECT f.id, f.lead_id, l.customer_name, COALESCE(l.whatsapp_number, l.phone) AS phone, l.destination, f.due_at, f.note, f.status::text AS status, f.outcome, f.created_at, f.completed_at,
                  cu.full_name AS created_by_name, du.full_name AS completed_by_name
             FROM lead_follow_ups f JOIN leads l ON l.id = f.lead_id LEFT JOIN users cu ON cu.id = f.created_by LEFT JOIN users du ON du.id = f.completed_by
            WHERE (l.assigned_to = $1 OR f.created_by = $1) AND l.is_deleted = false AND f.status <> 'cancelled' ORDER BY f.due_at DESC LIMIT 2000`),
      one(`SELECT c.id, c.lead_id, COALESCE(l.customer_name, c.customer_name) AS customer_name, c.phone, l.destination, c.requested_at, c.called_at, c.outcome, c.note, u.full_name AS called_by_name
             FROM callback_requests c LEFT JOIN leads l ON l.id = c.lead_id LEFT JOIN users u ON u.id = c.called_by
            WHERE l.assigned_to = $1 OR c.called_by = $1 ORDER BY c.requested_at DESC LIMIT 2000`),
      one(`SELECT DISTINCT ON (w.lead_id, w.package_id) w.id, w.lead_id, l.customer_name, COALESCE(l.whatsapp_number, l.phone) AS phone, COALESCE(pk.name, l.destination) AS package_name,
                  w.status::text AS status, COALESCE(w.sent_at, w.created_at) AS at, w.error_message,
                  (SELECT s.marked_at FROM manual_itinerary_sends s WHERE s.lead_id = w.lead_id AND s.package_id = w.package_id ORDER BY s.marked_at DESC LIMIT 1) AS manual_at
             FROM whatsapp_logs w JOIN leads l ON l.id = w.lead_id LEFT JOIN tour_packages pk ON pk.id = w.package_id
            WHERE l.assigned_to = $1 AND l.is_deleted = false AND w.is_deleted = false AND w.message_type = 'itinerary' AND w.status <> 'test_mode_skipped'
            ORDER BY w.lead_id, w.package_id, w.created_at DESC LIMIT 4000`),
      one(`SELECT q.id, q.quotation_number, q.lead_id, COALESCE(c.full_name, l.customer_name) AS customer_name, q.destination, q.final_amount::float AS final_amount, q.status::text AS status, q.created_at, q.updated_at, q.valid_until,
                  (SELECT i.invoice_number FROM invoices i WHERE i.quotation_id = q.id AND i.is_deleted = false LIMIT 1) AS invoice_number
             FROM quotations q LEFT JOIN leads l ON l.id = q.lead_id LEFT JOIN customers c ON c.id = q.customer_id
            WHERE q.is_deleted = false AND (q.created_by = $1 OR l.assigned_to = $1) ORDER BY q.created_at DESC LIMIT 1000`),
      one(`SELECT i.id, i.invoice_number, q.lead_id, q.quotation_number, COALESCE(c.full_name, l.customer_name) AS customer_name, q.destination, i.total_amount::float AS total_amount, i.due_date, i.created_at,
                  COALESCE((SELECT sum(pm.amount) FROM payments pm WHERE pm.invoice_id = i.id AND pm.is_deleted = false AND pm.status = 'completed'), 0)::float AS paid_amount
             FROM invoices i JOIN quotations q ON q.id = i.quotation_id LEFT JOIN leads l ON l.id = q.lead_id LEFT JOIN customers c ON c.id = q.customer_id
            WHERE i.is_deleted = false AND q.is_deleted = false AND (q.created_by = $1 OR l.assigned_to = $1) ORDER BY i.created_at DESC LIMIT 1000`),
      one(`SELECT l.id AS lead_id, l.customer_name, COALESCE(l.whatsapp_number, l.phone) AS phone, l.destination, COALESCE(s.status, 'open') AS chat_status,
                  lm.body AS last_body, lm.direction AS last_direction, lm.created_at AS last_at,
                  (SELECT count(*)::int FROM whatsapp_messages m WHERE m.lead_id = l.id AND m.direction = 'in' AND m.created_at > COALESCE(s.last_read_at, '2026-09-27T00:00:00+05:30'::timestamptz)) AS unread
             FROM leads l LEFT JOIN whatsapp_chat_state s ON s.lead_id = l.id
             JOIN LATERAL (SELECT body, direction, created_at FROM whatsapp_messages m WHERE m.lead_id = l.id ORDER BY created_at DESC LIMIT 1) lm ON true
            WHERE l.assigned_to = $1 AND l.is_deleted = false ORDER BY lm.created_at DESC LIMIT 1000`),
      one(`SELECT
              (SELECT count(*)::int FROM leads l WHERE l.assigned_to = $1 AND l.is_deleted = false AND ${within('l.created_at')}) AS new_leads,
              (SELECT count(*)::int FROM lead_follow_ups f WHERE f.created_by = $1 AND ${within('f.created_at')}) AS followups_created,
              (SELECT count(*)::int FROM lead_follow_ups f WHERE f.completed_by = $1 AND ${within('f.completed_at')}) AS followups_completed,
              (SELECT count(*)::int FROM callback_requests c WHERE c.called_by = $1 AND ${within('c.called_at')}) AS callbacks_handled,
              (SELECT count(*)::int FROM whatsapp_messages m WHERE m.sent_by::text = $1::text AND m.direction = 'out' AND ${within('m.created_at')}) AS messages_sent,
              (SELECT count(*)::int FROM lead_notes n WHERE n.created_by = $1 AND ${within('n.created_at')}) AS notes_added,
              (SELECT count(*)::int FROM manual_itinerary_sends s WHERE s.marked_by = $1 AND ${within('s.marked_at')})
                + (SELECT count(*)::int FROM whatsapp_logs w WHERE w.sent_by::text = $1::text AND w.message_type = 'itinerary' AND w.is_deleted = false AND ${within('COALESCE(w.sent_at, w.created_at)')}) AS itineraries_sent,
              (SELECT count(*)::int FROM quotations q WHERE q.created_by = $1 AND q.is_deleted = false AND ${within('q.created_at')}) AS quotations_created,
              (SELECT count(*)::int FROM quotations q LEFT JOIN leads l ON l.id = q.lead_id WHERE q.is_deleted = false AND (q.created_by = $1 OR l.assigned_to = $1) AND q.status IN ('accepted','converted') AND ${within('q.updated_at')}) AS quotations_approved,
              (SELECT COALESCE(sum(pm.amount), 0)::float FROM payments pm WHERE COALESCE(pm.collected_by, pm.created_by) = $1 AND pm.is_deleted = false AND pm.status = 'completed' AND ${within('pm.created_at')}) AS amount_collected,
              (SELECT count(DISTINCT ch.lead_id)::int FROM lead_changes ch JOIN leads l ON l.id = ch.lead_id WHERE l.assigned_to = $1 AND ch.field = 'status' AND ch.new_value IN ('won','booking_confirmed','advance_paid') AND ${within('ch.created_at')}) AS leads_converted,
              (SELECT count(DISTINCT ch.lead_id)::int FROM lead_changes ch JOIN leads l ON l.id = ch.lead_id WHERE l.assigned_to = $1 AND ch.field = 'status' AND ch.new_value IN ('interested','qualified','quotation_sent','negotiation') AND ${within('ch.created_at')}) AS marked_interested,
              (SELECT count(DISTINCT ch.lead_id)::int FROM lead_changes ch JOIN leads l ON l.id = ch.lead_id WHERE l.assigned_to = $1 AND ch.field = 'status' AND ch.new_value IN ('not_interested','lost') AND ${within('ch.created_at')}) AS marked_not_interested`, [id, p.from, p.to]),
      // "for which date": the follow-ups created in the period, grouped by the day they are due
      one(`SELECT to_char(f.due_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS due_day, count(*)::int AS n,
                  count(*) FILTER (WHERE f.status = 'done')::int AS done
             FROM lead_follow_ups f WHERE f.created_by = $1 AND f.status <> 'cancelled' AND ${within('f.created_at')} GROUP BY 1 ORDER BY 1`, [id, p.from, p.to]),
    ]);
    return { period: p, performance: perf[0] ?? {}, followUpsByDueDay: dueDates, leads, followUps, callbacks, itineraries, quotations, invoices, inbox };
  }

  @Get('assignable')
  @RequirePermissions(PERMISSIONS.LEADS_ASSIGN)
  async findAssignable() {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.full_name, u.employee_code FROM users u JOIN roles r ON r.id=u.role_id
       WHERE u.is_deleted=false AND u.is_active=true AND r.name <> 'super_admin'
         AND r.permissions ? 'leads:view' ORDER BY u.full_name ASC`,
    );
    return { data: rows };
  }

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_USERS)
  async findAll() {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.email, u.full_name, u.employee_code, u.phone, u.branch_id, u.role_id, u.is_active, u.participate_round_robin, u.last_login_at, u.created_at,
              r.name AS role_name, b.name AS branch_name,
              (SELECT count(*)::int FROM leads l WHERE l.assigned_to = u.id AND l.is_deleted = false) AS assigned_leads,
              -- of those, how many already have their itinerary (sent by WhatsApp, or marked sent by hand)
              (SELECT count(*)::int FROM leads l WHERE l.assigned_to = u.id AND l.is_deleted = false
                 AND (EXISTS (SELECT 1 FROM whatsapp_logs w WHERE w.lead_id = l.id AND w.message_type = 'itinerary' AND w.is_deleted = false AND w.status IN ('accepted','sent','delivered','read'))
                      OR EXISTS (SELECT 1 FROM manual_itinerary_sends m WHERE m.lead_id = l.id))) AS itinerary_sent
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN branches b ON b.id = u.branch_id
       WHERE u.is_deleted = false ORDER BY u.created_at DESC`,
    );
    return { data: rows, total: rows.length };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SETTINGS_USERS)
  async create(@Body() dto: CreateUserDto, @Req() req: any) {
    const digits = dto.phone;
    const phoneDigits = digits.replace(/\D/g, '');
    const email = dto.email || `${phoneDigits}@mobile.errance.local`;
    const { rows: existing } = await this.pool.query(`SELECT id FROM users WHERE lower(email)=lower($1) OR regexp_replace(COALESCE(phone,''),'[^0-9]','','g') IN ($2, '91' || $2)`, [email, phoneDigits]);
    if (existing.length) throw new ConflictException('A user with this email or mobile number already exists');
    // Branch is no longer asked for in the form (single-branch business), but every user still
    // needs one -- all branch-scoped access checks depend on it, and a null branch is denied
    // everywhere. Defaults to the creating admin's own branch, else the first active branch.
    let branchId = dto.branchId ?? req.user?.branchId ?? null;
    if (!branchId) {
      const { rows: b } = await this.pool.query(`SELECT id FROM branches WHERE is_active = true ORDER BY created_at ASC LIMIT 1`);
      branchId = b[0]?.id ?? null;
    }
    if (!branchId) throw new ConflictException('No active branch exists to assign this employee to');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const { rows } = await this.pool.query(
      `INSERT INTO users (email, password_hash, full_name, phone, employee_code, role_id, branch_id, password_enc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, email, full_name, employee_code, phone, branch_id, role_id, is_active, created_at`,
      [email, passwordHash, dto.fullName, digits, dto.employeeCode ?? null, dto.roleId, branchId, sealPassword(dto.password)],
    );
    this.audit.log({ userId: req.user?.userId, branchId: req.user?.branchId, action: 'user.created', resourceType: 'user', resourceId: rows[0]?.id, result: 'success', detail: { email, roleId: dto.roleId, branchId } });
    return rows[0];
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SETTINGS_USERS)
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req: any) {
    // settings:users currently only belongs to super_admin (branch_manager explicitly excludes
    // it, see role-permissions.ts) -- but that's a fact about the CURRENT permission config, not
    // an enforced rule. If that permission is ever handed to a broader role later (e.g. "branch
    // managers can manage their own branch's users"), this prevents that from silently becoming
    // "and they can also grant themselves/anyone super_admin" -- role, branch and active-status
    // changes require being super_admin specifically, independent of what settings:users covers.
    if ((dto.roleId !== undefined || dto.branchId !== undefined || dto.isActive !== undefined) && req.user?.roleName !== 'super_admin') {
      this.audit.log({ userId: req.user?.userId, branchId: req.user?.branchId, action: 'access_denied', resourceType: 'user', resourceId: id, result: 'denied', detail: { reason: 'attempted role/branch/status change without super_admin', attempted: { roleId: dto.roleId, branchId: dto.branchId, isActive: dto.isActive } } });
      throw new ForbiddenException('Only a super admin can change a user\'s role, branch or active status');
    }
    const sets: string[] = [];
    const args: any[] = [];
    for (const [key, col] of [
      ['fullName', 'full_name'], ['phone', 'phone'], ['employeeCode', 'employee_code'],
      ['roleId', 'role_id'], ['branchId', 'branch_id'], ['isActive', 'is_active'], ['participateRoundRobin', 'participate_round_robin'],
    ] as const) {
      const val = (dto as any)[key];
      if (val !== undefined) { args.push(val); sets.push(`${col} = $${args.length}`); }
    }
    if (dto.password) { args.push(await bcrypt.hash(dto.password,10)); sets.push(`password_hash = $${args.length}`); args.push(sealPassword(dto.password)); sets.push(`password_enc = $${args.length}`); }
    if (!sets.length) {
      const { rows } = await this.pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
      return rows[0] || null;
    }
    args.push(id);
    const { rows } = await this.pool.query(
      `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $${args.length} AND is_deleted = false
       RETURNING id, email, full_name, employee_code, phone, branch_id, role_id, is_active, participate_round_robin`,
      args,
    );
    // Role or active-status changes are exactly the kind of event that needs a record of who did
    // it -- logged distinctly from an ordinary profile edit (name/phone) so it's easy to find.
    this.access.invalidate(id);
    if (dto.roleId !== undefined || dto.isActive !== undefined) {
      this.audit.log({ userId: req.user?.userId, branchId: req.user?.branchId, action: dto.isActive === false ? 'user.deactivated' : 'user.role_or_status_changed', resourceType: 'user', resourceId: id, result: 'success', detail: { roleId: dto.roleId, isActive: dto.isActive } });
    }
    return rows[0] || null;
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.SETTINGS_USERS)
  async remove(@Param('id') id: string, @Req() req: any) {
    const { rows } = await this.pool.query(
      `UPDATE users SET is_deleted = true, is_active = false, updated_at = now() WHERE id = $1 RETURNING id`,
      [id],
    );
    this.audit.log({ userId: req.user?.userId, branchId: req.user?.branchId, action: 'user.deleted', resourceType: 'user', resourceId: id, result: 'success' });
    return rows[0] || null;
  }
}
