import { Router } from 'express';
import { validateTwilioSignature } from '../services/twilioService.js';
import { applyStatusCallback } from '../services/whatsappMessageService.js';
import { captureEnquiry } from '../services/enquiryAutomation.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { config } from '../config.js';
const router = Router();
const webhookLimiter = rateLimit({ windowMs: 60000, max: 120, keyFn: req => 'webhook:' + req.ip });
function fullUrlFor(req: import('express').Request) {
    return config.publicUrl ? config.publicUrl + req.originalUrl : req.protocol + '://' + req.headers.host + req.originalUrl;
}
router.post('/twilio', webhookLimiter, async (req, res) => {
    if (!validateTwilioSignature(req.header('x-twilio-signature'), fullUrlFor(req), req.body)) return res.status(403).send('Forbidden: Twilio signature validation failed');
    const { From, To, Body, MessageSid, MediaUrl0, MediaContentType0 } = req.body;
    if (!From || !MessageSid) return res.status(400).send('Missing From or MessageSid');
    if (String(To || '').replace(/\D/g, '') !== config.twilio.whatsappNumber.replace(/\D/g, '')) return res.status(400).send('Unexpected WhatsApp recipient');
    try {
        await captureEnquiry({ from: From, body: String(Body || '').slice(0, 8000), sid: MessageSid, mediaUrl: MediaUrl0, mediaType: MediaContentType0 });
        return res.type('text/xml').send('<Response/>');
    } catch (err) {
        console.error('[webhook:twilio] failed to persist incoming event', err);
        return res.status(500).send('Please retry webhook');
    }
});

// Twilio's delivery/read status callback — registered per-message via `statusCallback` on
// send (see twilioService.sendTwilioWhatsAppMessage). Updates queued -> sent -> delivered ->
// read (or failed/undelivered with an error code) on the matching stored message.
router.post('/twilio/status', webhookLimiter, async (req, res) => {
    const signature = req.header('x-twilio-signature');
    if (!validateTwilioSignature(signature, fullUrlFor(req), req.body)) {
        return res.status(403).send('Forbidden: Twilio signature validation failed');
    }

    const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body;
    if (!MessageSid || !MessageStatus) return res.status(400).send('Missing MessageSid or MessageStatus');

    try {
        await applyStatusCallback(MessageSid, MessageStatus, ErrorCode, ErrorMessage);
    } catch (err) {
        console.error('[webhook:twilio/status] failed to apply status update:', err);
    }

    return res.status(200).send('<Response></Response>');
});

export default router;
