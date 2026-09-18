import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { signToken } from '../auth/jwt.js';
import { requireAuth } from '../middleware/authenticate.js';

const router = Router();

router.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    const { rows } = await pool.query('SELECT * FROM staffs WHERE email = $1', [email]);
    const staff = rows[0];
    if (!staff) return res.status(401).json({ error: 'Invalid email or password' });

    let ok = false;
    if (staff.password_hash) {
        ok = await bcrypt.compare(password, staff.password_hash);
    } else {
        // Legacy accounts created before password hashing: password = phone digits.
        const digits = String(password).replace(/\D/g, '');
        const storedDigits = (staff.phone || '').replace(/\D/g, '');
        ok = Boolean(digits && storedDigits && digits === storedDigits);
        if (ok) {
            const newHash = await bcrypt.hash(password, 10);
            await pool.query('UPDATE staffs SET password_hash = $1 WHERE id = $2', [newHash, staff.id]);
        }
    }

    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    const token = signToken({ sub: staff.id, email: staff.email, role: staff.role });
    const { password_hash, ...safeStaff } = staff;
    res.json({ token, user: safeStaff });
});

router.post('/otp', async (_req, res) => {
    res.status(501).json({ error: 'Magic-link sign-in is not available. Please sign in with your password.' });
});

router.get('/me', requireAuth, async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM staffs WHERE id = $1', [req.user!.sub]);
    const staff = rows[0];
    if (!staff) return res.status(404).json({ error: 'Account not found' });
    const { password_hash, ...safeStaff } = staff;
    res.json({ user: safeStaff });
});

router.post('/logout', (_req, res) => {
    // JWTs are stateless; the client simply discards its token.
    res.json({ ok: true });
});

export default router;
