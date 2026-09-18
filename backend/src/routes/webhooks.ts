import { Router } from 'express';
import * as leadRepo from '../services/leadRepo.js';
import * as convRepo from '../services/conversationRepo.js';
import { sendTwilioWhatsAppMessage, validateTwilioSignature } from '../services/twilioService.js';

const router = Router();

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

router.post('/twilio', async (req, res) => {
    const signature = req.header('x-twilio-signature');
    const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;
    const fullUrl = `${protocol}://${host}${req.originalUrl}`;

    if (!validateTwilioSignature(signature, fullUrl, req.body)) {
        return res.status(403).send('Forbidden: Twilio signature validation failed');
    }

    const { From, Body } = req.body;
    if (!From || !Body) return res.status(400).send('Missing From or Body');

    const cleanPhone = From.toString().replace('whatsapp:', '').trim();
    const rawBody = Body.toString().trim();
    let currentLeadId: string | null = null;

    // Sends a reply via Twilio and logs both sides of the exchange into whatsapp_messages
    // (so it shows up in the CRM chat UI, mirroring the previous Supabase Edge Function).
    const respond = async (text: string) => {
        await sendTwilioWhatsAppMessage(cleanPhone, text);
        if (currentLeadId) await leadRepo.insertWhatsappMessage(currentLeadId, 'user', text, 'read');
    };
    const logIncoming = async (leadId: string) => {
        currentLeadId = leadId;
        await leadRepo.insertWhatsappMessage(leadId, 'contact', rawBody, 'read');
    };

    try {
        let conversation = await convRepo.getConversationByPhone(cleanPhone);
        const activePackages = await leadRepo.getActiveTours();

        if (activePackages.length === 0) {
            await sendTwilioWhatsAppMessage(cleanPhone, 'Thank you for contacting us. We currently do not have any active packages available. A travel consultant will contact you shortly.');
            return res.status(200).send('<Response></Response>');
        }

        const isResetRequest = ['menu', 'restart', 'start'].includes(rawBody.toLowerCase());

        if (!conversation || isResetRequest) {
            conversation = isResetRequest && conversation
                ? await convRepo.updateConversation(cleanPhone, 'collect_name', null)
                : await convRepo.createConversation(cleanPhone);

            let lead = await leadRepo.getLeadByPhone(cleanPhone);
            if (!lead) lead = await leadRepo.createLead(cleanPhone);
            await logIncoming(lead.id);

            const listStr = activePackages.map((p, idx) => `${idx + 1}. ${p.name}`).join('\n');
            const welcomeText = `Thank you for contacting Errances Voyages. 🌟\n\nCould you please reply with your *Full Name* and select the *Tour Package Number* you are interested in from the list below:\n\n*Active Tour Packages:*\n${listStr}\n\nExample reply: John Doe - 2`;
            await respond(welcomeText);
            return res.status(200).send('<Response></Response>');
        }

        if (conversation.stage === 'collect_name') {
            let lead = await leadRepo.getLeadByPhone(cleanPhone);
            if (!lead) lead = await leadRepo.createLead(cleanPhone);
            await logIncoming(lead.id);

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
            await logIncoming(lead.id);

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

        // Stage 'completed': human agent mode — still log the incoming message so it shows in chat.
        const lead = await leadRepo.getLeadByPhone(cleanPhone);
        if (lead) await logIncoming(lead.id);
        return res.status(200).send('<Response></Response>');
    } catch (error: any) {
        console.error('[webhook:twilio] error:', error);
        try {
            await sendTwilioWhatsAppMessage(cleanPhone, "Sorry, we encountered an error while processing your request. Please try again later or reply with 'menu' to restart.");
        } catch {
            // best effort
        }
        return res.status(500).send('Internal Server Error');
    }
});

export default router;
