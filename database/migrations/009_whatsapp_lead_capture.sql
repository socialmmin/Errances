-- 009_whatsapp_lead_capture.sql
-- The inbound WhatsApp bot (008_whatsapp_bot.sql) replies to messages but
-- never created a CRM lead. This adds the attribution/dedup columns needed
-- to upsert a lead per WhatsApp contact, and links each conversation back
-- to the lead it produced.

ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'meta_ads';

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS whatsapp_contact_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_status      text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS campaign_name        text,
  ADD COLUMN IF NOT EXISTS ad_name              text,
  ADD COLUMN IF NOT EXISTS lead_month           int,
  ADD COLUMN IF NOT EXISTS lead_year            int,
  ADD COLUMN IF NOT EXISTS meta_attribution     jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_whatsapp_contact_id
  ON leads(whatsapp_contact_id) WHERE is_deleted = false AND whatsapp_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_whatsapp_number
  ON leads(whatsapp_number) WHERE is_deleted = false AND whatsapp_number IS NOT NULL;

ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES leads(id);
