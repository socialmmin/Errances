import { pool } from '../db.js';
import { broadcastChange } from '../realtime.js';
import { getClient } from './twilioService.js';
import { isTwilioConfigured } from '../config.js';

export type TemplateRow = {
    id: string;
    name: string;
    twilio_content_sid: string;
    category: string;
    language: string;
    body_preview: string | null;
    variables: string[];
    is_active: boolean;
    status: 'draft' | 'pending' | 'approved' | 'rejected' | 'paused' | 'disabled';
    rejection_reason: string | null;
    content_type: string;
    header_text: string | null;
    footer_text: string | null;
    buttons: any[];
    sample_values: Record<string, string>;
    synced_at: string | null;
    created_by: string | null;
    created_by_name: string | null;
    created_at: string;
    updated_at: string;
};

/** Maps Twilio's ApprovalRequests status strings onto our CHECK constraint. */
function mapTwilioStatus(status: string | undefined): TemplateRow['status'] {
    switch (status) {
        case 'approved': return 'approved';
        case 'rejected': return 'rejected';
        case 'pending': return 'pending';
        case 'paused': return 'paused';
        case 'disabled': return 'disabled';
        default: return 'draft';
    }
}

function extractBody(types: Record<string, any>): { contentType: string; body: string; buttons: any[] } {
    const contentType = Object.keys(types || {})[0] || 'twilio/text';
    const def = types?.[contentType] || {};
    const buttons = def.actions || [];
    return { contentType, body: def.body || '', buttons };
}

/** Pulls every Content resource (+ its WhatsApp approval status) from Twilio and
 *  upserts it locally by twilio_content_sid — the source of truth for approval
 *  status is always Twilio, never something we fabricate or infer locally. */
export async function syncTemplatesFromTwilio(actorId: string, actorName: string): Promise<{ synced: number }> {
    if (!isTwilioConfigured()) throw new Error('Twilio is not configured on the server');

    const contents = await getClient().content.v2.contentAndApprovals.list({ pageSize: 200 });
    let synced = 0;

    for (const c of contents) {
        const approval = (c.approvalRequests as any) || {};
        const { contentType, body, buttons } = extractBody(c.types as any);
        const status = mapTwilioStatus(approval.status);
        const category = approval.category || 'utility';
        const rejectionReason = approval.rejectionReason || null;
        const variableKeys = Object.keys((c.variables as any) || {});

        await pool.query(
            `INSERT INTO whatsapp_templates (name, twilio_content_sid, category, language, body_preview, variables, is_active, status, rejection_reason, content_type, buttons, sample_values, synced_at, created_by, created_by_name)
             VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, $9, $10, $11, NOW(), $12, $13)
             ON CONFLICT (twilio_content_sid) DO UPDATE SET
                name = EXCLUDED.name,
                category = EXCLUDED.category,
                language = EXCLUDED.language,
                body_preview = EXCLUDED.body_preview,
                variables = EXCLUDED.variables,
                status = EXCLUDED.status,
                rejection_reason = EXCLUDED.rejection_reason,
                content_type = EXCLUDED.content_type,
                buttons = EXCLUDED.buttons,
                synced_at = NOW(),
                updated_at = NOW()`,
            [
                c.friendlyName, c.sid, category, c.language, body,
                JSON.stringify(variableKeys), status, rejectionReason, contentType,
                JSON.stringify(buttons), JSON.stringify(c.variables || {}), actorId, actorName,
            ]
        );
        synced++;
    }

    const { rows } = await pool.query('SELECT * FROM whatsapp_templates ORDER BY created_at DESC');
    broadcastChange('whatsapp_templates', 'UPDATE', { new: { synced_count: synced } });
    return { synced };
}

export type CreateTemplateInput = {
    name: string;
    language: string;
    category: string;
    body: string;
    headerText?: string;
    footerText?: string;
    buttonType?: 'none' | 'quick_reply' | 'call_to_action';
    buttons?: Array<{ type: string; title: string; url?: string; phone?: string }>;
    sampleValues?: Record<string, string>;
    createdBy: string;
    createdByName: string;
};

/** Creates a new Content resource on Twilio (starts as an unsubmitted draft — WhatsApp
 *  approval is a separate explicit step via submitTemplateForApproval). */
