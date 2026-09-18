import twilio from 'twilio';
import { config, isTwilioConfigured } from '../config.js';

let client: twilio.Twilio | null = null;

function getClient(): twilio.Twilio {
    if (!client) client = twilio(config.twilio.accountSid, config.twilio.authToken);
    return client;
}

export async function sendTwilioWhatsAppMessage(
    to: string,
    body: string,
    contentSid?: string,
    contentVariables?: Record<string, string>
): Promise<string> {
    if (!isTwilioConfigured()) {
        throw new Error('Twilio is not configured on the server');
    }

    const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
    const formattedFrom = config.twilio.whatsappNumber.startsWith('whatsapp:')
        ? config.twilio.whatsappNumber
        : `whatsapp:${config.twilio.whatsappNumber}`;

    const payload: Record<string, any> = { to: formattedTo, from: formattedFrom };
    if (contentSid) {
        payload.contentSid = contentSid;
        if (contentVariables) payload.contentVariables = JSON.stringify(contentVariables);
    } else {
        payload.body = body;
    }

    const response = await getClient().messages.create(payload as any);
    return response.sid;
}

export async function listWhatsAppMessages(pageSize = 1000) {
    if (!isTwilioConfigured()) return [];
    const messages = await getClient().messages.list({ pageSize });
    return messages
        .filter((m) => m.from.startsWith('whatsapp:') && m.to.startsWith('whatsapp:'))
        .map((m) => ({
            from: m.from,
            to: m.to,
            body: m.body,
            direction: m.direction,
            status: m.status,
            date_created: m.dateCreated,
        }));
}

export function validateTwilioSignature(signature: string | undefined, url: string, params: Record<string, any>): boolean {
    if (config.twilio.skipValidation) return true;
    if (!signature) return false;
    return twilio.validateRequest(config.twilio.authToken, signature, url, params);
}
