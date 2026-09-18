import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
});

export async function query(text: string, params: any[] = []) {
    return pool.query(text, params);
}

export async function migrate() {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    await pool.query(schema);
    console.log('[db] schema ensured');

    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM staffs');
    if (rows[0].count === 0) {
        const passwordHash = await bcrypt.hash(config.seedAdminPassword, 10);
        const inserted = await pool.query(
            `INSERT INTO staffs (email, full_name, role, status, password_hash)
             VALUES ($1, $2, 'admin', 'active', $3) RETURNING id, full_name, email, role`,
            [config.seedAdminEmail, config.seedAdminName, passwordHash]
        );
        const admin = inserted.rows[0];
        await pool.query(
            `INSERT INTO profiles (id, full_name, email, role) VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO NOTHING`,
            [admin.id, admin.full_name, admin.email, admin.role]
        );
        console.log(`[db] seeded default admin account: ${config.seedAdminEmail}`);
    }
}
