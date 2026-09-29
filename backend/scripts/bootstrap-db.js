#!/usr/bin/env node
// Database bootstrap, run before the API starts (see Dockerfile CMD). Idempotent and safe to run on every boot:
//   1. creates the target database if it does not exist (connects to the server's "postgres" maintenance DB),
//   2. applies database/schema.sql on an empty database, then every database/migrations/*.sql not yet recorded
//      in the schema_migrations table (filename order),
//   3. seeds branch/roles/admin ONLY when there are no users yet, and takes the admin login from
//      SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME so no default password reaches production.
// It never drops or truncates anything. Exits non-zero on the first failure so a bad deploy stops loudly.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('[bootstrap] DATABASE_URL is not set'); process.exit(1); }

const ssl = /^(1|true)$/i.test(process.env.DATABASE_SSL || '') ? { rejectUnauthorized: false } : undefined;
const dbDir = [process.env.DB_DIR, path.join(__dirname, '..', 'database'), path.join(__dirname, '..', '..', 'database')]
  .filter(Boolean).find((d) => fs.existsSync(path.join(d, 'schema.sql')));
if (!dbDir) { console.error('[bootstrap] database/ directory (schema.sql) not found'); process.exit(1); }

const target = new URL(DATABASE_URL);
const dbName = decodeURIComponent(target.pathname.replace(/^\//, ''));
if (!/^[A-Za-z0-9_]+$/.test(dbName)) { console.error('[bootstrap] refusing database name with unexpected characters'); process.exit(1); }

const read = (f) => fs.readFileSync(path.join(dbDir, f), 'utf8');
const log = (m) => console.log('[bootstrap] ' + m);

async function ensureDatabase() {
  const admin = new URL(DATABASE_URL);
  admin.pathname = '/postgres';
  const c = new Client({ connectionString: admin.toString(), ssl });
  await c.connect();
  try {
    const { rows } = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rows.length) { log(`database "${dbName}" exists`); return; }
    await c.query(`CREATE DATABASE "${dbName}"`);
    log(`created database "${dbName}"`);
  } finally { await c.end(); }
}

async function main() {
  await ensureDatabase();
  const c = new Client({ connectionString: DATABASE_URL, ssl });
  await c.connect();
  try {
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const migrationFiles = fs.readdirSync(path.join(dbDir, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    const fresh = (await c.query("SELECT to_regclass('public.branches') AS t")).rows[0].t === null;

    if (fresh) {
      log('empty database: applying schema.sql');
      await c.query(read('schema.sql'));
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1) ON CONFLICT DO NOTHING', ['schema.sql']);
    } else if (applied.size === 0) {
      // A database built by hand (psql) before tracking existed: it already has everything, so just record it.
      log('existing untracked database: recording current schema and migrations as applied');
      for (const n of ['schema.sql', ...migrationFiles.map((f) => 'migrations/' + f)]) await c.query('INSERT INTO schema_migrations(name) VALUES ($1) ON CONFLICT DO NOTHING', [n]);
      applied.add('schema.sql'); migrationFiles.forEach((f) => applied.add('migrations/' + f));
    }

    for (const f of migrationFiles) {
      const name = 'migrations/' + f;
      if (applied.has(name)) continue;
      log('applying ' + name);
      await c.query(read(name));
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
    }

    const users = Number((await c.query('SELECT count(*)::int AS n FROM users')).rows[0].n);
    if (users === 0) {
      log('no users yet: applying seed.sql');
      await c.query(read('seed.sql'));
      const email = (process.env.SEED_ADMIN_EMAIL || '').trim();
      const password = process.env.SEED_ADMIN_PASSWORD || '';
      if (email && password.length >= 6) {
        const hash = await require('bcrypt').hash(password, 10);
        await c.query('UPDATE users SET email = $1, password_hash = $2, full_name = COALESCE(NULLIF($3, \'\'), full_name) WHERE employee_code = \'EMP-0001\'', [email, hash, process.env.SEED_ADMIN_NAME || '']);
        log('seed admin login set from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD');
      } else {
        log('WARNING: SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD not set (min 6 chars) - the placeholder seed password is active; change it immediately');
      }
    }
    log('database ready');
  } finally { await c.end(); }
}

main().catch((e) => { console.error('[bootstrap] FAILED:', e.message); process.exit(1); });
