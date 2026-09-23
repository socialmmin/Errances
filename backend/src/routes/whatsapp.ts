import { getKnowledge, knowledgeSchema, hotlineRules } from '../services/hotlineKnowledge.js';
import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/authenticate.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { sendTwilioWhatsAppMessage, listWhatsAppMessages } from '../services/twilioService.js';
import { config, isTwilioConfigured } from '../config.js';
import { getBaileysStatus, sendBaileysMessage } from '../services/baileysService.js';
import { checkAndSendTravelMessagesTwilio } from '../services/twilioTravelJob.js';
import { automationOverview, setupEnquiryTemplates } from '../services/enquiryAutomation.js';
import { canonicalPhone } from '../services/whatsappPhone.js';
import { broadcastChange } from '../realtime.js';
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
    // Resolve replies from the stored incoming conversation, never a guessed country code.
    const { to, message, contentSid, contentVariables, leadId, conversationId } = req.body || {};
    if (!to || (!message && !contentSid)) {
        return res.status(400).json({ error: 'Missing to or message' });
    }

    try {
        const linked = conversationId
            ? (await pool.query('SELECT * FROM whatsapp_conversations WHERE id=$1', [conversationId])).rows[0]
            : leadId ? (await pool.query('SELECT * FROM whatsapp_conversations WHERE contact_lead_id=$1 ORDER BY last_inbound_at DESC NULLS LAST LIMIT 1', [leadId])).rows[0] : null;
        if (conversationId && !linked) return res.status(404).json({ error: 'Conversation not found' });
        const phone = canonicalPhone(linked?.phone || to);
        const conversation = linked || await getOrCreateConversation(phone);
        if ((conversation as any).opted_out) return res.status(409).json({ error: 'This contact opted out. Wait for them to send START.' });
        let body = String(message || '');
        if (contentSid) {
            const template = (await pool.query("SELECT * FROM whatsapp_templates WHERE twilio_content_sid=$1 AND is_active=TRUE AND status='approved'", [contentSid])).rows[0];
            if (!template) return res.status(400).json({ error: 'Choose an active, approved template from the template library.' });
            const keys = [...String(template.body_preview || '').matchAll(/\{\{(\d+)\}\}/g)].map(m => m[1]);
            if (keys.some(key => typeof contentVariables?.[key] !== 'string' || !contentVariables[key].trim())) return res.status(400).json({ error: 'Complete all template fields before sending.' });
            body = String(template.body_preview || '').replace(/\{\{(\d+)\}\}/g, (_, key) => contentVariables[key]);
        }
        if (body.length > 4096) return res.status(400).json({ error: 'Message must be 4096 characters or fewer.' });

        // WhatsApp only allows free-form session messages within 24h of the customer's last
        // inbound message; outside that window, an approved template is required.
        if (!contentSid && !isWithinSessionWindow(conversation)) {
            return res.status(409).json({
                error: 'This conversation is outside the 24-hour WhatsApp session window. Send an approved template to re-open it.',
                code: 'SESSION_WINDOW_CLOSED',
            });
        }

        const paused = (await pool.query('UPDATE whatsapp_conversations SET bot_paused=TRUE WHERE id=$1 RETURNING *', [conversation.id])).rows[0];
        await pool.query("UPDATE whatsapp_automation_outbox SET status='cancelled' WHERE conversation_id=$1 AND status='queued'", [conversation.id]);
        broadcastChange('whatsapp_conversations', 'UPDATE', { new: paused });
        const result = await sendTwilioWhatsAppMessage(phone, body, { contentSid, contentVariables });
        const { message: stored } = await recordOutboundMessage({
            phone,
            leadId: conversation.contact_lead_id || leadId || null,
            body,
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

router.get('/automation', requireAuth, async (_req, res) => {
    try { res.json(await automationOverview()); } catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.post('/automation/setup', requireAuth, templateSyncLimiter, async (req, res) => {
    if (!canManageWhatsapp(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
    try { res.json({ results: await setupEnquiryTemplates(req.user!.sub, req.user!.email) }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
});
router.patch('/conversations/:id/automation', requireAuth, async (req, res) => {
    if (typeof req.body.paused !== 'boolean') return res.status(400).json({ error: 'paused must be a boolean' });
    try {
        const { rows } = await pool.query('UPDATE whatsapp_conversations SET bot_paused=$2, automation_error=NULL, updated_at=NOW() WHERE id=$1 RETURNING *', [req.params.id, req.body.paused]);
        if (!rows[0]) return res.status(404).json({ error: 'Conversation not found' });
        if (req.body.paused) await pool.query("UPDATE whatsapp_automation_outbox SET status='cancelled' WHERE conversation_id=$1 AND status='queued'", [req.params.id]);
        broadcastChange('whatsapp_conversations', 'UPDATE', { new: rows[0] });
        res.json({ data: rows[0] });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
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

// Structured, database-backed global hotline knowledge.
router.get('/knowledge', requireAuth, async (_req, res) => {
    try { const document = await getKnowledge(); const {rows}=await pool.query("SELECT count(*)::int AS total, count(*) FILTER (WHERE status='active')::int AS active FROM tours"); res.json({document,rules:hotlineRules,catalogue:rows[0]}); }
    catch { res.status(500).json({error:'Unable to load hotline knowledge'}); }
});
router.put('/knowledge', requireAuth, async (req,res) => {
    if (!canManageWhatsapp(req.user?.role)) return res.status(403).json({error:'Forbidden'});
    const parsed=knowledgeSchema.safeParse(req.body);
    if (!parsed.success || new Set(parsed.data?.offices.map(o=>o.id)).size!==5) return res.status(400).json({error:'Check the five offices, local hours, time zones and holiday dates.'});
    try {
      for(const o of parsed.data.offices) if(o.assigned_staff_id) {const {rowCount}=await pool.query("SELECT id FROM staffs WHERE id=$1 AND status='active'",[o.assigned_staff_id]);if(!rowCount)return res.status(400).json({error:'Choose an active staff member for office routing.'});}
      await getKnowledge();
      await pool.query('UPDATE whatsapp_knowledge SET document=$1,updated_by=$2,updated_at=NOW() WHERE id=1',[JSON.stringify(parsed.data),req.user!.sub]);
      res.json({document:parsed.data});
    } catch {res.status(500).json({error:'Unable to save hotline knowledge'});}
});

// --- Admin: connection/settings status (never returns secrets) ---
router.get('/settings', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM whatsapp_settings WHERE id = 1');
        const { rows: templateCountRows } = await pool.query(`SELECT COUNT(*)::int AS count FROM whatsapp_templates WHERE is_active = TRUE AND status='approved'`);
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
    const { businessName, defaultTemplateId, sessionWindowHours, automationEnabled } = req.body || {};
    if (sessionWindowHours !== undefined && sessionWindowHours !== 24) return res.status(400).json({ error: 'WhatsApp fixes the customer service window at 24 hours.' });
    if (automationEnabled !== undefined && typeof automationEnabled !== 'boolean') return res.status(400).json({ error: 'Invalid automation setting' });
    try {
        const { rows } = await pool.query(
            `UPDATE whatsapp_settings
             SET business_name = COALESCE($1, business_name),
                 default_template_id = CASE WHEN $6 THEN $2::uuid ELSE default_template_id END,
                 session_window_hours = 24,
                 automation_enabled = COALESCE($3, automation_enabled),
                 updated_by = $4, updated_by_name = $5, updated_at = NOW()
             WHERE id = 1 RETURNING *`,
            [businessName ?? null, defaultTemplateId ?? null, automationEnabled ?? null, req.user!.sub, req.user!.email, Object.hasOwn(req.body, 'defaultTemplateId')]
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
