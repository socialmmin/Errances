import type { Request, Response, NextFunction } from 'express';
import { verifyToken, type JwtPayload } from '../auth/jwt.js';

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            user?: JwtPayload;
        }
    }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
        try {
            req.user = verifyToken(header.slice(7));
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
