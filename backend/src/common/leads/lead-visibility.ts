import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';

// One rule for "can this person see this lead?" -- the same rule the Leads list already uses
// (leads.repository accessSql): super_admin sees everything; everyone else only leads assigned to
// them or shared with them as a collaborator. Follow-ups, callback requests, quotations and the
// WhatsApp inbox all hang off a lead, so they all use this, instead of each module inventing its
// own (or, as before, none at all -- any salesperson could read every other salesperson's work).
export function seesAllLeads(user: { roleName?: string } | undefined) {
  return user?.roleName === 'super_admin';
}

// SQL condition: the lead whose id is `leadIdExpr` is visible to the user id in `userParam`
// (a placeholder like "$3"). Use only when seesAllLeads() is false.
export function leadVisibleSql(leadIdExpr: string, userParam: string) {
  return `EXISTS (SELECT 1 FROM leads lv WHERE lv.id = ${leadIdExpr} AND (lv.assigned_to = ${userParam}
    OR EXISTS (SELECT 1 FROM lead_collaborators lvc WHERE lvc.lead_id = lv.id AND lvc.user_id = ${userParam})))`;
}

export async function assertLeadVisible(pool: Pool, leadId: string | null | undefined, user: { userId?: string; roleName?: string } | undefined) {
  if (seesAllLeads(user)) return;
  if (!leadId || !user?.userId) throw new ForbiddenException("You don't have access to this lead");
  const { rows } = await pool.query(`SELECT ${leadVisibleSql('$1', '$2')} AS ok, EXISTS (SELECT 1 FROM leads WHERE id = $1 AND is_deleted = false) AS found`, [leadId, user.userId]);
  if (!rows[0]?.found) throw new NotFoundException('Lead not found');
  if (!rows[0]?.ok) throw new ForbiddenException("You don't have access to this lead");
}
