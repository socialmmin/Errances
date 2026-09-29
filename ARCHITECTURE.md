# Architecture — ErranceVoyages_Tourism_2026

## Project identity

- **Canonical project id**: `ErranceVoyages_Tourism_2026`
- **Owner / dev identifier**: `SocialMM_ErranceVoyages`
- **Reference project** (module structure, RBAC roles, schema shapes only —
  different stack): "Hala," a tourism ERP/CRM built on React+Vite+Supabase.
- **Domains** (placeholders — do not need to resolve yet):
  - Frontend: `errances.socialmm.in`
  - Backend API: `api-errances.socialmm.in`

## System layout

```
                    ┌────────────────────────┐
   Browser  ───────▶│  frontend (Next.js)     │  errances.socialmm.in
                    │  App Router, Tailwind,   │
                    │  ShadCN UI, TanStack     │
                    └────────────┬────────────┘
                                 │ fetch (Bearer JWT)
                                 ▼
                    ┌────────────────────────┐
                    │  backend (NestJS)        │  api-errances.socialmm.in
                    │  raw `pg` driver,         │
                    │  repository pattern,      │
                    │  JWT auth, RBAC guard     │
                    └───────┬─────────┬────────┘
                            │         │
                    ┌───────▼──┐  ┌───▼────────────┐
                    │ Postgres │  │ Cloudflare R2    │
                    │ (schema/ │  │ (S3-compatible,  │
                    │  seed)   │  │  file metadata    │
                    └──────────┘  │  only in Postgres)│
                                  └────────────────────┘
```

- **Frontend**: Next.js 14 App Router, TypeScript, Tailwind, ShadCN-style
  components, TanStack Query (server state) + TanStack Table (DataTable),
  Zustand (client/auth state). Navy `#0F172A` + gold `#F59E0B` theme,
  dark/light aware. Talks to the backend only via `NEXT_PUBLIC_API_URL`.
- **Backend**: NestJS, TypeScript, the raw `pg` driver wrapped in a
  repository per entity — **no Prisma, no ORM, no Supabase/PostgREST/GoTrue**.
  JWT access + refresh tokens issued/verified in NestJS (`@nestjs/jwt` +
  `passport-jwt`), passwords hashed with `bcrypt`. A `PermissionsGuard` reads
  a static role→permission-string map
  (`backend/src/common/rbac/role-permissions.ts`) ported from Hala's 11
  roles and permission taxonomy.
- **Database**: PostgreSQL. One consolidated `database/schema.sql` (not a
  migration replay — see README "Database convention"), plus
  `database/seed.sql`.
- **File storage**: Cloudflare R2 via `@aws-sdk/client-s3`, accessed only
  from the backend (`backend/src/common/r2`). The frontend never talks to R2
  directly; the backend issues short-lived presigned upload URLs. Postgres's
  `files` table stores only metadata (`file_id`, `file_name`, `file_type`,
  `file_size`, `r2_object_key`, `uploaded_by`, `created_at`) — never the
  bytes.
- **Coolify / Docker / Hostinger**: both `frontend/` and `backend/` ship a
  multi-stage `Dockerfile`. Coolify builds each from its GitHub repo path and
  deploys as separate services on the Hostinger VPS, each behind its own
  domain (see Domains above). `docker-compose.yml` at the repo root is for
  **local development only** (Postgres + backend + frontend together) — it is
  not what Coolify uses in production.

## Environment variables (names only — never real values here)

### backend/.env
- `PORT`
- `ALLOWED_ORIGIN`
- `DATABASE_URL`
- `JWT_ACCESS_SECRET`, `JWT_ACCESS_EXPIRES_IN`
- `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN`
- `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
- `LOCATIONIQ_API_KEY` (optional, env-gated)
- `RAPIDAPI_KEY`, `RAPIDAPI_FLIGHTS_HOST`, `RAPIDAPI_TRAINS_HOST`,
  `RAPIDAPI_HOTELS_HOST` (optional, env-gated)

### frontend/.env
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_LOCATIONIQ_API_KEY` (optional, env-gated)
- `NEXT_PUBLIC_RAPIDAPI_KEY`, `NEXT_PUBLIC_RAPIDAPI_FLIGHTS_HOST`,
  `NEXT_PUBLIC_RAPIDAPI_TRAINS_HOST`, `NEXT_PUBLIC_RAPIDAPI_HOTELS_HOST`
  (optional, env-gated)

