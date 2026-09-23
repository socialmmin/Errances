import type { Request, Response, NextFunction } from 'express';
import { verifyToken, type JwtPayload } from '../auth/jwt.js';
import { pool } from '../db.js';

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            user?: JwtPayload;
        }
    }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
        try {
            const payload = verifyToken(header.slice(7));
            const { rows } = await pool.query('SELECT email,role,status FROM staffs WHERE id=$1', [payload.sub]);
            if (rows[0]?.status === 'active') req.user = { ...payload, email: rows[0].email, role: rows[0].role };
        } catch {
            // Invalid/expired token — treat as anonymous, routes decide if that's allowed.
        }
    }
    next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
}

export function requireRole(...roles: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}
