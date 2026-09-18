import dotenv from 'dotenv';
dotenv.config();

function required(name: string, fallback?: string): string {
    const v = process.env[name] ?? fallback;
    if (v === undefined) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return v;
}

export const config = {
    port: Number(process.env.PORT || 4000),
    nodeEnv: process.env.NODE_ENV || 'development',
    corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),

    databaseUrl: required('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/errances'),
    databaseSsl: process.env.DATABASE_SSL === 'true',

    jwtSecret: required('JWT_SECRET', 'dev-secret-change-me'),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

    seedAdminEmail: process.env.SEED_ADMIN_EMAIL || 'admin@errancesvoyages.com',
    seedAdminPassword: process.env.SEED_ADMIN_PASSWORD || 'Admin@12345',
    seedAdminName: process.env.SEED_ADMIN_NAME || 'Administrator',

    r2: {
        accountId: process.env.R2_ACCOUNT_ID || '',
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
        bucket: process.env.R2_BUCKET || '',
        publicUrl: process.env.R2_PUBLIC_URL || '',
    },

    twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID || '',
        authToken: process.env.TWILIO_AUTH_TOKEN || '',
        whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER || '',
        skipValidation: process.env.SKIP_TWILIO_VALIDATION === 'true',
    },

    baileys: {
        enabled: process.env.ENABLE_BAILEYS !== 'false',
        authDir: process.env.BAILEYS_AUTH_DIR || 'auth_info_baileys',
    },
};

export const isR2Configured = () =>
    Boolean(config.r2.accountId && config.r2.accessKeyId && config.r2.secretAccessKey && config.r2.bucket);

export const isTwilioConfigured = () => Boolean(config.twilio.accountSid && config.twilio.authToken);
