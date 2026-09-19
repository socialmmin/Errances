import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/authenticate.js';

const router = Router();

const normalizePhone = (phone: string) => phone.replace(/\D/g, '');

function phoneMatches(a: string, b: string) {
    if (!a || !b) return false;
    return a === b || a.endsWith(b) || b.endsWith(a);
}

router.post('/check-duplicate', requireAuth, async (req, res) => {
    const { phone, whatsapp_number, email, exclude_id } = req.body || {};
    if (!phone && !whatsapp_number && !email) {
        return res.json({ duplicate: null });
    }

    try {
        const { rows: leads } = await pool.query(
            `SELECT id, lead_number, name, phone, whatsapp_number, email, status, created_at FROM leads WHERE notes IS DISTINCT FROM '[DELETED]'`
        );

        const cleanPhone = phone ? normalizePhone(phone) : '';
        const cleanWhatsapp = whatsapp_number ? normalizePhone(whatsapp_number) : '';
        const cleanEmail = email ? String(email).trim().toLowerCase() : '';

        const match = leads.find((lead: any) => {
            if (exclude_id && lead.id === exclude_id) return false;
            if (cleanEmail && lead.email && String(lead.email).trim().toLowerCase() === cleanEmail) return true;
            if (cleanPhone && lead.phone && phoneMatches(normalizePhone(lead.phone), cleanPhone)) return true;
            if (cleanWhatsapp && lead.whatsapp_number && phoneMatches(normalizePhone(lead.whatsapp_number), cleanWhatsapp)) return true;
            if (cleanWhatsapp && lead.phone && phoneMatches(normalizePhone(lead.phone), cleanWhatsapp)) return true;
            if (cleanPhone && lead.whatsapp_number && phoneMatches(normalizePhone(lead.whatsapp_number), cleanPhone)) return true;
            return false;
        });

        res.json({ duplicate: match || null });
    } catch (err: any) {
        console.error('[leads] check-duplicate failed:', err);
        res.status(500).json({ error: err.message || 'Duplicate check failed' });
    }
});

export default router;
