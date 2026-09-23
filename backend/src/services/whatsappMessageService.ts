import { pool } from '../db.js';
import { broadcastChange } from '../realtime.js';
import * as leadRepo from './leadRepo.js';

export function normalizePhone(phone: string): string {
    return (phone || '').replace(/\D/g, '');
}

/** Logs a lead_activities entry the same way routes/db.ts's generic write-hook does,
 *  so WhatsApp events show up in the lead's Timeline tab alongside everything else. */
async function logLeadActivity(leadId: string, type: string, description: string, metadata?: any) {
    try {
        const { rows } = await pool.query(
            `INSERT INTO lead_activities (lead_id, type, description, metadata) VALUES ($1, $2, $3, $4) RETURNING *`,
            [leadId, type, description, metadata ? JSON.stringify(metadata) : null]
        );
        broadcastChange('lead_activities', 'INSERT', { new: rows[0] });
    } catch (err) {
        console.error('[whatsapp] activity logging failed:', err);
    }
}

export type Conversation = {
    id: string;
    phone: string;
    stage: string;
    selected_package: string | null;
    contact_lead_id: string | null;
    assigned_staff_id: string | null;
    status: 'open' | 'pending' | 'resolved';
    unread_count: number;
    last_message_at: string | null;
    last_message_preview: string | null;
    last_inbound_at: string | null;
    channel: string;
};

export async function getOrCreateConversation(phone: string): Promise<Conversation> {
    const { rows } = await pool.query<Conversation>('SELECT * FROM whatsapp_conversations WHERE phone = $1', [phone]);
    if (rows[0]) return rows[0];

    const { rows: created } = await pool.query<Conversation>(
        `INSERT INTO whatsapp_conversations (phone, stage) VALUES ($1, 'collect_name')
         ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
         RETURNING *`,
        [phone]
    );
    broadcastChange('whatsapp_conversations', 'INSERT', { new: created[0] });
    return created[0];
}

/** Finds an existing CRM contact (lead) for this phone, or creates one — the same
 *  matching rules used everywhere else in the app (normalized-suffix phone match). */
export async function getOrCreateContact(phone: string) {
    const existing = await leadRepo.getLeadByPhone(phone);
    if (existing) return existing;
    return leadRepo.createLead(phone, 'WhatsApp');
}

