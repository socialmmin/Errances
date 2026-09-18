# Errances Voyages CRM

A travel-agency CRM: lead pipeline, tour package management, staff/RBAC, and
WhatsApp inbox (both a Baileys WhatsApp-Web bridge and a Twilio WhatsApp API
integration with an automated conversation flow).

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

## Local development

### 1. Backend

```bash
cd backend
cp .env.example .env      # edit DATABASE_URL, JWT_SECRET, etc.
npm install
npm run dev                # http://localhost:4000
```

On first boot the backend creates all tables (from `schema.sql`) and seeds one
admin account from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` in `.env`
(defaults: `admin@errancesvoyages.com` / `Admin@12345` — **change this**).

### 2. Frontend

```bash
npm install
npm run dev                 # http://localhost:5173
```

`vite.config.ts` proxies `/api` and `/socket.io` to `http://localhost:4000` in
dev, so you don't need to set `VITE_API_URL` locally.

### 3. Optional integrations

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

1. Push this repo to your GitHub remote.
2. In Coolify, create **two** applications from that repo:
   - **Backend**: Dockerfile = `backend/Dockerfile`, build context =
     `backend/`. Set all vars from `backend/.env.example` (a strong
     `JWT_SECRET`, real `DATABASE_URL` pointing at your Postgres instance,
     Twilio/R2 credentials, etc). Expose port `4000`. Point the domain
     `api-errances.socialmm.in` at it.
   - **Frontend**: Dockerfile = `Dockerfile` (repo root). Set the build
     argument `VITE_API_URL=https://api-errances.socialmm.in` (Vite bakes
     this in at build time, so it must be set before building, not just as a
     runtime env var). Expose port `80`. Point the domain
     `errances.socialmm.in` at it.
3. Provision a PostgreSQL database (Coolify can host one, or use any managed
   Postgres) and set the backend's `DATABASE_URL` to it. The schema is
   created automatically on first boot — no manual migration step needed.
4. In Cloudflare DNS, create/point the two hostnames above at Coolify's
   ingress (proxied, so Cloudflare's SSL/WAF/DDoS protection applies).
5. If you use the Baileys bridge in production, mount a persistent volume at
   `/app/auth_info_baileys` on the backend service (already set up in
   `docker-compose.yml`'s local example) so the WhatsApp session survives
   redeploys — otherwise you'll need to re-scan the QR code every deploy.

I did not run any live Coolify/Cloudflare API calls as part of this build —
the steps above are what to run once the repo is pushed to your GitHub
remote, since Coolify deploys from git and there's nothing to point it at
yet.

## Environment variables

See `backend/.env.example` for the full backend list, and `.env` (root) for
the single frontend variable (`VITE_API_URL`).
