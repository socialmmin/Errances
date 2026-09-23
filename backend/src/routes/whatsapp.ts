import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/authenticate.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { sendTwilioWhatsAppMessage, listWhatsAppMessages } from '../services/twilioService.js';
import { config, isTwilioConfigured } from '../config.js';
import { getBaileysStatus, sendBaileysMessage } from '../services/baileysService.js';
import { checkAndSendTravelMessagesTwilio } from '../services/twilioTravelJob.js';
import {
    getOrCreateConversation, getConversationByPhone, recordOutboundMessage,
    isWithinSessionWindow, markConversationRead,
} from '../services/whatsappMessageService.js';
import {
    syncTemplatesFromTwilio, createTemplate, submitTemplateForApproval,
    refreshTemplateStatus, setTemplateActive, deleteTemplate,
} from '../services/whatsappTemplateService.js';

const router = Router();

const sendLimiter = rateLimit({ windowMs: 60_000, max: 60, keyFn: (req) => `send:${req.user?.sub || req.ip}` });
const templateSyncLimiter = rateLimit({ windowMs: 60_000, max: 5, keyFn: (req) => `template-sync:${req.user?.sub || req.ip}` });

function canManageWhatsapp(role?: string) {
    return role === 'admin' || role === 'sales_manager';
}

async function logConversationActivity(leadId: string | null, type: string, description: string) {
    if (!leadId) return;
    try {
        await pool.query(
            `INSERT INTO lead_activities (lead_id, type, description) VALUES ($1, $2, $3)`,
            [leadId, type, description]
        );
    } catch (err) {
        console.error('[whatsapp] conversation activity log failed:', err);
    }
}

router.get('/twilio-messages', requireAuth, async (_req, res) => {
    try {
        const messages = await listWhatsAppMessages();
        res.json({ messages, ourNumber: config.twilio.whatsappNumber });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to fetch Twilio messages' });
    }
});

// --- Outgoing message ---
router.post('/send', requireAuth, sendLimiter, async (req, res) => {
    // `content`, when given, overrides what's persisted in whatsapp_messages while `message`
    // is still what's actually sent to Twilio — used for image attachments, where Twilio gets
    // a short placeholder body but the CRM chat stores the full data URL to render inline.
    const { to, message, content, contentSid, contentVariables, leadId } = req.body || {};
    if (!to || (!message && !contentSid)) {
        return res.status(400).json({ error: 'Missing to or message' });
    }

    try {
        const conversation = await getOrCreateConversation(to.replace('whatsapp:', '').trim());

        // WhatsApp only allows free-form session messages within 24h of the customer's last
        // inbound message; outside that window, an approved template is required.
        if (!contentSid && !isWithinSessionWindow(conversation)) {
            return res.status(409).json({
                error: 'This conversation is outside the 24-hour WhatsApp session window. Send an approved template to re-open it.',
                code: 'SESSION_WINDOW_CLOSED',
            });
        }

        const result = await sendTwilioWhatsAppMessage(to, message, { contentSid, contentVariables });
        const { message: stored } = await recordOutboundMessage({
            phone: to.replace('whatsapp:', '').trim(),
            leadId: leadId || conversation.contact_lead_id || null,
            body: content || (contentSid ? (message || `[Template ${contentSid}]`) : message),
            twilioSid: result.sid,
            twilioStatus: result.status,
            sentBy: req.user!.sub,
            contentSid,
        });

        res.json({ success: true, sid: result.sid, message: stored });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to send WhatsApp message' });
    }
});

// --- Session window status (drives the UI's "template required" banner) ---
router.get('/window-status', requireAuth, async (req, res) => {
    const phone = (req.query.phone as string || '').replace('whatsapp:', '').trim();
    if (!phone) return res.status(400).json({ error: 'Missing phone' });
    try {
        const conversation = await getConversationByPhone(phone);
        if (!conversation) return res.json({ withinWindow: false, lastInboundAt: null });
        res.json({ withinWindow: isWithinSessionWindow(conversation), lastInboundAt: conversation.last_inbound_at });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to resolve session window' });
    }
});

// --- Conversation management ---
router.post('/conversations/:id/read', requireAuth, async (req, res) => {
    try {
        const updated = await markConversationRead(req.params.id);
        if (!updated) return res.status(404).json({ error: 'Conversation not found' });
        res.json({ data: updated });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to mark conversation as read' });
    }
});

