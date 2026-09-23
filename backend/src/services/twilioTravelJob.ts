import { pool } from '../db.js';
import { sendTwilioWhatsAppMessage } from './twilioService.js';
import { recordOutboundMessage } from './whatsappMessageService.js';

/** Twilio-side birthday/departure/arrival check — mirrors the old Supabase Edge Function,
 *  triggered on-demand by the frontend after a lead is created/updated. The Baileys bridge
 *  runs its own equivalent hourly job (see baileysService.checkAndSendTravelMessages). */
export async function checkAndSendTravelMessagesTwilio() {
    const { rows: leads } = await pool.query('SELECT * FROM leads');

    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const currentMonth = today.getMonth() + 1;
    const currentDate = today.getDate();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayISOOnlyDate = `${yyyy}-${mm}-${dd}`;
    const todayStartISO = `${yyyy}-${mm}-${dd}T00:00:00+05:30`;

    const results: any[] = [];

    for (const lead of leads) {
        if (!lead.phone || lead.notes === '[DELETED]') continue;

        let dobStr = lead.dob ? new Date(lead.dob).toISOString().slice(0, 10) : '';
        let departureStr = '', arrivalStr = '';
        if (lead.notes) {
            try {
                const parsed = JSON.parse(lead.notes);
                if (parsed) {
                    dobStr = dobStr || parsed.dob || '';
                    departureStr = parsed.tour_departure || '';
                    arrivalStr = parsed.tour_arrival || '';
                }
            } catch {
                // notes isn't JSON — ignore, dobStr from the real column (if any) still applies.
            }
        }
        if (!dobStr && !departureStr && !arrivalStr) continue;

        let existingMessages: any[] | null = null;
        const getExistingMessages = async () => {
            if (existingMessages !== null) return existingMessages;
            const { rows } = await pool.query(
                `SELECT * FROM whatsapp_messages WHERE lead_id = $1 AND sender = 'user' AND created_at >= $2`,
                [lead.id, todayStartISO]
            );
            existingMessages = rows;
            return rows;
        };

        const sendAndLog = async (content: string, type: string) => {
            try {
                const result = await sendTwilioWhatsAppMessage(lead.phone, content);
                await recordOutboundMessage({ phone: lead.phone, leadId: lead.id, body: content, twilioSid: result.sid, twilioStatus: result.status });
                results.push({ lead: lead.name, type, status: 'success', sid: result.sid });
            } catch (err: any) {
                results.push({ lead: lead.name, type, status: 'error', error: err.message });
            }
        };

        if (dobStr) {
            const [, dobMonthStr, dobDateStr] = dobStr.split('-');
            if (dobMonthStr && dobDateStr && parseInt(dobMonthStr, 10) === currentMonth && parseInt(dobDateStr, 10) === currentDate) {
                const msgs = await getExistingMessages();
                if (!msgs.some((m) => m.content.includes('Happy Birthday'))) {
                    await sendAndLog(`Happy Birthday ${lead.name}! 🎂🎉 The team at Errances Voyages wishes you a wonderful day and many beautiful travels ahead! ✈️`, 'birthday');
                } else {
                    results.push({ lead: lead.name, type: 'birthday', status: 'already_sent' });
                }
            }
        }

        if (departureStr && departureStr === todayISOOnlyDate) {
            const msgs = await getExistingMessages();
            if (!msgs.some((m) => m.content.includes('wonderful journey') || m.content.includes('safe flight'))) {
                await sendAndLog(`Wishing you a wonderful journey, ${lead.name}! ✈️ The team at Errances Voyages hopes you have a safe flight and an amazing trip starting today! 🌍`, 'departure');
            } else {
                results.push({ lead: lead.name, type: 'departure', status: 'already_sent' });
            }
        }

        if (arrivalStr && arrivalStr === todayISOOnlyDate) {
            const msgs = await getExistingMessages();
            if (!msgs.some((m) => m.content.includes('Welcome home') || m.content.includes('fantastic travel'))) {
                await sendAndLog(`Welcome home, ${lead.name}! 🏡 We hope you had a fantastic travel experience with Errances Voyages. We would love to hear your feedback and see your beautiful pictures! 📸`, 'arrival');
            } else {
                results.push({ lead: lead.name, type: 'arrival', status: 'already_sent' });
            }
        }
    }

    return results;
}
