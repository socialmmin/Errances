import { Router } from 'express';
import { requireAuth } from '../middleware/authenticate.js';
import { sendTwilioWhatsAppMessage, listWhatsAppMessages } from '../services/twilioService.js';
import { config } from '../config.js';
import { getBaileysStatus, sendBaileysMessage } from '../services/baileysService.js';
import { checkAndSendTravelMessagesTwilio } from '../services/twilioTravelJob.js';

const router = Router();

router.get('/twilio-messages', requireAuth, async (_req, res) => {
    try {
        const messages = await listWhatsAppMessages();
        res.json({ messages, ourNumber: config.twilio.whatsappNumber });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to fetch Twilio messages' });
    }
});

router.post('/send', requireAuth, async (req, res) => {
    const { to, message, contentSid, contentVariables } = req.body || {};
    if (!to || (!message && !contentSid)) {
        return res.status(400).json({ error: 'Missing to or message' });
    }
    try {
        const sid = await sendTwilioWhatsAppMessage(to, message, contentSid, contentVariables);
        res.json({ success: true, sid });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to send WhatsApp message' });
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