router.patch('/conversations/:id/assign', requireAuth, async (req, res) => {
    const { staffId, staffName } = req.body || {};
    try {
        const { rows } = await pool.query(
            `UPDATE whatsapp_conversations SET assigned_staff_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [staffId || null, req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Conversation not found' });
        await logConversationActivity(rows[0].contact_lead_id, 'whatsapp_assignment', staffId ? `WhatsApp conversation assigned to ${staffName || 'a staff member'}` : 'WhatsApp conversation unassigned');
        res.json({ data: rows[0] });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to assign conversation' });
    }
});

router.patch('/conversations/:id/status', requireAuth, async (req, res) => {
    const { status } = req.body || {};
    if (!['open', 'pending', 'resolved'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }
    try {
        const { rows } = await pool.query(
            `UPDATE whatsapp_conversations SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [status, req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Conversation not found' });
        await logConversationActivity(rows[0].contact_lead_id, 'whatsapp_status', `WhatsApp conversation marked ${status}`);
        res.json({ data: rows[0] });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to update conversation status' });
    }
});

// --- Template management ---
async function auditTemplateAction(userId: string, action: string, metadata: Record<string, any>) {
    try {
        await pool.query(
            `INSERT INTO user_activity (user_id, event_type, metadata) VALUES ($1, $2, $3)`,
            [userId, `whatsapp_template_${action}`, JSON.stringify(metadata)]
        );
    } catch (err) {
        console.error('[whatsapp] template audit log failed:', err);
    }
}

router.get('/templates', requireAuth, async (_req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM whatsapp_templates ORDER BY created_at DESC');
        res.json({ data: rows });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to load templates' });
    }
});

router.post('/templates/sync', requireAuth, templateSyncLimiter, async (req, res) => {
    if (!canManageWhatsapp(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
    try {
        const result = await syncTemplatesFromTwilio(req.user!.sub, req.user!.email);
        await auditTemplateAction(req.user!.sub, 'sync', { synced: result.synced });
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to sync templates from Twilio' });
    }
});

router.post('/templates', requireAuth, async (req, res) => {
    if (!canManageWhatsapp(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
    const { name, language, category, body, headerText, footerText, buttonType, buttons, sampleValues } = req.body || {};
    if (!name || !language || !category || !body) {
        return res.status(400).json({ error: 'Missing name, language, category, or body' });
    }
    try {
        const template = await createTemplate({
            name, language, category, body, headerText, footerText, buttonType, buttons, sampleValues,
            createdBy: req.user!.sub, createdByName: req.user!.email,
        });
        await auditTemplateAction(req.user!.sub, 'created', { templateId: template.id, name: template.name });
        res.json({ data: template });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to create template' });
    }
});

router.post('/templates/:id/submit', requireAuth, async (req, res) => {
    if (!canManageWhatsapp(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
    const { category } = req.body || {};
    if (!category) return res.status(400).json({ error: 'Missing category' });
    try {
        const template = await submitTemplateForApproval(req.params.id, category);
        await auditTemplateAction(req.user!.sub, 'submitted', { templateId: template.id, category });
        res.json({ data: template });
    } catch (err: any) {
        res.status(400).json({ error: err.message || 'Failed to submit template for approval' });
    }
});

router.post('/templates/:id/refresh-status', requireAuth, async (req, res) => {
    if (!canManageWhatsapp(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
    try {
        const template = await refreshTemplateStatus(req.params.id);
        res.json({ data: template });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to refresh template status' });
    }
});

router.patch('/templates/:id/active', requireAuth, async (req, res) => {
    if (!canManageWhatsapp(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
    const { isActive } = req.body || {};
    try {
        const template = await setTemplateActive(req.params.id, Boolean(isActive));
        await auditTemplateAction(req.user!.sub, isActive ? 'activated' : 'deactivated', { templateId: template.id });
        res.json({ data: template });
    } catch (err: any) {
        res.status(400).json({ error: err.message || 'Failed to update template' });
    }
});

router.delete('/templates/:id', requireAuth, async (req, res) => {
    if (!canManageWhatsapp(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
    try {
        await deleteTemplate(req.params.id);
        await auditTemplateAction(req.user!.sub, 'deleted', { templateId: req.params.id });
        res.json({ success: true });
    } catch (err: any) {
        res.status(400).json({ error: err.message || 'Failed to delete template' });
    }
});

// --- Admin: connection/settings status (never returns secrets) ---
router.get('/settings', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM whatsapp_settings WHERE id = 1');
        const { rows: templateCountRows } = await pool.query(`SELECT COUNT(*)::int AS count FROM whatsapp_templates WHERE is_active = TRUE`);
        res.json({
            connected: isTwilioConfigured(),
            whatsappNumber: config.twilio.whatsappNumber || null,
            webhookConfigured: Boolean(config.publicUrl),
            incomingWebhookUrl: config.publicUrl ? `${config.publicUrl}/api/webhooks/twilio` : null,
            statusWebhookUrl: config.publicUrl ? `${config.publicUrl}/api/webhooks/twilio/status` : null,
            activeTemplateCount: templateCountRows[0]?.count || 0,
            settings: rows[0] || null,
            canManage: canManageWhatsapp(req.user?.role),
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to load WhatsApp settings' });
    }
});

router.patch('/settings', requireAuth, async (req, res) => {
    if (!canManageWhatsapp(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
    const { businessName, defaultTemplateId, sessionWindowHours } = req.body || {};
    try {
        const { rows } = await pool.query(
            `UPDATE whatsapp_settings
             SET business_name = COALESCE($1, business_name),
                 default_template_id = $2,
                 session_window_hours = COALESCE($3, session_window_hours),
                 updated_by = $4, updated_by_name = $5, updated_at = NOW()
             WHERE id = 1 RETURNING *`,
            [businessName ?? null, defaultTemplateId ?? null, sessionWindowHours ?? null, req.user!.sub, req.user!.email]
        );
        await logConversationActivity(null, 'whatsapp_settings', 'WhatsApp settings updated').catch(() => {});
        res.json({ data: rows[0] });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to update WhatsApp settings' });
    }
});

router.post('/birthday-check', requireAuth, async (_req, res) => {
    try {
        const results = await checkAndSendTravelMessagesTwilio();
        res.json({ success: true, results });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Birthday check failed' });
    }
});

router.get('/baileys/status', requireAuth, (_req, res) => {
    res.json(getBaileysStatus());
});

router.post('/baileys/send', requireAuth, async (req, res) => {
    const { to, message } = req.body || {};
    if (!to || !message) return res.status(400).json({ error: 'Missing to or message' });
    try {
        const messageId = await sendBaileysMessage(to, message);
        res.json({ success: true, messageId });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to send message' });
    }
});

export default router;
