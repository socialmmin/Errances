import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/authenticate.js';
import { broadcastChange } from '../realtime.js';
import type { Request, Response } from 'express';

const router = Router();

type TableConfig = {
    columns: string[];
    // Per-operation access control. Return true to allow.
    canRead: (req: Request) => boolean;
    canWrite: (req: Request) => boolean;
    canDelete: (req: Request) => boolean;
};

const authed = (req: Request) => Boolean(req.user);
const isAdmin = (req: Request) => req.user?.role === 'admin';
const canManageWhatsapp = (req: Request) => req.user?.role === 'admin' || req.user?.role === 'sales_manager';

const TABLES: Record<string, TableConfig> = {
    leads: {
        columns: [
            'id', 'lead_number', 'name', 'email', 'phone', 'whatsapp_number', 'status', 'source', 'campaign',
            'tour_interest', 'requirement', 'selected_package', 'selection_timestamp', 'budget', 'expected_closing_date',
            'travel_date', 'assigned_staff_id', 'lead_owner_id', 'priority', 'dob', 'gender', 'passport_number', 'photo_url',
            'address', 'city', 'state', 'country', 'pincode', 'next_action', 'last_contacted_at',
            'follow_up_date', 'follow_up_time', 'follow_up_type', 'follow_up_notes', 'notes', 'created_at',
        ],
        canRead: authed,
        canWrite: authed,
        canDelete: authed,
    },
    tours: {
        columns: ['id', 'title', 'destination', 'price', 'duration', 'description', 'itinerary', 'inclusions', 'exclusions', 'images', 'status', 'created_at'],
        canRead: authed,
        canWrite: authed,
        canDelete: authed,
    },
    staffs: {
        columns: ['id', 'email', 'access_key', 'full_name', 'role', 'avatar_url', 'department', 'phone', 'status', 'password_hash', 'created_at'],
        canRead: authed,
        canWrite: isAdmin,
        canDelete: isAdmin,
    },
    profiles: {
        columns: ['id', 'full_name', 'email', 'role'],
        canRead: authed,
        canWrite: authed,
        canDelete: isAdmin,
    },
    whatsapp_messages: {
        columns: [
            'id', 'lead_id', 'conversation_id', 'sender', 'content', 'status', 'direction', 'message_type',
            'media_url', 'media_content_type', 'error_code', 'error_message', 'sent_by', 'twilio_sid', 'created_at',
        ],
        canRead: authed,
        canWrite: authed,
        canDelete: authed,
    },
    whatsapp_conversations: {
        columns: [
            'id', 'phone', 'stage', 'selected_package', 'contact_lead_id', 'assigned_staff_id', 'status',
            'unread_count', 'last_message_at', 'last_message_preview', 'last_inbound_at', 'channel',
            'created_at', 'updated_at',
        ],
        canRead: authed,
        canWrite: authed,
        canDelete: authed,
    },
    whatsapp_templates: {
        columns: [
            'id', 'name', 'twilio_content_sid', 'category', 'language', 'body_preview', 'variables', 'is_active',
            'status', 'rejection_reason', 'content_type', 'header_text', 'footer_text', 'buttons', 'sample_values',
            'synced_at', 'created_by', 'created_by_name', 'created_at', 'updated_at',
        ],
        // Read-only here — creation/submission/sync must go through /api/whatsapp/templates so the
        // local row always stays consistent with the actual Twilio Content resource it references.
        canRead: authed,
        canWrite: () => false,
        canDelete: () => false,
    },
    user_activity: {
        columns: ['id', 'user_id', 'event_type', 'page_path', 'metadata', 'created_at'],
        canRead: authed,
        canWrite: () => true,
        canDelete: isAdmin,
    },
    lead_statuses: {
        columns: ['id', 'key', 'label', 'color', 'sort_order', 'is_closed_won', 'is_closed_lost', 'created_at'],
        canRead: authed,
        canWrite: isAdmin,
        canDelete: isAdmin,
    },
    lead_activities: {
        columns: ['id', 'lead_id', 'type', 'description', 'actor_id', 'actor_name', 'metadata', 'created_at'],
        canRead: authed,
        canWrite: authed,
        canDelete: isAdmin,
    },
    lead_status_history: {
        columns: ['id', 'lead_id', 'previous_status', 'new_status', 'changed_by', 'changed_by_name', 'reason', 'created_at'],
        canRead: authed,
        canWrite: authed,
        canDelete: isAdmin,
    },
    lead_followups: {
        columns: ['id', 'lead_id', 'due_date', 'due_time', 'type', 'notes', 'assigned_staff_id', 'priority', 'status', 'created_by', 'created_by_name', 'completed_at', 'created_at'],
        canRead: authed,
        canWrite: authed,
        canDelete: authed,
    },
    lead_documents: {
        columns: ['id', 'lead_id', 'name', 'doc_type', 'file_url', 'uploaded_by', 'uploaded_by_name', 'created_at'],
        canRead: authed,
        canWrite: authed,
        canDelete: authed,
    },
    lead_payments: {
        columns: ['id', 'lead_id', 'amount', 'method', 'note', 'recorded_by', 'recorded_by_name', 'created_at'],
        canRead: authed,
        canWrite: authed,
        canDelete: authed,
    },
};

