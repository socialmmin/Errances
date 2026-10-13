-- Errances: date of birth and passport details on a lead, and WhatsApp birthday greetings.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS date_of_birth    date,
  ADD COLUMN IF NOT EXISTS passport_number  text,
  ADD COLUMN IF NOT EXISTS passport_expiry  date,
  ADD COLUMN IF NOT EXISTS passport_country text;

-- On by default; switched off on the Bulk WhatsApp page.
ALTER TABLE whatsapp_automation_settings
  ADD COLUMN IF NOT EXISTS birthday_greetings boolean NOT NULL DEFAULT true;

-- One greeting per number per year, whatever happens (restarts, a lead saved twice).
CREATE TABLE IF NOT EXISTS birthday_greetings (
  id          bigserial PRIMARY KEY,
  lead_id     uuid REFERENCES leads(id) ON DELETE SET NULL,
  phone       text NOT NULL,
  year        integer NOT NULL,
  -- sent | failed | skipped
  status      text NOT NULL,
  error       text,
  message_sid text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (phone, year)
);
