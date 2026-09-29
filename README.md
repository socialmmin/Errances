# Errances Voyages — Tourism CRM

Canonical project id: **`ErranceVoyages_Tourism_2026`**
Owner/dev identifier: **`SocialMM_ErranceVoyages`**

A tourism ERP/CRM for Errances Voyages, scaffolded from the module structure and
RBAC model of the reference project "Hala," but rebuilt on a different stack:
Next.js + NestJS + raw Postgres (no Supabase, no ORM). See `ARCHITECTURE.md` for
the full system design.

## Stack

- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind + ShadCN-style UI
  + TanStack Query/Table + Zustand. Navy (`#0F172A`) + gold (`#F59E0B`) theme,
  dark/light aware.
- **Backend**: NestJS + the raw `pg` driver in a repository pattern (explicitly
  no Prisma/ORM/Supabase). JWT auth (access + refresh) with bcrypt password
  hashing. Static role→permission RBAC guard.
- **Database**: PostgreSQL, one consolidated schema (see below).
- **File storage**: Cloudflare R2 (S3-compatible) via `@aws-sdk/client-s3`,
  presigned uploads; Postgres stores only file metadata.
- **No Redis/BullMQ initially** — see `ARCHITECTURE.md` for when to add it.

## Database convention

`database/schema.sql` is **one consolidated schema file**, not a migration
replay. It was derived from the reference project's 30 sequential migrations
(`hala-audit/supabase/migrations/00001_complete_schema.sql` through `00030_*`)
by folding every table shape into a single, current-state DDL file — with
Supabase Row Level Security policies, `auth.uid()`, and GoTrue `auth.*` schema
references stripped out, since this project does its own auth in NestJS.

`database/seed.sql` bootstraps one branch, all 11 roles (with their
permission arrays), and one `super_admin` user for local/dev login.

Conventions carried over from the reference project:
- `branch_id` on every business table (multi-branch scoping)
- soft-delete via `is_deleted` boolean — **rows are never hard-deleted**
- `created_at` / `updated_at` / `created_by` audit columns on every table
- money stored as `bigint` in minor units (e.g. paise) — divide by 100 to display
- all timestamps stored UTC (`timestamptz`)

To apply the schema against a fresh Postgres database:

```bash
psql "$DATABASE_URL" -f database/schema.sql      # base tables
for f in database/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done   # REQUIRED: brings the schema up to date, in filename order
psql "$DATABASE_URL" -f database/seed.sql
```

`schema.sql` alone is **not** complete: the numbered files in `database/migrations/`
add the WhatsApp, Meta, follow-up and settings tables the backend needs, so always
run them (in order) before `seed.sql`.

The seeded super_admin login is `admin@errance.example` / `ChangeMe123!`
(bcrypt-hashed placeholder — **rotate immediately** after first login in any
real deployment; see the comment at the top of `database/seed.sql` for how to
generate a fresh hash).

## Running locally

### Option A — Docker Compose (Postgres + backend + frontend together)

```bash
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend: http://localhost:4000/api (health check: http://localhost:4000/api/health)
- Postgres: localhost:5432 (schema.sql + seed.sql are auto-applied on first boot)

### Option B — Run services individually

```bash
# 1. Postgres (any local instance works — create the DB, then:)
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/seed.sql

# 2. Backend
cd backend
cp .env.example .env   # fill in DATABASE_URL etc.
npm install
npm run start:dev      # http://localhost:4000

# 3. Frontend
cd frontend
cp .env.example .env   # NEXT_PUBLIC_API_URL=http://localhost:4000/api
npm install
npm run dev             # http://localhost:3000
```

Log in with the seeded super_admin credentials above.

## What's fully working vs. stubbed

- **Leads** and **Customers**: full CRUD end-to-end — Next.js DataTable list
  view, create/edit forms, detail view, soft-delete — calling real NestJS
  endpoints backed by real SQL (`backend/src/modules/leads`,
  `backend/src/modules/customers`).
- Every other module (Packages, Quotations, Bookings, Finance, Vendors,
  Reports, Tasks, Settings) is a routed page + backend controller with a
  `TODO` comment citing the exact Hala module/file to port from. See
  `ARCHITECTURE.md` and the comments in each module's `*.module.ts` file.

## Theme

Premium red-and-white design: white surfaces, charcoal text, brand red `#D91E2A`.
The palette lives in `frontend/tailwind.config.ts` — the token names `navy`
(charcoal neutrals) and `gold` (the red brand scale) are kept from the original
project so every component picks the palette up from one place. Hero banners
(`from-navy…` gradients) and the shared `DataTable` header render in brand red;
see the bottom of `frontend/src/app/globals.css`.

The logo is the **company logo** uploaded in *Settings → Company profile* (it is
stored in `company_settings.logo_url` and used in the sidebar, login page and as the
favicon). Until one is uploaded the app shows a placeholder plane icon.

## Languages (English / French)

Every user-facing string goes through one centralised system in `frontend/src/i18n/`:

- `tr("English text")` — use it for any visible text (JSX text, `placeholder`, `title`,
  toasts, confirm dialogs). The English text is the key; `tr("Hello {name}", { name })`
  fills placeholders. Import: `import { tr } from '@/i18n';`.
- `fr/part*.ts` (merged by `fr-text.ts`) hold the French translations. A string
  with no French entry falls back to English, so nothing breaks while it is missing.
- `npm run i18n:check` (in `frontend/`) lists every `tr()` string that still lacks a
  French translation — run it before every release; it exits 1 when something is missing.
- `en.ts` / `fr.ts` hold a few typed keys (`t('nav.dashboard')` via `useT()`), used by
  the navigation shell and login.
- The switcher (header, login page, mobile menu) stores the choice in `localStorage`
  (`errance-lang`); switching re-renders the app without a browser reload and
  the API client sends `Accept-Language`. Dates, numbers and currency follow the
  active language via `locale()` — never hardcode `'en-IN'`.
- Backend: `backend/src/common/i18n/` translates error messages (validation errors
  and the `NotFoundException`/`BadRequestException` texts) when the request has
  `Accept-Language: fr`. Add new messages to `messages-fr.ts`.
- Not translated on purpose: database identifiers, API keys, enum values sent to the
  API, user-generated content (names, notes, package titles) and city/destination names.

## Architecture, deployment, backups

See `ARCHITECTURE.md` for: project identity, domain placeholders, the
frontend/backend/DB/R2/Coolify/Docker layout, environment variable names
(never real values), the GitHub → Coolify → Docker → Hostinger deployment
pipeline, and the full backup/restore process (6-hourly encrypted `pg_dump`
backups to R2, with a retention policy and periodic restore test).

**No Redis or BullMQ** are included in this scaffold. If bulk WhatsApp
sending or scheduled-job volume grows enough to justify a queue, add
BullMQ + Redis at that point — see `ARCHITECTURE.md`.