function getTable(req: Request, res: Response): TableConfig | null {
    const table = TABLES[req.params.table];
    if (!table) {
        res.status(404).json({ error: `Unknown table: ${req.params.table}` });
        return null;
    }
    return table;
}

function parseSelect(raw: string | undefined, allowed: string[]): string[] {
    if (!raw || raw === '*') return allowed;
    const requested = raw.split(',').map((c) => c.trim()).filter(Boolean);
    const valid = requested.filter((c) => allowed.includes(c));
    return valid.length > 0 ? valid : allowed;
}

function parseFilters(query: Record<string, any>, allowed: string[]) {
    const eq: Array<{ col: string; val: string }> = [];
    const inList: Array<{ col: string; vals: string[] }> = [];
    for (const key of Object.keys(query)) {
        if (key.startsWith('eq_')) {
            const col = key.slice(3);
            if (allowed.includes(col)) eq.push({ col, val: String(query[key]) });
        } else if (key.startsWith('in_')) {
            const col = key.slice(3);
            if (allowed.includes(col)) inList.push({ col, vals: String(query[key]).split(',').filter(Boolean) });
        }
    }
    return { eq, inList };
}

function buildWhere(eq: Array<{ col: string; val: string }>, inList: Array<{ col: string; vals: string[] }>, startIndex = 1) {
    const clauses: string[] = [];
    const params: any[] = [];
    let idx = startIndex;
    for (const f of eq) {
        clauses.push(`"${f.col}" = $${idx++}`);
        params.push(f.val);
    }
    for (const f of inList) {
        clauses.push(`"${f.col}" = ANY($${idx++})`);
        params.push(f.vals);
    }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function sendPgError(res: Response, err: any) {
    console.error('[db]', err);
    const code = err?.code;
    const status = code === '23503' || code === '23505' ? 409 : 500;
    res.status(status).json({ error: { code, message: err?.detail || err?.message || 'Database error' } });
}

async function getActorName(req: Request): Promise<string> {
    if (!req.user) return 'System';
    try {
        const { rows } = await pool.query('SELECT full_name FROM staffs WHERE id = $1', [req.user.sub]);
        return rows[0]?.full_name || req.user.email;
    } catch {
        return req.user.email;
    }
}

async function logActivity(leadId: string, type: string, description: string, req: Request, metadata?: any) {
    const actorName = await getActorName(req);
    const { rows } = await pool.query(
        `INSERT INTO lead_activities (lead_id, type, description, actor_id, actor_name, metadata)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [leadId, type, description, req.user?.sub ?? null, actorName, metadata ? JSON.stringify(metadata) : null]
    );
    broadcastChange('lead_activities', 'INSERT', { new: rows[0] });
}

async function getStaffName(id: string | null | undefined): Promise<string | null> {
    if (!id) return null;
    const { rows } = await pool.query('SELECT full_name FROM staffs WHERE id = $1', [id]);
    return rows[0]?.full_name ?? null;
}

/** Auto-logs activity/status-history side effects for a lead insert or update. Best-effort: failures here never fail the parent request. */
async function afterLeadWrite(req: Request, eventType: 'INSERT' | 'UPDATE', newRow: any, oldRow: any | null) {
    try {
        if (eventType === 'INSERT') {
            await logActivity(newRow.id, 'created', `Lead created${newRow.source ? ` from ${newRow.source}` : ''}`, req);
            return;
        }
        if (!oldRow) return;

        if (oldRow.status !== newRow.status) {
            const actorName = await getActorName(req);
            await pool.query(
                `INSERT INTO lead_status_history (lead_id, previous_status, new_status, changed_by, changed_by_name)
                 VALUES ($1, $2, $3, $4, $5)`,
                [newRow.id, oldRow.status, newRow.status, req.user?.sub ?? null, actorName]
            );
            await logActivity(newRow.id, 'status_change', `Status changed from ${oldRow.status || 'none'} to ${newRow.status}`, req, {
                previous_status: oldRow.status,
                new_status: newRow.status,
            });
        }

        if (oldRow.assigned_staff_id !== newRow.assigned_staff_id) {
            const staffName = await getStaffName(newRow.assigned_staff_id);
            await logActivity(
                newRow.id,
                'assignment',
                newRow.assigned_staff_id ? `Assigned to ${staffName || 'staff member'}` : 'Unassigned',
                req
            );
        }

        if (oldRow.priority !== newRow.priority) {
            await logActivity(newRow.id, 'priority_change', `Priority changed to ${newRow.priority}`, req);
        }
    } catch (err) {
        console.error('[db] activity logging failed:', err);
    }
}

// --- SELECT ---
router.get('/:table', requireAuth, async (req, res) => {
    const table = getTable(req, res);
    if (!table) return;
    if (!table.canRead(req)) return res.status(403).json({ error: 'Forbidden' });

    try {
        const cols = parseSelect(req.query.select as string, table.columns);
        const { eq, inList } = parseFilters(req.query as any, table.columns);
        const { where, params } = buildWhere(eq, inList);

        let orderClause = '';
        if (req.query.order) {
            const [col, dir] = String(req.query.order).split('.');
            if (table.columns.includes(col)) {
                orderClause = ` ORDER BY "${col}" ${dir === 'desc' ? 'DESC' : 'ASC'}`;
            }
        }

        let limitClause = '';
        if (req.query.limit) {
            params.push(Number(req.query.limit));
            limitClause = ` LIMIT $${params.length}`;
        }

        const sql = `SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${req.params.table}" ${where}${orderClause}${limitClause}`;
        const result = await pool.query(sql, params);

        if (req.query.single === '1' || req.query.maybeSingle === '1') {
            return res.json({ data: result.rows[0] ?? null });
        }
        res.json({ data: result.rows });
    } catch (err) {
        sendPgError(res, err);
    }
});

