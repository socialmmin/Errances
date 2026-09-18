import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export type JwtPayload = {
    sub: string;
    email: string;
    role: string;
};

export function signToken(payload: JwtPayload): string {
    return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn as any });
}

export function verifyToken(token: string): JwtPayload {
    return jwt.verify(token, config.jwtSecret) as JwtPayload;
}
