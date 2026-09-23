import twilio from 'twilio';
import { config, isTwilioConfigured } from '../config.js';

let client: twilio.Twilio | null = null;

export function getClient(): twilio.Twilio {
    if (!client) client = twilio(config.twilio.accountSid, config.twilio.authToken);
    return client;
}

export type SendWhatsAppOptions = {
    contentSid?: string;
    contentVariables?: Record<string, string>;
    mediaUrl?: string[];
};

export type SendWhatsAppResult = { sid: string; status: string };

export async function sendTwilioWhatsAppMessage(
    to: string,
    body: string,
    options: SendWhatsAppOptions = {}
): Promise<SendWhatsAppResult> {
    if (!isTwilioConfigured()) {
        throw new Error('Twilio is not configured on the server');
    }

    const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
    const formattedFrom = config.twilio.whatsappNumber.startsWith('whatsapp:')
        ? config.twilio.whatsappNumber
        : `whatsapp:${config.twilio.whatsappNumber}`;

    const payload: Record<string, any> = { to: formattedTo, from: formattedFrom };
    if (options.contentSid) {
        payload.contentSid = options.contentSid;
        if (options.contentVariables) payload.contentVariables = JSON.stringify(options.contentVariables);
    } else {
        payload.body = body;
    }
    if (options.mediaUrl?.length) payload.mediaUrl = options.mediaUrl;
    if (config.publicUrl) payload.statusCallback = `${config.publicUrl}/api/webhooks/twilio/status`;

    const response = await getClient().messages.create(payload as any);
    return { sid: response.sid, status: response.status };
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

/** Maps Twilio's MessageStatus values onto our whatsapp_messages.status CHECK constraint (they already line up 1:1). */
export const TWILIO_STATUS_VALUES = ['queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'undelivered'] as const;
