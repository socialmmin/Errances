-- 007_meta_lead_ads.sql
-- Idempotency tracking for Meta (Facebook/Instagram) Lead Ads webhook
-- ingestion. Meta retries webhook deliveries, so we record each
-- leadgen_id once and skip re-processing on retry.

CREATE TABLE IF NOT EXISTS meta_lead_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leadgen_id   text NOT NULL UNIQUE,
  lead_id      uuid REFERENCES leads(id),
  form_name    text,
  ad_name      text,
  raw_payload  jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
