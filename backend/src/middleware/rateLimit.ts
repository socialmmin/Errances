import type { Request, Response, NextFunction } from 'express';

/**
 * Minimal in-memory sliding-window rate limiter — no Redis dependency, matching
 * this project's existing "no new infra unless necessary" approach. Good enough
 * for the single-instance Coolify deployment this app currently runs on; if the
 * backend is ever scaled horizontally, swap the Map for a shared store.
 */
export function rateLimit(options: { windowMs: number; max: number; keyFn?: (req: Request) => string }) {
    const hits = new Map<string, number[]>();

    return (req: Request, res: Response, next: NextFunction) => {
        const key = options.keyFn ? options.keyFn(req) : req.ip || 'unknown';
        const now = Date.now();
        const windowStart = now - options.windowMs;

        const timestamps = (hits.get(key) || []).filter((t) => t > windowStart);
        if (timestamps.length >= options.max) {
            res.setHeader('Retry-After', Math.ceil(options.windowMs / 1000));
            return res.status(429).json({ error: 'Too many requests, please slow down.' });
        }

        timestamps.push(now);
        hits.set(key, timestamps);

        // Occasional cleanup so the map doesn't grow unbounded.
        if (hits.size > 5000) {
            for (const [k, v] of hits) {
                if (v.every((t) => t <= windowStart)) hits.delete(k);
            }
        }

        next();
    };
}