export async function createTemplate(input: CreateTemplateInput): Promise<TemplateRow> {
    if (!isTwilioConfigured()) throw new Error('Twilio is not configured on the server');

    const types: Record<string, any> = {};
    if (input.buttonType === 'quick_reply' && input.buttons?.length) {
        types['twilio/quick-reply'] = {
            body: input.body,
            actions: input.buttons.slice(0, 3).map((b) => ({ type: 'QUICK_REPLY', title: b.title })),
        };
    } else if (input.buttonType === 'call_to_action' && input.buttons?.length) {
        types['twilio/call-to-action'] = {
            body: input.body,
            actions: input.buttons.slice(0, 2).map((b) => ({
                type: b.type === 'phone' ? 'PHONE_NUMBER' : 'URL',
                title: b.title,
                ...(b.type === 'phone' ? { phone: b.phone } : { url: b.url }),
            })),
        };
    } else {
        types['twilio/text'] = { body: input.body };
    }

    const content = await getClient().content.v1.contents.create({
        contentCreateRequest: {
            friendlyName: input.name,
            language: input.language,
            variables: input.sampleValues || {},
            types: types as any,
        },
    } as any);

    const variableKeys = Object.keys(input.sampleValues || {});
    const { rows } = await pool.query<TemplateRow>(
        `INSERT INTO whatsapp_templates (name, twilio_content_sid, category, language, body_preview, variables, is_active, status, content_type, header_text, footer_text, buttons, sample_values, synced_at, created_by, created_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE, 'draft', $7, $8, $9, $10, $11, NOW(), $12, $13)
         RETURNING *`,
        [
            input.name, content.sid, input.category, input.language, input.body,
            JSON.stringify(variableKeys), Object.keys(types)[0], input.headerText || null, input.footerText || null,
            JSON.stringify(input.buttons || []), JSON.stringify(input.sampleValues || {}), input.createdBy, input.createdByName,
        ]
    );

    broadcastChange('whatsapp_templates', 'INSERT', { new: rows[0] });
    return rows[0];
}

/** Submits a draft/rejected Content resource for WhatsApp review. Once a template is
 *  'approved' its content is immutable on Twilio's side — resubmitting requires creating
 *  a brand-new Content resource, never overwriting the approved one. */
export async function submitTemplateForApproval(templateId: string, category: string): Promise<TemplateRow> {
    if (!isTwilioConfigured()) throw new Error('Twilio is not configured on the server');

    const { rows: existing } = await pool.query<TemplateRow>('SELECT * FROM whatsapp_templates WHERE id = $1', [templateId]);
    const template = existing[0];
    if (!template) throw new Error('Template not found');
    if (template.status === 'approved') throw new Error('This template is already approved and cannot be resubmitted');

    const approval = await getClient()
        .content.v1.contents.get(template.twilio_content_sid)
        .approvalCreate.create({ contentApprovalRequest: { name: template.name, category } } as any);

    const status = mapTwilioStatus((approval as any).status);
    const { rows } = await pool.query<TemplateRow>(
        `UPDATE whatsapp_templates SET status = $1, category = $2, rejection_reason = $3, updated_at = NOW() WHERE id = $4 RETURNING *`,
        [status, category, (approval as any).rejectionReason || null, templateId]
    );
    broadcastChange('whatsapp_templates', 'UPDATE', { new: rows[0] });
    return rows[0];
}

/** Re-fetches the current approval status for one template from Twilio (for polling
 *  after submission, since review can take from minutes to a day). */
export async function refreshTemplateStatus(templateId: string): Promise<TemplateRow> {
    if (!isTwilioConfigured()) throw new Error('Twilio is not configured on the server');

    const { rows: existing } = await pool.query<TemplateRow>('SELECT * FROM whatsapp_templates WHERE id = $1', [templateId]);
    const template = existing[0];
    if (!template) throw new Error('Template not found');

    const fetched = await getClient().content.v1.contents.get(template.twilio_content_sid).approvalFetch().fetch();
    const wa = (fetched as any).whatsapp || (fetched as any);
    const status = mapTwilioStatus(wa?.status);

    const { rows } = await pool.query<TemplateRow>(
        `UPDATE whatsapp_templates SET status = $1, rejection_reason = $2, synced_at = NOW(), updated_at = NOW() WHERE id = $3 RETURNING *`,
        [status, wa?.rejectionReason || null, templateId]
    );
    broadcastChange('whatsapp_templates', 'UPDATE', { new: rows[0] });
    return rows[0];
}

export async function setTemplateActive(templateId: string, isActive: boolean): Promise<TemplateRow> {
    const { rows } = await pool.query<TemplateRow>(
        `UPDATE whatsapp_templates SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [isActive, templateId]
    );
    if (!rows[0]) throw new Error('Template not found');
    broadcastChange('whatsapp_templates', 'UPDATE', { new: rows[0] });
    return rows[0];
}

/** Deletes the local reference. Only allowed for templates that were never submitted
 *  (draft) or were rejected — an approved template must stay as an audit record even if
 *  deactivated, and should be removed from Twilio directly if truly no longer needed. */
export async function deleteTemplate(templateId: string): Promise<void> {
    const { rows: existing } = await pool.query<TemplateRow>('SELECT * FROM whatsapp_templates WHERE id = $1', [templateId]);
    const template = existing[0];
    if (!template) throw new Error('Template not found');
    if (template.status === 'approved') throw new Error('Approved templates cannot be deleted — deactivate it instead');

    if (isTwilioConfigured() && template.status === 'draft') {
        try { await getClient().content.v1.contents.get(template.twilio_content_sid).remove(); } catch { /* best-effort */ }
    }
    await pool.query('DELETE FROM whatsapp_templates WHERE id = $1', [templateId]);
    broadcastChange('whatsapp_templates', 'DELETE', { old: template });
}
