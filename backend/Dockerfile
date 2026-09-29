# ErranceVoyages_Tourism_2026 — backend Dockerfile
# Build context is the REPOSITORY ROOT (Coolify: base directory "/", Dockerfile "/backend/Dockerfile"),
# so the SQL in database/ ships with the image and the bootstrap script can create/migrate the DB on start.
# Multi-stage build: NestJS build -> slim node:20-alpine runtime.

FROM node:20-alpine AS builder
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --include=dev
COPY backend/ .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
# poppler-utils: pdftoppm renders page 1 of an itinerary PDF to the cover picture shown in the CRM Inbox
RUN apk add --no-cache poppler-utils
ENV NODE_ENV=production
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY backend/scripts ./scripts
COPY database ./database
EXPOSE 4000
# bootstrap-db.js creates/migrates/seeds the database (idempotent), then the API starts.
CMD ["sh", "-c", "node scripts/bootstrap-db.js && node dist/main.js"]
