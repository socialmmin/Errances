import { Router } from 'express';
import { pool } from '../db.js';
import * as leadRepo from '../services/leadRepo.js';
import * as convRepo from '../services/conversationRepo.js';
import { sendTwilioWhatsAppMessage, validateTwilioSignature } from '../services/twilioService.js';
import { recordInboundMessage, recordOutboundMessage, applyStatusCallback } from '../services/whatsappMessageService.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();

// Twilio can legitimately retry a webhook many times in quick succession when it doesn't
// get a fast 200 back; this is generous enough for that while still bounding abuse from a
// spoofed/forged source (signature validation below is the real gate).
const webhookLimiter = rateLimit({ windowMs: 60_000, max: 120, keyFn: (req) => `webhook:${req.ip}` });

const GREETINGS = ['hi', 'hii', 'hiii', 'hello', 'hey', 'heyy', 'hola', 'start', 'menu', 'restart', 'good morning', 'good afternoon', 'good evening', 'yo', 'hi there', 'hello there', 'greeting', 'greetings'];

function parseNameAndPackage(rawBody: string, activePackages: Array<{ name: string }>) {
    let parsedName = rawBody;
    let selectedIndex = -1;
    const numbers = rawBody.match(/\d+/g);
    if (numbers) {
        for (const numStr of numbers) {
            const val = parseInt(numStr, 10);
            if (val >= 1 && val <= activePackages.length) {
                selectedIndex = val - 1;
                const numRegex = new RegExp(`\\s*[-–—,\\.]*\\s*${numStr}\\s*|\\s*${numStr}\\s*[-–—,\\.]*\\s*`);
                parsedName = rawBody.replace(numRegex, ' ').replace(/\s+/g, ' ').trim();
                break;
            }
        }
    }
    return { parsedName, selectedIndex };
}

function fullUrlFor(req: import('express').Request): string {
    const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;
    return `${protocol}://${host}${req.originalUrl}`;
}