## External integrations (optional, env-gated)

- **LocationIQ** — address/place autocomplete. If the API key env var is
  unset, the related search UI is hidden/disabled; no crash.
- **RapidAPI** (flights/trains/hotels **search only, no booking**) — mirrors
  how Hala guards these: absent host/key env vars simply disable that search
  panel. Never used to actually book travel.

Both integrations are called from the backend (never expose provider keys to
the browser); the frontend calls the backend, which proxies out only if the
corresponding env vars are configured.

## Backup process

Postgres is the source of truth for all structured data; R2 holds file
bytes. Full recovery requires **both**:

> **R2 application files + PostgreSQL backup together = full recovery.**

Automated backup cycle (runs every **6 hours**):

1. `pg_dump` the production database to a local temp file (custom format,
   `-Fc`).
2. Compress (`gzip`/`zstd`).
3. Encrypt the compressed archive (e.g. `age` or `gpg` with a backup-only
   public key — private key kept offline).
4. Compute and store a checksum (`sha256sum`) alongside the encrypted file.
5. Upload both the encrypted archive and its checksum file to R2, under a
   path convention that includes the canonical project id:
   ```
   r2://errance-backups/ErranceVoyages_Tourism_2026/postgres/YYYY/MM/DD/HHmm.sql.gz.age
   r2://errance-backups/ErranceVoyages_Tourism_2026/postgres/YYYY/MM/DD/HHmm.sql.gz.age.sha256
   ```
6. **Retention policy**: keep all 6-hourly backups for 7 days, then thin to
   one per day for 30 days, then one per month for 12 months. Delete older
   than that unless legally required to retain longer.
7. **Periodic restore test**: monthly, restore the latest backup into a
   scratch database and run a basic integrity check (row counts on core
   tables, a few `SELECT`s against known seed data) — alert if it fails.

R2 application files (everything under the `files` table's `r2_object_key`s)
are backed up by R2's own durability — optionally mirror the bucket to a
second R2 bucket or provider on the same 6-hourly-ish cadence if stronger
guarantees are needed later.

## Restore procedure

1. Identify the desired backup timestamp under
   `r2://errance-backups/ErranceVoyages_Tourism_2026/postgres/...`.
2. Download the `.sql.gz.age` file and its `.sha256` checksum; verify the
   checksum matches before proceeding.
3. Decrypt with the backup private key, decompress.
4. Restore into a **new** target database first (`pg_restore` against a
   scratch DB), verify integrity, then either point the app at the restored
   DB or replay it into production during a maintenance window.
5. Confirm the `files` table's `r2_object_key`s still resolve against the R2
   bucket (R2 files are independent of the Postgres backup cadence — this
   step confirms the *pairing* is intact, not just the DB).
6. Document the restore (what was restored, from when, why) for the incident
   record.

## Deployment process

1. Push to the project's GitHub repo (`main` branch, or a feature branch
   merged into `main`).
2. Coolify is connected to the repo and watches `main`. On push, Coolify
   builds `frontend/Dockerfile` and `backend/Dockerfile` as two separate
   services.
3. Coolify deploys both services to the Hostinger VPS, wiring in the env
   vars listed above (set in the Coolify UI/secrets store — never committed).
4. Coolify's reverse proxy routes `errances.socialmm.in` to the frontend
   container and `api-errances.socialmm.in` to the backend container.
5. Database migrations: for this scaffold, apply `database/schema.sql` (and
   any future incremental changes) manually/via a deploy hook against the
   managed Postgres instance — there is no migration runner wired in yet.

## Background jobs

**Redis/BullMQ: not included initially — add only if bulk-job volume
justifies it.** Candidate future uses: bulk WhatsApp sends, scheduled
follow-up reminders, nightly report pre-computation. Until that volume
exists, everything runs synchronously in NestJS request handlers or via
simple cron-style scheduled scripts (e.g. the 6-hourly backup job above),
which is simpler to operate and debug at this project's current scale.

## Module status

See `README.md` → "What's fully working vs. stubbed." Every stub module's
`*.module.ts` file in `backend/src/modules/` and every stub page in
`frontend/src/app/(protected)/` carries a `TODO` comment citing the exact
`hala-audit/...` path it should be ported from.
