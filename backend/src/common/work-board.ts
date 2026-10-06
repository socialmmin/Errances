import { Pool } from 'pg';

// The work board: for every employee, each section of the sidebar as counts --
//   to clear (pending / overdue: the number that should reach zero), upcoming, and done in the period.
// "To clear" and "upcoming" are as of this moment; only "done" follows the dates (whole days, India time).
// userId = one employee; null = every active employee except super admins.
// Used by the Performance tab, the team board and the daily WhatsApp work reports, so all three agree.
export async function workBoardRows(pool: Pool, from: string, to: string, userId: string | null): Promise<any[]> {
  const within = (col: string) => `${col} >= ($1::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AND ${col} < ($2::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'`;
  const mine = '(q.created_by = u.id OR l.assigned_to = u.id)';
  const openInvoice = `i.is_deleted = false AND q.is_deleted = false AND i.cancelled_at IS NULL AND i.status::text <> 'paid' AND ${mine}`;
  const invoiceFrom = 'FROM invoices i JOIN quotations q ON q.id = i.quotation_id LEFT JOIN leads l ON l.id = q.lead_id';
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.phone, r.name AS role_name,
            COALESCE((SELECT jsonb_object_agg(s.status, s.n) FROM (SELECT l.status::text AS status, count(*)::int AS n FROM leads l WHERE l.assigned_to = u.id AND l.is_deleted = false GROUP BY 1) s), '{}'::jsonb) AS lead_stages,
            (SELECT count(*)::int FROM callback_requests c JOIN leads l ON l.id = c.lead_id WHERE l.assigned_to = u.id AND l.is_deleted = false AND c.called_at IS NULL) AS callbacks_pending,
            (SELECT count(*)::int FROM callback_requests c WHERE c.called_by = u.id AND ${within('c.called_at')}) AS callbacks_done,
            (SELECT count(*)::int FROM (
               SELECT DISTINCT ON (w.lead_id, w.package_id) w.lead_id, w.package_id, w.status::text AS status
                 FROM whatsapp_logs w JOIN leads l ON l.id = w.lead_id
                WHERE l.assigned_to = u.id AND l.is_deleted = false AND w.is_deleted = false AND w.message_type = 'itinerary' AND w.status::text <> 'test_mode_skipped'
                ORDER BY w.lead_id, w.package_id, w.created_at DESC) x
              WHERE x.status IN ('failed', 'unconfirmed')
                AND NOT EXISTS (SELECT 1 FROM manual_itinerary_sends s WHERE s.lead_id = x.lead_id AND s.package_id = x.package_id)) AS failed_pending,
            (SELECT count(*)::int FROM manual_itinerary_sends s WHERE s.marked_by = u.id AND ${within('s.marked_at')})
              + (SELECT count(*)::int FROM whatsapp_logs w WHERE w.sent_by::text = u.id::text AND w.message_type = 'itinerary' AND w.is_deleted = false AND w.status::text IN ('accepted','sent','delivered','read') AND ${within('COALESCE(w.sent_at, w.created_at)')}) AS failed_done,
            (SELECT count(*)::int FROM leads l LEFT JOIN whatsapp_chat_state cs ON cs.lead_id = l.id
              WHERE l.assigned_to = u.id AND l.is_deleted = false AND COALESCE(cs.status, 'open') <> 'done' AND EXISTS (
                SELECT 1 FROM whatsapp_messages i WHERE i.lead_id = l.id AND i.direction = 'in' AND i.msg_type <> 'reaction' AND i.created_at > now() - interval '30 days'
                   AND (i.msg_type NOT IN ('button','interactive') OR NOT EXISTS (SELECT 1 FROM whatsapp_messages b WHERE b.lead_id = l.id AND b.direction = 'out' AND b.created_at > i.created_at))
                   AND NOT EXISTS (SELECT 1 FROM whatsapp_messages o WHERE o.lead_id = l.id AND o.direction = 'out' AND (o.sent_by IS NOT NULL OR o.meta->>'echo' = 'true') AND o.created_at > i.created_at))) AS inbox_pending,
            (SELECT count(DISTINCT m.lead_id)::int FROM whatsapp_messages m WHERE m.sent_by::text = u.id::text AND m.direction = 'out' AND ${within('m.created_at')}) AS inbox_done,
            (SELECT count(*)::int FROM lead_follow_ups f JOIN leads l ON l.id = f.lead_id WHERE (l.assigned_to = u.id OR f.created_by = u.id) AND l.is_deleted = false AND f.status::text = 'pending' AND f.due_at < now()) AS followups_overdue,
            (SELECT count(*)::int FROM lead_follow_ups f JOIN leads l ON l.id = f.lead_id WHERE (l.assigned_to = u.id OR f.created_by = u.id) AND l.is_deleted = false AND f.status::text = 'pending' AND f.due_at >= now()) AS followups_upcoming,
            (SELECT count(*)::int FROM lead_follow_ups f JOIN leads l ON l.id = f.lead_id WHERE (l.assigned_to = u.id OR f.created_by = u.id) AND l.is_deleted = false AND f.status::text = 'pending' AND f.due_at >= now()
                AND (f.due_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date) AS followups_today,
            (SELECT count(*)::int FROM lead_follow_ups f JOIN leads l ON l.id = f.lead_id WHERE (l.assigned_to = u.id OR f.created_by = u.id) AND l.is_deleted = false AND f.status::text = 'pending'
                AND (f.due_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date + 1) AS followups_tomorrow,
            (SELECT count(*)::int FROM lead_follow_ups f WHERE f.completed_by = u.id AND ${within('f.completed_at')}) AS followups_done,
            (SELECT count(*)::int FROM quotations q LEFT JOIN leads l ON l.id = q.lead_id WHERE q.is_deleted = false AND ${mine} AND q.status::text = 'sent'
                AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.quotation_id = q.id AND i.is_deleted = false)) AS quotations_awaiting,
            (SELECT count(*)::int FROM quotations q LEFT JOIN leads l ON l.id = q.lead_id WHERE q.is_deleted = false AND ${mine} AND q.status::text = 'draft') AS quotations_draft,
            (SELECT count(*)::int FROM quotations q LEFT JOIN leads l ON l.id = q.lead_id WHERE q.is_deleted = false AND ${mine} AND q.status::text IN ('accepted','converted') AND ${within('q.updated_at')}) AS quotations_done,
            (SELECT count(*)::int ${invoiceFrom} WHERE ${openInvoice}) AS invoices_unpaid,
            (SELECT count(*)::int ${invoiceFrom} WHERE i.is_deleted = false AND q.is_deleted = false AND ${mine} AND i.status::text = 'paid'
                AND EXISTS (SELECT 1 FROM payments pm WHERE pm.invoice_id = i.id AND pm.is_deleted = false AND ${within('pm.created_at')})) AS invoices_done,
            (SELECT count(*)::int ${invoiceFrom} WHERE ${openInvoice} AND NOT EXISTS (SELECT 1 FROM invoice_reminders rm WHERE rm.invoice_id = i.id AND rm.status = 'scheduled')) AS reminders_none,
            (SELECT count(*)::int ${invoiceFrom} WHERE ${openInvoice} AND EXISTS (SELECT 1 FROM invoice_reminders rm WHERE rm.invoice_id = i.id AND rm.status = 'scheduled')) AS reminders_scheduled,
            (SELECT count(*)::int FROM invoice_reminders rm JOIN invoices i ON i.id = rm.invoice_id JOIN quotations q ON q.id = i.quotation_id LEFT JOIN leads l ON l.id = q.lead_id
              WHERE rm.status = 'sent' AND ${mine} AND ${within('rm.sent_at')}) AS reminders_done,
            (SELECT count(DISTINCT ch.lead_id)::int FROM lead_changes ch JOIN leads l ON l.id = ch.lead_id WHERE l.assigned_to = u.id AND ch.field = 'status' AND ch.new_value IN ('won','booking_confirmed','advance_paid') AND ${within('ch.created_at')}) AS leads_converted,
            (SELECT count(DISTINCT ch.lead_id)::int FROM lead_changes ch JOIN leads l ON l.id = ch.lead_id WHERE l.assigned_to = u.id AND ch.field = 'status' AND ch.old_value = 'new' AND ${within('ch.created_at')}) AS leads_first_contact,
            (SELECT count(DISTINCT ch.lead_id)::int FROM lead_changes ch JOIN leads l ON l.id = ch.lead_id WHERE l.assigned_to = u.id AND ch.field = 'status' AND ch.new_value IN ('not_interested','lost','invalid_number') AND ${within('ch.created_at')}) AS leads_closed_lost
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.is_deleted = false AND (($3::uuid IS NOT NULL AND u.id = $3::uuid) OR ($3::uuid IS NULL AND u.is_active = true AND r.name <> 'super_admin'))
      ORDER BY u.full_name`, [from, to, userId]);
  return rows;
}

const n = (v: any) => Number(v) || 0;
const CLOSED = ['won', 'booking_confirmed', 'advance_paid', 'not_interested', 'lost', 'invalid_number', 'wrong_number', 'duplicate'];

// The same eight sections the work board shows, as plain numbers for one employee row.
export function boardSections(u: any) {
  const stages: Record<string, number> = u.lead_stages || {};
  const total = Object.values(stages).reduce((a, b) => a + n(b), 0);
  const fresh = n(stages.new);
  const closed = Object.entries(stages).reduce((a, [k, v]) => a + (CLOSED.includes(k) ? n(v) : 0), 0);
  const sections = {
    leads: { pending: fresh, upcoming: total - fresh - closed, done: n(u.leads_first_contact), tomorrow: 0 },
    followups: { pending: n(u.followups_overdue), upcoming: n(u.followups_upcoming), done: n(u.followups_done), tomorrow: n(u.followups_tomorrow) },
    callbacks: { pending: n(u.callbacks_pending), upcoming: 0, done: n(u.callbacks_done), tomorrow: 0 },
    failed: { pending: n(u.failed_pending), upcoming: 0, done: n(u.failed_done), tomorrow: 0 },
    inbox: { pending: n(u.inbox_pending), upcoming: 0, done: n(u.inbox_done), tomorrow: 0 },
    quotations: { pending: n(u.quotations_awaiting), upcoming: n(u.quotations_draft), done: n(u.quotations_done), tomorrow: 0 },
    invoices: { pending: n(u.invoices_unpaid), upcoming: 0, done: n(u.invoices_done), tomorrow: 0 },
    reminders: { pending: n(u.reminders_none), upcoming: n(u.reminders_scheduled), done: n(u.reminders_done), tomorrow: 0 },
  };
  const all = Object.values(sections);
  return {
    sections, totalLeads: total, converted: n(u.leads_converted), lost: n(u.leads_closed_lost),
    pending: all.reduce((a, x) => a + x.pending, 0), upcoming: all.reduce((a, x) => a + x.upcoming, 0), done: all.reduce((a, x) => a + x.done, 0),
  };
}
