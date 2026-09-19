import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import type { Boom } from '@hapi/boom';
import qrcode from 'qrcode';
import { pool } from '../db.js';
import { broadcastChange } from '../realtime.js';
import { config } from '../config.js';

let sock: ReturnType<typeof makeWASocket> | null = null;
let connectionStatus: 'connecting' | 'qr' | 'open' | 'close' = 'close';
let qrCodeDataUrl = '';

export function getBaileysStatus() {
    return { status: connectionStatus, qr: qrCodeDataUrl };
}

export async function sendBaileysMessage(to: string, message: string) {
    if (connectionStatus !== 'open' || !sock) {
        throw new Error('WhatsApp is not connected');
    }
    let targetJid = to;
    if (!to.includes('@')) {
        const clean = to.replace(/\D/g, '');
        targetJid = clean.includes('-') || clean.length > 15 ? `${clean}@g.us` : `${clean}@s.whatsapp.net`;
    }
    const sent = await sock.sendMessage(targetJid, { text: message });
    return sent?.key?.id;
}

function jidToUuid(jid: string) {
    let hash = 0;
    for (let i = 0; i < jid.length; i++) {
        const char = jid.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash &= hash;
    }
    const hex = Math.abs(hash).toString(16).padEnd(32, '0');
    return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-4${hex.substring(12, 15)}-a${hex.substring(15, 18)}-${hex.substring(18, 30)}`;
}

const cleanJidPhone = (jid: string) => jid.split('@')[0];

async function syncContact(jid: string, name: string | null, isGroup: boolean, isLive: boolean): Promise<string | null> {
    const cleanPhone = cleanJidPhone(jid);
    const normalizedSearch = cleanPhone.replace(/\D/g, '');

    const { rows: leads } = await pool.query('SELECT * FROM leads');
    const matchingLead = leads.find((lead: any) => {
        if (!lead.phone) return false;
        const cleanLeadPhone = lead.phone.replace(/\D/g, '');
        return cleanLeadPhone === normalizedSearch || cleanLeadPhone.endsWith(normalizedSearch) || normalizedSearch.endsWith(cleanLeadPhone);
    });

    if (matchingLead) {
        if (matchingLead.notes === '[DELETED]' && isLive) {
            const { rows } = await pool.query('UPDATE leads SET notes = NULL WHERE id = $1 RETURNING *', [matchingLead.id]);
            broadcastChange('leads', 'UPDATE', { new: rows[0] });
        }
        if (name && (matchingLead.name.startsWith('WhatsApp (') || matchingLead.name.startsWith('WhatsApp Lead ('))) {
            const { rows } = await pool.query('UPDATE leads SET name = $1 WHERE id = $2 RETURNING *', [name, matchingLead.id]);
            broadcastChange('leads', 'UPDATE', { new: rows[0] });
        }
        return matchingLead.id;
    }

    const id = jidToUuid(jid);
    const { rows } = await pool.query(
        `INSERT INTO leads (id, name, phone, email, source, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING RETURNING *`,
        [
            id,
            name || (isGroup ? 'Unnamed Group' : `WhatsApp (${cleanPhone})`),
            isGroup ? `group-${cleanPhone}` : `+${cleanPhone}`,
            isGroup ? `group-${cleanPhone}@whatsapp.group` : `${cleanPhone}@whatsapp.crm`,
            isGroup ? 'WhatsApp Group' : 'WhatsApp Web',
            isGroup ? 'converted' : 'new',
        ]
    );
    if (rows[0]) broadcastChange('leads', 'INSERT', { new: rows[0] });
    return id;
}

async function syncMessage(msg: any, leadId: string) {
    const messageContent =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        (msg.message?.imageMessage ? '📷 Photo' : null) ||
        '';
    if (!messageContent.trim()) return;

    const isUser = Boolean(msg.key.fromMe);
    const sender = isUser ? 'user' : 'contact';
    const timestamp = new Date((msg.messageTimestamp?.low || msg.messageTimestamp) * 1000).toISOString();

    const { rows: existing } = await pool.query(
        'SELECT id FROM whatsapp_messages WHERE lead_id = $1 AND content = $2 AND sender = $3 LIMIT 1',
        [leadId, messageContent, sender]
    );

    if (existing.length === 0) {
        const { rows } = await pool.query(
            `INSERT INTO whatsapp_messages (lead_id, sender, content, status, created_at)
             VALUES ($1, $2, $3, 'read', $4) RETURNING *`,
            [leadId, sender, messageContent, timestamp]
        );
        broadcastChange('whatsapp_messages', 'INSERT', { new: rows[0] });
    }

    const remoteJid = msg.key.remoteJid || '';
    const isGroup = remoteJid.endsWith('@g.us');
    if (isUser || isGroup || !messageContent.trim()) return;

    try {
        const { rows: leadRows } = await pool.query('SELECT name, selected_package, tour_interest FROM leads WHERE id = $1', [leadId]);
        const lead = leadRows[0];
        if (!lead) return;

        const { rows: tourPackages } = await pool.query(
            `SELECT id, title, price FROM tours WHERE status = 'active' ORDER BY title ASC`
        );
        if (tourPackages.length === 0) return;

        const rawBody = messageContent.trim();
        let parsedName = rawBody;
        let selectedPackage: any = null;

        const numbers = rawBody.match(/\d+/g);
        if (numbers) {
            for (const numStr of numbers) {
                const val = parseInt(numStr, 10);
                if (val >= 1 && val <= tourPackages.length) {
                    selectedPackage = tourPackages[val - 1];
                    const numRegex = new RegExp(`\\s*[-–—,\\.]*\\s*${numStr}\\s*|\\s*${numStr}\\s*[-–—,\\.]*\\s*`);
                    parsedName = rawBody.replace(numRegex, ' ').replace(/\s+/g, ' ').trim();
                    break;
                }
            }
        }

        if (!selectedPackage) {
            for (const pkg of tourPackages) {
                const titleEscaped = pkg.title.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                const titleRegex = new RegExp(`\\b${titleEscaped}\\b`, 'i');
                if (titleRegex.test(rawBody)) {
                    selectedPackage = pkg;
                    const replaceRegex = new RegExp(`\\s*[-–—,\\.]*\\s*${titleEscaped}\\s*|\\s*${titleEscaped}\\s*[-–—,\\.]*\\s*`, 'i');
                    parsedName = rawBody.replace(replaceRegex, ' ').replace(/\s+/g, ' ').trim();
                    break;
                }
            }
        }

        const GREETINGS = ['hi', 'hii', 'hiii', 'hello', 'hey', 'heyy', 'hola', 'start', 'menu', 'restart', 'good morning', 'good afternoon', 'good evening'];
        const isGreeting = GREETINGS.includes(parsedName.toLowerCase().trim());
        const hasValidName = parsedName.length >= 2 && !isGreeting;

        if (selectedPackage) {
            const shouldUpdateName = hasValidName && (lead.name.startsWith('WhatsApp (') || lead.name.startsWith('WhatsApp Lead ('));
            const { rows } = await pool.query(
                `UPDATE leads SET selected_package = $1, tour_interest = $1, budget = $2, status = 'qualified', selection_timestamp = NOW()
                 ${shouldUpdateName ? ', name = $4' : ''}
                 WHERE id = $3 RETURNING *`,
                shouldUpdateName ? [selectedPackage.title, selectedPackage.price, leadId, parsedName] : [selectedPackage.title, selectedPackage.price, leadId]
            );
            broadcastChange('leads', 'UPDATE', { new: rows[0] });
        }
    } catch (err) {
        console.error('[baileys] parser error:', err);
    }
}

export async function checkAndSendTravelMessages() {
    if (connectionStatus !== 'open' || !sock) return;
    try {
        const { rows: leads } = await pool.query('SELECT * FROM leads');
        const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const currentMonth = today.getMonth() + 1;
        const currentDate = today.getDate();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const todayISOOnlyDate = `${yyyy}-${mm}-${dd}`;
        const todayStartISO = `${yyyy}-${mm}-${dd}T00:00:00+05:30`;

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

            const getTargetJid = () => {
                if (lead.phone.includes('@')) return lead.phone;
                const clean = lead.phone.replace(/\D/g, '');
                return clean.includes('-') || clean.length > 15 ? `${clean}@g.us` : `${clean}@s.whatsapp.net`;
            };

            const sendAndLog = async (content: string) => {
                const targetJid = getTargetJid();
                await sock!.sendMessage(targetJid, { text: content });
                const { rows } = await pool.query(
                    `INSERT INTO whatsapp_messages (lead_id, sender, content, status) VALUES ($1, 'user', $2, 'sent') RETURNING *`,
                    [lead.id, content]
                );
                broadcastChange('whatsapp_messages', 'INSERT', { new: rows[0] });
            };

            if (dobStr) {
                const [, dobMonthStr, dobDateStr] = dobStr.split('-');
                if (dobMonthStr && dobDateStr && parseInt(dobMonthStr, 10) === currentMonth && parseInt(dobDateStr, 10) === currentDate) {
                    const msgs = await getExistingMessages();
                    if (!msgs.some((m) => m.content.includes('Happy Birthday'))) {
                        await sendAndLog(`Happy Birthday ${lead.name}! 🎂🎉 The team at Errances Voyages wishes you a wonderful day and many beautiful travels ahead! ✈️`).catch((e) => console.error('[travel] birthday send failed:', e));
                    }
                }
            }

            if (departureStr && departureStr === todayISOOnlyDate) {
                const msgs = await getExistingMessages();
                if (!msgs.some((m) => m.content.includes('wonderful journey') || m.content.includes('safe flight'))) {
                    await sendAndLog(`Wishing you a wonderful journey, ${lead.name}! ✈️ The team at Errances Voyages hopes you have a safe flight and an amazing trip starting today! 🌍`).catch((e) => console.error('[travel] departure send failed:', e));
                }
            }

            if (arrivalStr && arrivalStr === todayISOOnlyDate) {
                const msgs = await getExistingMessages();
                if (!msgs.some((m) => m.content.includes('Welcome home') || m.content.includes('fantastic travel'))) {
                    await sendAndLog(`Welcome home, ${lead.name}! 🏡 We hope you had a fantastic travel experience with Errances Voyages. We would love to hear your feedback and see your beautiful pictures! 📸`).catch((e) => console.error('[travel] arrival send failed:', e));
                }
            }
        }
    } catch (err) {
        console.error('[travel] unexpected error:', err);
    }
}

export async function startBaileys() {
    if (!config.baileys.enabled) {
        console.log('[baileys] disabled via ENABLE_BAILEYS=false');
        return;
    }

    connectionStatus = 'connecting';
    const { state, saveCreds } = await useMultiFileAuthState(config.baileys.authDir);

    sock = makeWASocket({ auth: state, syncFullHistory: true, shouldSyncHistoryMessage: () => true });
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            connectionStatus = 'qr';
            qrCodeDataUrl = await qrcode.toDataURL(qr);
            console.log('[baileys] new QR code generated');
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = 'close';
            qrCodeDataUrl = '';
            if (shouldReconnect) setTimeout(startBaileys, 3000);
        } else if (connection === 'open') {
            console.log('[baileys] connection opened');
            connectionStatus = 'open';
            qrCodeDataUrl = '';
            setTimeout(checkAndSendTravelMessages, 15000);
        }
    });

    sock.ev.on('messaging-history.set', async ({ chats, messages }) => {
        if (chats) {
            for (const chat of chats) {
                if (!chat.id) continue;
                const isGroup = chat.id.endsWith('@g.us');
                await syncContact(chat.id, chat.name || (chat as any).subject || null, isGroup, false);
            }
        }
        if (messages) {
            for (const msg of messages) {
                if (msg.key?.remoteJid) {
                    const leadId = await syncContact(msg.key.remoteJid, msg.pushName || null, msg.key.remoteJid.endsWith('@g.us'), false);
                    if (leadId) await syncMessage(msg, leadId);
                }
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            if (!msg.key?.remoteJid) continue;
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            const leadId = await syncContact(jid, msg.pushName || null, isGroup, true);
            if (leadId) await syncMessage(msg, leadId);
        }
    });
}
