-- Errances sells flight tickets, visas and holiday packages. What each lead is about, and what
-- each WhatsApp promo is about, so the WhatsApp questions fit (no "family or friends?" for a
-- ticket) and bulk sends can target people by what they asked for.

-- ticket | visa | package | other (null = not known yet)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS service_type text;

-- The service a promo template is about, remembered per template name (set on the Bulk WhatsApp page).
CREATE TABLE IF NOT EXISTS whatsapp_template_services (
  template_name text PRIMARY KEY,
  service       text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE whatsapp_broadcasts ADD COLUMN IF NOT EXISTS service text;
