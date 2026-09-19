# Errances Voyages CRM

A travel-agency CRM: lead pipeline, tour package management, staff/RBAC, and
WhatsApp inbox (both a Baileys WhatsApp-Web bridge and a Twilio WhatsApp API
integration with an automated conversation flow).

## Live deployment

- Frontend: https://errances.socialmm.in
- Backend API: https://api-errances.socialmm.in (health check at `/health`)

Deployed on Coolify (`coolify.socialmm.in`) as two Docker apps plus a managed
PostgreSQL database, behind Cloudflare DNS. See [Deploying](#deploying-coolify--cloudflare)
below for how that's wired up.

## Architecture

```
Browser
  │
  ├── project.socialmm.in / errances.socialmm.in   → static SPA (React + Vite), served by Nginx
  │
  └── api-errances.socialmm.in                      → Node.js + Express + TypeScript API
                                                         ├── PostgreSQL (leads, tours, staff, chat, analytics)
                                                         ├── Socket.IO (realtime chat/lead updates)
                                                         ├── JWT auth + RBAC (bcrypt-hashed passwords)
                                                         ├── Cloudflare R2 (optional; tour image uploads)
                                                         ├── Twilio WhatsApp (send + inbound webhook)
                                                         └── Baileys WhatsApp-Web bridge (QR-linked device)
```

Cloudflare sits in front of both the frontend and API domains for DNS/SSL/WAF.
Both services are deployed as separate Docker apps in Coolify.

This previously ran on Supabase (Postgres + Auth + Realtime + Edge Functions).
It has been fully migrated off Supabase: there is no `@supabase/supabase-js`
dependency anywhere in the repo, and all data lives in a plain PostgreSQL
database owned by the `backend/` service.

## Project layout

- `src/` — React + TypeScript + Vite frontend (unchanged UI/feature set)
- `backend/` — Express + TypeScript API, PostgreSQL access, auth, WhatsApp integrations
- `backend/src/schema.sql` — full Postgres schema (auto-applied on backend boot)
- `Dockerfile`, `nginx.conf` — frontend production image
- `backend/Dockerfile` — backend production image
- `docker-compose.yml` — local full-stack dev (Postgres + backend + frontend)

## Run guide (local development)

### Prerequisites

- Node.js 20+
- A local PostgreSQL server (any recent version) running and reachable

### 1. Create the database

```bash
psql -U postgres -c "CREATE DATABASE errances;"
```

(Use whatever `psql`/user matches your local Postgres install — the backend
only needs an empty database to connect to; it creates all tables itself.)

### 2. Backend

```bash
cd backend
cp .env.example .env      # then edit DATABASE_URL, JWT_SECRET, etc.
npm install
npm run dev                # http://localhost:4000
```

`DATABASE_URL` in `.env` should point at the database from step 1, e.g.
`postgres://postgres:postgres@localhost:5432/errances`. On first boot the
backend creates all tables (from `schema.sql`) and seeds one admin account
from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` in `.env` (defaults:
`admin@errancesvoyages.com` / `Admin@12345` — **change this**). Leave
`ENABLE_BAILEYS=false` unless you actually want to link a WhatsApp Web
session (see below) — with it on, the backend blocks on a QR-code prompt in
its logs.

Check it came up: `curl http://localhost:4000/health` → `{"ok":true}`.

### 3. Frontend

In a second terminal, from the repo root:

```bash
npm install
npm run dev                 # http://localhost:5173
```

`vite.config.ts` proxies `/api` and `/socket.io` to `http://localhost:4000` in
dev, so you don't need to set `VITE_API_URL` locally. Open
http://localhost:5173 and log in with the seeded admin account above.

### Troubleshooting

- **`EADDRINUSE` on port 4000 or 5173** — something (maybe an earlier `npm run
  dev` you forgot about) is already listening there. Either reuse it (check
  `curl http://localhost:4000/health`) or stop it before starting a new one.
- **Login fails / data doesn't load** — check the backend terminal for
  `[db] schema ensured` and `[server] listening on port 4000`; if it's stuck
  on Baileys' QR prompt, set `ENABLE_BAILEYS=false` and restart.

### 4. Optional integrations

- **Twilio WhatsApp**: set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_WHATSAPP_NUMBER` in `backend/.env`. Point your Twilio WhatsApp
  sender's webhook at `POST https://<api-domain>/api/webhooks/twilio`.
- **Baileys (WhatsApp Web bridge)**: enabled by default
  (`ENABLE_BAILEYS=true`). On first run it prints a QR code in the backend
  logs — scan it from WhatsApp on your phone (Linked Devices) to connect.
  Session data is persisted to `backend/auth_info_baileys/` (gitignored).
- **Cloudflare R2**: set the `R2_*` vars in `backend/.env` to enable real file
  storage for tour images via `POST /api/upload`. If left blank, uploads fall
  back to the original behaviour (compressed image stored as a base64 data
  URL), so this is optional.

## Deploying (Coolify + Cloudflare)

This is already deployed and live (see [Live deployment](#live-deployment)
above). Current setup, for reference/rebuilding:

- **Coolify project**: "Errances Voyages" (`coolify.socialmm.in`), `production`
  environment, on the default `localhost` server.
- **`errances-backend`** app — build pack `dockerfile`, base directory
  `/backend`, `dockerfile_location` `/Dockerfile`, port `4000`, domain
  `https://api-errances.socialmm.in`. Env vars set from `backend/.env.example`
  (strong `JWT_SECRET`, the managed Postgres's internal connection string as
  `DATABASE_URL`, seed admin creds, `ENABLE_BAILEYS=false`, Twilio/R2 left
  blank until real credentials exist).
- **`errances-frontend`** app — build pack `dockerfile`, root `Dockerfile`,
  port `80`, domain `https://errances.socialmm.in`. Build-time env var
  `VITE_API_URL=https://api-errances.socialmm.in` (Vite bakes this in at
  build time, so it has to be set before building, not just at runtime).
- **`errances-postgres`** — a Coolify-managed standalone PostgreSQL database
  in the same project/environment; the backend connects to it over the
  internal Docker network. Schema is created automatically on first boot.
- **Cloudflare DNS**: proxied `A` records for both `errances.socialmm.in` and
  `api-errances.socialmm.in` pointing at the Coolify host, in the
  `socialmm.in` zone.

To redeploy after pushing new commits to `main`, trigger a deployment for
each app from the Coolify dashboard (or `POST /api/v1/deploy?uuid=<app-uuid>`
against the Coolify API).

Still to wire up, since no real credentials existed for these at build time:

- **Twilio WhatsApp** — set `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` /
  `TWILIO_WHATSAPP_NUMBER` on `errances-backend`, then point that Twilio
  number's webhook at `https://api-errances.socialmm.in/api/webhooks/twilio`.
- **Baileys WhatsApp-Web bridge** — flip `ENABLE_BAILEYS` to `true` and
  redeploy, then check the backend's Coolify logs for a QR code to scan. Mount
  a persistent volume at `/app/auth_info_baileys` first (see
  `docker-compose.yml`'s local example) so the session survives redeploys.
- **Cloudflare R2** — add the `R2_*` env vars for real file storage on tour
  images; without them, uploads fall back to storing a compressed image as a
  base64 data URL, same as before the migration.

## Environment variables

See `backend/.env.example` for the full backend list, and `.env` (root) for
the single frontend variable (`VITE_API_URL`).
