import { pool } from '../db.js';
import { broadcastChange } from '../realtime.js';

export type Lead = {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    status: string;
    source: string | null;
    tour_interest: string | null;
    selected_package: string | null;
    selection_timestamp: string | null;
    budget: number | null;
    notes: string | null;
    created_at: string;
};

/** Finds a lead by normalized-phone match, restoring it if soft-deleted. */
export async function getLeadByPhone(phone: string): Promise<Lead | null> {
    const cleanTarget = phone.replace(/\D/g, '');
    const { rows } = await pool.query<Lead>('SELECT * FROM leads');

    const match = rows.find((lead) => {
        if (!lead.phone) return false;
        const cleanLeadPhone = lead.phone.replace(/\D/g, '');
        return cleanLeadPhone === cleanTarget || cleanLeadPhone.endsWith(cleanTarget) || cleanTarget.endsWith(cleanLeadPhone);
    });

    if (!match) return null;

    if (match.notes === '[DELETED]') {
        const { rows: restored } = await pool.query<Lead>(
            'UPDATE leads SET notes = NULL WHERE id = $1 RETURNING *',
            [match.id]
        );
        broadcastChange('leads', 'UPDATE', { new: restored[0] });
        return restored[0];
    }

    return match;
}

export async function createLead(phone: string, source = 'WhatsApp'): Promise<Lead> {
    const cleanNumber = phone.replace(/\D/g, '');
    const { rows } = await pool.query<Lead>(
        `INSERT INTO leads (name, phone, email, source, status)
         VALUES ($1, $2, $3, $4, 'new') RETURNING *`,
        [`WhatsApp Lead (${phone})`, phone, `${cleanNumber}@whatsapp.crm`, source]
    );
    broadcastChange('leads', 'INSERT', { new: rows[0] });
    return rows[0];
}

export async function updateLeadSelection(leadId: string, packageName: string): Promise<Lead> {
    const { rows } = await pool.query<Lead>(
        `UPDATE leads SET status = 'qualified', selected_package = $1, tour_interest = $1, selection_timestamp = NOW()
         WHERE id = $2 RETURNING *`,
        [packageName, leadId]
    );
    broadcastChange('leads', 'UPDATE', { new: rows[0] });
    return rows[0];
}

export async function updateLeadName(leadId: string, name: string): Promise<Lead> {
    const { rows } = await pool.query<Lead>('UPDATE leads SET name = $1 WHERE id = $2 RETURNING *', [name, leadId]);
    broadcastChange('leads', 'UPDATE', { new: rows[0] });
    return rows[0];
}

export async function updateLeadSelectionAndName(leadId: string, name: string, packageName: string): Promise<Lead> {
    const { rows } = await pool.query<Lead>(
        `UPDATE leads SET name = $1, status = 'qualified', selected_package = $2, tour_interest = $2, selection_timestamp = NOW()
         WHERE id = $3 RETURNING *`,
        [name, packageName, leadId]
    );
    broadcastChange('leads', 'UPDATE', { new: rows[0] });
    return rows[0];
}

export async function getActiveTours(): Promise<Array<{ id: string; name: string; price: number | null }>> {
    const { rows } = await pool.query(
        `SELECT id, title AS name, price FROM tours WHERE status = 'active' ORDER BY title ASC`
    );
    return rows;
}

export async function insertWhatsappMessage(leadId: string, sender: 'user' | 'contact', content: string, status = 'sent', createdAt?: string) {
    const { rows } = await pool.query(
        `INSERT INTO whatsapp_messages (lead_id, sender, content, status, created_at)
         VALUES ($1, $2, $3, $4, COALESCE($5, NOW())) RETURNING *`,
        [leadId, sender, content, status, createdAt ?? null]
    );
    broadcastChange('whatsapp_messages', 'INSERT', { new: rows[0] });
    return rows[0];
}