router.post('/twilio', webhookLimiter, async (req, res) => {
    const signature = req.header('x-twilio-signature');
    if (!validateTwilioSignature(signature, fullUrlFor(req), req.body)) {
        return res.status(403).send('Forbidden: Twilio signature validation failed');
    }

    const { From, Body, MessageSid, NumMedia, MediaUrl0, MediaContentType0 } = req.body;
    if (!From || (!Body && !MessageSid)) return res.status(400).send('Missing From or Body');

    const cleanPhone = From.toString().replace('whatsapp:', '').trim();
    const rawBody = (Body || '').toString().trim();

    // Idempotency: Twilio retries webhook deliveries on slow/ambiguous responses. If we've
    // already stored this exact inbound message, acknowledge without reprocessing the bot
    // flow again (which would otherwise send a duplicate reply).
    if (MessageSid) {
        const { rows: dupe } = await pool.query('SELECT id FROM whatsapp_messages WHERE twilio_sid = $1', [MessageSid]);
        if (dupe.length > 0) {
            return res.status(200).send('<Response></Response>');
        }
    }

    const hasMedia = Number(NumMedia) > 0 && MediaUrl0;
    let currentLeadId: string | null = null;

    // Log the inbound message (conversation bookkeeping, unread count, contact matching,
    // realtime broadcast, activity timeline) before running the automated reply flow below.
    try {
        const { lead } = await recordInboundMessage({
            phone: cleanPhone,
            body: rawBody || (hasMedia ? '📷 Media message' : ''),
            twilioSid: MessageSid || `no-sid-${Date.now()}`,
            messageType: hasMedia ? (MediaContentType0?.startsWith('image') ? 'image' : MediaContentType0?.startsWith('video') ? 'video' : MediaContentType0?.startsWith('audio') ? 'audio' : 'document') : 'text',
            mediaUrl: hasMedia ? MediaUrl0 : undefined,
            mediaContentType: hasMedia ? MediaContentType0 : undefined,
        });
        currentLeadId = lead.id;
    } catch (err) {
        console.error('[webhook:twilio] failed to record inbound message:', err);
    }

    // Sends a reply via Twilio and logs it as an outbound (bot-authored) message.
    const respond = async (text: string) => {
        const result = await sendTwilioWhatsAppMessage(cleanPhone, text);
        await recordOutboundMessage({
            phone: cleanPhone,
            leadId: currentLeadId,
            body: text,
            twilioSid: result.sid,
            twilioStatus: result.status,
        }).catch((err) => console.error('[webhook:twilio] failed to record bot reply:', err));
    };

    if (!rawBody) {
        // Media-only message with no text — logged above; nothing for the scripted bot to parse.
        return res.status(200).send('<Response></Response>');
    }

    try {
        let conversation = await convRepo.getConversationByPhone(cleanPhone);
        const activePackages = await leadRepo.getActiveTours();

        if (activePackages.length === 0) {
            await respond('Thank you for contacting us. We currently do not have any active packages available. A travel consultant will contact you shortly.');
            return res.status(200).send('<Response></Response>');
        }

        const isResetRequest = ['menu', 'restart', 'start'].includes(rawBody.toLowerCase());

        if (!conversation || isResetRequest) {
            conversation = isResetRequest && conversation
                ? await convRepo.updateConversation(cleanPhone, 'collect_name', null)
                : (conversation || await convRepo.createConversation(cleanPhone));

            const listStr = activePackages.map((p, idx) => `${idx + 1}. ${p.name}`).join('\n');
            const welcomeText = `Thank you for contacting Errances Voyages. 🌟\n\nCould you please reply with your *Full Name* and select the *Tour Package Number* you are interested in from the list below:\n\n*Active Tour Packages:*\n${listStr}\n\nExample reply: John Doe - 2`;
            await respond(welcomeText);
            return res.status(200).send('<Response></Response>');
        }

        if (conversation.stage === 'collect_name') {
            let lead = await leadRepo.getLeadByPhone(cleanPhone);
            if (!lead) lead = await leadRepo.createLead(cleanPhone);
            currentLeadId = lead.id;

            if (conversation.selected_package) {
                const userName = rawBody;
                await leadRepo.updateLeadSelectionAndName(lead.id, userName, conversation.selected_package);
                await convRepo.updateConversation(cleanPhone, 'completed', conversation.selected_package);
                await respond(`Thank you, ${userName}!\n\nWe have received your interest for ${conversation.selected_package}.\n\nOur travel consultant will contact you shortly.`);
                return res.status(200).send('<Response></Response>');
            }

            const { parsedName, selectedIndex } = parseNameAndPackage(rawBody, activePackages);
            const hasValidPackage = selectedIndex >= 0 && selectedIndex < activePackages.length;
            const isGreeting = GREETINGS.includes(parsedName.toLowerCase().trim());
            const hasValidName = parsedName.length >= 2 && !isGreeting;

            if (hasValidName && hasValidPackage) {
                const pkg = activePackages[selectedIndex];
                await leadRepo.updateLeadSelectionAndName(lead.id, parsedName, pkg.name);
                await convRepo.updateConversation(cleanPhone, 'completed', pkg.name);
                await respond(`Thank you, ${parsedName}!\n\nWe have received your interest for ${pkg.name}.\n\nOur travel consultant will contact you shortly.`);
            } else if (hasValidName) {
                await leadRepo.updateLeadName(lead.id, parsedName);
                await convRepo.updateConversation(cleanPhone, 'package_selection', null);
                const listStr = activePackages.map((p, idx) => `${idx + 1}. ${p.name}`).join('\n');
                const greetingName = parsedName && !parsedName.startsWith('WhatsApp (') ? `, ${parsedName}` : '';
                await respond(`Thank you${greetingName}!\n\nPlease select one of our tour packages:\n\n${listStr}\n\nReply with the package number.`);
            } else if (hasValidPackage) {
                const pkg = activePackages[selectedIndex];
                await convRepo.updateConversation(cleanPhone, 'collect_name', pkg.name);
                await respond(`Thank you!\n\nPlease reply with your *Full Name* to complete your request for ${pkg.name}.`);
            } else {
                const listStr = activePackages.map((p, idx) => `${idx + 1}. ${p.name}`).join('\n');
                await respond(`We couldn't quite understand your message.\n\nPlease reply with your *Full Name* and the *Tour Package Number* you are interested in:\n\n*Active Tour Packages:*\n${listStr}\n\nExample reply: John Doe - 2`);
            }
            return res.status(200).send('<Response></Response>');
        }

        if (conversation.stage === 'package_selection') {
            let lead = await leadRepo.getLeadByPhone(cleanPhone);
            if (!lead) lead = await leadRepo.createLead(cleanPhone);
            currentLeadId = lead.id;

            const selectedIndex = parseInt(rawBody, 10) - 1;
            if (Number.isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= activePackages.length) {
                const listStr = activePackages.map((p, idx) => `${idx + 1}. ${p.name}`).join('\n');
                await respond(`Invalid selection. Please choose a valid tour package number:\n\n${listStr}\n\nReply with the package number.`);
                return res.status(200).send('<Response></Response>');
            }

            const pkg = activePackages[selectedIndex];
            await leadRepo.updateLeadSelection(lead.id, pkg.name);
            await convRepo.updateConversation(cleanPhone, 'completed', pkg.name);
            await respond(`Thank you for choosing ${pkg.name}.\n\nOur travel consultant will contact you shortly.`);
            return res.status(200).send('<Response></Response>');
        }

        // Stage 'completed': human agent mode — the inbound message was already logged above.
        return res.status(200).send('<Response></Response>');
    } catch (error: any) {
        console.error('[webhook:twilio] error:', error);
        try {
            await respond("Sorry, we encountered an error while processing your request. Please try again later or reply with 'menu' to restart.");
        } catch {
            // best effort
        }
        return res.status(500).send('Internal Server Error');
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
