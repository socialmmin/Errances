import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { signToken } from '../auth/jwt.js';
import { requireAuth } from '../middleware/authenticate.js';

const router = Router();

router.post('/login', async (req, res) => {
    const identifier = (req.body?.identifier ?? req.body?.email ?? '').trim();
    const { password } = req.body || {};
    if (!identifier || !password) {
        return res.status(400).json({ error: 'Access key/email and password are required' });
    }

    const { rows } = await pool.query(
        'SELECT * FROM staffs WHERE email = $1 OR access_key = $1',
        [identifier]
    );
    const staff = rows[0];
    if (!staff) return res.status(401).json({ error: 'Invalid access key or password' });

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

    if (!ok) return res.status(401).json({ error: 'Invalid access key or password' });

    if (staff.status === 'pending') {
        return res.status(403).json({ error: 'Your account is awaiting administrator approval.', code: 'PENDING_APPROVAL' });
    }
    if (staff.status === 'inactive') {
        return res.status(403).json({ error: 'Your account has been deactivated. Contact your administrator.', code: 'ACCOUNT_INACTIVE' });
    }

    const token = signToken({ sub: staff.id, email: staff.email, role: staff.role });
    const { password_hash, ...safeStaff } = staff;
    res.json({ token, user: safeStaff });
});

router.post('/register', async (req, res) => {
    const { full_name, email, phone, access_key, password } = req.body || {};
    if (!full_name || !email || !access_key || !password) {
        return res.status(400).json({ error: 'Full name, email, access key and password are required' });
    }
    if (String(password).length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const { rows: existing } = await pool.query(
        'SELECT id FROM staffs WHERE email = $1 OR access_key = $2',
        [email, access_key]
    );
    if (existing.length > 0) {
        return res.status(409).json({ error: 'An account with that email or access key already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
        `INSERT INTO staffs (email, access_key, full_name, phone, role, status, password_hash)
         VALUES ($1, $2, $3, $4, 'sales_executive', 'pending', $5)
         RETURNING *`,
        [email, access_key, full_name, phone || null, passwordHash]
    );
    const staff = rows[0];
    await pool.query(
        `INSERT INTO profiles (id, full_name, email, role) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [staff.id, staff.full_name, staff.email, staff.role]
    );

    const { password_hash, ...safeStaff } = staff;
    res.status(201).json({ user: safeStaff, message: 'Your account has been created and is awaiting administrator approval.' });
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