function truncate(text: string, max = 120) {
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Records an inbound (customer -> CRM) WhatsApp message. Idempotent on `twilioSid`:
 * Twilio retries webhook deliveries, so a duplicate MessageSid is a no-op that still
 * returns the already-stored message rather than erroring or double-processing.
 */
export async function recordInboundMessage(opts: {
    phone: string;
    body: string;
    twilioSid: string;
    messageType?: string;
    mediaUrl?: string;
    mediaContentType?: string;
}) {
    if (opts.twilioSid) {
        const { rows: dupe } = await pool.query('SELECT * FROM whatsapp_messages WHERE twilio_sid = $1', [opts.twilioSid]);
        if (dupe[0]) {
            return { message: dupe[0], conversation: await getOrCreateConversation(opts.phone), lead: await getOrCreateContact(opts.phone), duplicate: true as const };
        }
    }

    const conversation = await getOrCreateConversation(opts.phone);
    const lead = await getOrCreateContact(opts.phone);

    const { rows } = await pool.query(
        `INSERT INTO whatsapp_messages (lead_id, conversation_id, sender, content, status, direction, message_type, media_url, media_content_type, twilio_sid)
         VALUES ($1, $2, 'contact', $3, 'read', 'inbound', $4, $5, $6, $7)
         RETURNING *`,
        [lead.id, conversation.id, opts.body, opts.messageType || 'text', opts.mediaUrl || null, opts.mediaContentType || null, opts.twilioSid || null]
    );
    const message = rows[0];
    broadcastChange('whatsapp_messages', 'INSERT', { new: message });

    const { rows: updatedConv } = await pool.query(
        `UPDATE whatsapp_conversations
         SET contact_lead_id = COALESCE(contact_lead_id, $1),
             unread_count = unread_count + 1,
             last_message_at = NOW(),
             last_inbound_at = NOW(),
             last_message_preview = $2,
             updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [lead.id, truncate(opts.body || '[media]'), conversation.id]
    );
    broadcastChange('whatsapp_conversations', 'UPDATE', { new: updatedConv[0] });

    await logLeadActivity(lead.id, 'whatsapp_inbound', 'WhatsApp message received', { content: truncate(opts.body, 200) });

    return { message, conversation: updatedConv[0], lead, duplicate: false as const };
}

/**
 * Records an outbound (agent/bot -> customer) WhatsApp message alongside the actual
 * Twilio send. `sentBy` is the staff id for agent-authored messages, or null for the
 * automated bot flow.
 */
export async function recordOutboundMessage(opts: {
    phone: string;
    leadId?: string | null;
    body: string;
    twilioSid: string | null;
    twilioStatus?: string;
    sentBy?: string | null;
    messageType?: string;
    mediaUrl?: string;
    contentSid?: string;
}) {
    const conversation = await getOrCreateConversation(opts.phone);
    const lead = opts.leadId ? { id: opts.leadId } : await getOrCreateContact(opts.phone);

    const { rows } = await pool.query(
        `INSERT INTO whatsapp_messages (lead_id, conversation_id, sender, content, status, direction, message_type, media_url, sent_by, twilio_sid)
         VALUES ($1, $2, 'user', $3, $4, 'outbound', $5, $6, $7, $8)
         RETURNING *`,
        [
            lead.id,
            conversation.id,
            opts.body,
            opts.twilioStatus || 'sent',
            opts.contentSid ? 'template' : (opts.messageType || 'text'),
            opts.mediaUrl || null,
            opts.sentBy || null,
            opts.twilioSid,
        ]
    );
    const message = rows[0];
    broadcastChange('whatsapp_messages', 'INSERT', { new: message });

    const { rows: updatedConv } = await pool.query(
        `UPDATE whatsapp_conversations
         SET contact_lead_id = COALESCE(contact_lead_id, $1),
             last_message_at = NOW(),
             last_message_preview = $2,
             status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END,
             updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [lead.id, truncate(opts.body || '[media]'), conversation.id]
    );
    broadcastChange('whatsapp_conversations', 'UPDATE', { new: updatedConv[0] });

    if (opts.sentBy) {
        await logLeadActivity(lead.id, 'whatsapp_outbound', 'WhatsApp message sent', { content: truncate(opts.body, 200) });
    }

    return { message, conversation: updatedConv[0] };
}

/** Applies a Twilio status-callback update to the matching message, by Twilio MessageSid. */
export async function applyStatusCallback(twilioSid: string, status: string, errorCode?: string, errorMessage?: string) {
    const { rows } = await pool.query(
        `UPDATE whatsapp_messages SET status = $1, error_code = $2, error_message = $3
         WHERE twilio_sid = $4
         RETURNING *`,
        [status, errorCode || null, errorMessage || null, twilioSid]
    );
    if (!rows[0]) return null;
    broadcastChange('whatsapp_messages', 'UPDATE', { new: rows[0] });
    return rows[0];
}

/** Whether an agent can still send a free-form session message, per WhatsApp's 24h customer-care window. */
export function isWithinSessionWindow(conversation: Pick<Conversation, 'last_inbound_at'>): boolean {
    if (!conversation.last_inbound_at) return false;
    const windowMs = 24 * 60 * 60 * 1000;
    return Date.now() - new Date(conversation.last_inbound_at).getTime() < windowMs;
}

export async function getConversationByPhone(phone: string): Promise<Conversation | null> {
    const { rows } = await pool.query<Conversation>('SELECT * FROM whatsapp_conversations WHERE phone = $1', [phone]);
    return rows[0] ?? null;
}

export async function markConversationRead(conversationId: string) {
    const { rows } = await pool.query(
        `UPDATE whatsapp_conversations SET unread_count = 0, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [conversationId]
    );
    if (rows[0]) broadcastChange('whatsapp_conversations', 'UPDATE', { new: rows[0] });
    return rows[0] ?? null;
}
