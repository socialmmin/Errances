import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { config } from './config.js';
import { migrate } from './db.js';
import { authenticate } from './middleware/authenticate.js';
import { setIo } from './realtime.js';

import authRoutes from './routes/auth.js';
import dbRoutes from './routes/db.js';
import uploadRoutes from './routes/upload.js';
import whatsappRoutes from './routes/whatsapp.js';
import webhookRoutes from './routes/webhooks.js';
import leadsRoutes from './routes/leads.js';

import { startBaileys, checkAndSendTravelMessages } from './services/baileysService.js';

async function main() {
    await migrate();

    const app = express();
    app.use(cors({ origin: config.corsOrigins, credentials: true }));

    // Twilio posts application/x-www-form-urlencoded; everything else is JSON.
    app.use('/api/webhooks/twilio', express.urlencoded({ extended: false }));
    app.use(express.json({ limit: '20mb' }));

    app.use(authenticate);

    app.get('/health', (_req, res) => res.json({ ok: true }));

    app.use('/api/auth', authRoutes);
    app.use('/api/db', dbRoutes);
    app.use('/api/upload', uploadRoutes);
    app.use('/api/whatsapp', whatsappRoutes);
    app.use('/api/webhooks', webhookRoutes);
    app.use('/api/leads', leadsRoutes);

    const server = http.createServer(app);
    const io = new Server(server, { cors: { origin: config.corsOrigins } });
    setIo(io);

    server.listen(config.port, () => {
        console.log(`[server] listening on port ${config.port}`);
    });

    startBaileys().catch((err) => console.error('[baileys] failed to start:', err));
    setInterval(() => checkAndSendTravelMessages().catch((err) => console.error('[travel] job failed:', err)), 60 * 60 * 1000);
}

main().catch((err) => {
    console.error('[server] fatal startup error:', err);
    process.exit(1);
});