// --- INSERT ---
router.post('/:table', requireAuth, async (req, res) => {
    const table = getTable(req, res);
    if (!table) return;
    if (!table.canWrite(req)) return res.status(403).json({ error: 'Forbidden' });

    try {
        const rows: any[] = Array.isArray(req.body.rows) ? req.body.rows : [req.body.rows];
        const inserted: any[] = [];
        for (const row of rows) {
            const cols = Object.keys(row).filter((c) => table.columns.includes(c));
            if (cols.length === 0) continue;
            const values = cols.map((c) => row[c]);
            const placeholders = cols.map((_, i) => `$${i + 1}`);
            const sql = `INSERT INTO "${req.params.table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
            const result = await pool.query(sql, values);
            inserted.push(result.rows[0]);
            broadcastChange(req.params.table, 'INSERT', { new: result.rows[0] });

            if (req.params.table === 'leads') {
                await afterLeadWrite(req, 'INSERT', result.rows[0], null);
            } else if (req.params.table === 'whatsapp_messages' && result.rows[0].lead_id) {
                const msg = result.rows[0];
                const label = msg.sender === 'user' ? 'WhatsApp message sent' : 'WhatsApp message received';
                await logActivity(msg.lead_id, 'whatsapp', label, req, { content: String(msg.content).slice(0, 120) });
            }
        }

        if (req.query.single === '1') {
            return res.json({ data: inserted[0] ?? null });
        }
        res.json({ data: inserted });
    } catch (err) {
        sendPgError(res, err);
    }
});

// --- UPDATE ---
router.patch('/:table', requireAuth, async (req, res) => {
    const table = getTable(req, res);
    if (!table) return;
    if (!table.canWrite(req)) return res.status(403).json({ error: 'Forbidden' });

    try {
        const values = req.body.values || {};
        const cols = Object.keys(values).filter((c) => table.columns.includes(c));
        if (cols.length === 0) return res.status(400).json({ error: 'No valid columns to update' });

        const { eq, inList } = parseFilters(req.query as any, table.columns);
        if (eq.length === 0 && inList.length === 0) {
            return res.status(400).json({ error: 'Refusing to update without a filter' });
        }

        let oldRowsById: Record<string, any> = {};
        if (req.params.table === 'leads') {
            const { where: selWhere, params: selParams } = buildWhere(eq, inList);
            const { rows: oldRows } = await pool.query(`SELECT * FROM leads ${selWhere}`, selParams);
            oldRowsById = Object.fromEntries(oldRows.map((r) => [r.id, r]));
        }

        const setClause = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
        const setParams = cols.map((c) => values[c]);
        const { where, params: whereParams } = buildWhere(eq, inList, cols.length + 1);

        const sql = `UPDATE "${req.params.table}" SET ${setClause} ${where} RETURNING *`;
        const result = await pool.query(sql, [...setParams, ...whereParams]);

        for (const row of result.rows) {
            broadcastChange(req.params.table, 'UPDATE', { new: row });
            if (req.params.table === 'leads') {
                await afterLeadWrite(req, 'UPDATE', row, oldRowsById[row.id] ?? null);
            }
        }

        if (req.query.single === '1' || req.query.maybeSingle === '1') {
            return res.json({ data: result.rows[0] ?? null });
        }
        res.json({ data: result.rows });
    } catch (err) {
        sendPgError(res, err);
    }
});

// --- UPSERT ---
router.put('/:table', requireAuth, async (req, res) => {
    const table = getTable(req, res);
    if (!table) return;
    if (!table.canWrite(req)) return res.status(403).json({ error: 'Forbidden' });

    try {
        const rows: any[] = Array.isArray(req.body.rows) ? req.body.rows : [req.body.rows];
        const onConflict = (req.body.onConflict as string) || 'id';
        const upserted: any[] = [];

        for (const row of rows) {
            const cols = Object.keys(row).filter((c) => table.columns.includes(c));
            if (cols.length === 0) continue;
            const values = cols.map((c) => row[c]);
            const placeholders = cols.map((_, i) => `$${i + 1}`);
            const updateSet = cols.filter((c) => c !== onConflict).map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
            const sql = `INSERT INTO "${req.params.table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders.join(', ')})
                         ON CONFLICT ("${onConflict}") DO ${updateSet ? `UPDATE SET ${updateSet}` : 'NOTHING'}
                         RETURNING *`;
            const result = await pool.query(sql, values);
            if (result.rows[0]) upserted.push(result.rows[0]);
        }
        res.json({ data: upserted });
    } catch (err) {
        sendPgError(res, err);
    }
});

// --- DELETE ---
router.delete('/:table', requireAuth, async (req, res) => {
    const table = getTable(req, res);
    if (!table) return;
    if (!table.canDelete(req)) return res.status(403).json({ error: 'Forbidden' });

    try {
        const { eq, inList } = parseFilters(req.query as any, table.columns);
        if (eq.length === 0 && inList.length === 0) {
            return res.status(400).json({ error: 'Refusing to delete without a filter' });
        }
        const { where, params } = buildWhere(eq, inList);
        const sql = `DELETE FROM "${req.params.table}" ${where} RETURNING *`;
        const result = await pool.query(sql, params);

        for (const row of result.rows) {
            broadcastChange(req.params.table, 'DELETE', { old: row });
        }
        res.json({ data: result.rows });
    } catch (err) {
        sendPgError(res, err);
    }
});

export default router;
