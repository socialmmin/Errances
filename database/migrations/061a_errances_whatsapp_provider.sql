-- Errances: WhatsApp can run through Twilio or through Meta's own Cloud API, switched in Settings.

-- Which of the two is on. Starts as 'twilio' (what is live today).
ALTER TABLE whatsapp_automation_settings
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'twilio';

-- A bulk send belongs to the provider it was started with: its template only exists there.
ALTER TABLE whatsapp_broadcasts
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'twilio',
  ADD COLUMN IF NOT EXISTS template_language text;

-- Templates written on the Bulk WhatsApp page while Meta is the provider: marks them as ours (so
-- they can be deleted there) and remembers the image or PDF that goes above the message, which
-- Meta wants sent again with every message.
CREATE TABLE IF NOT EXISTS meta_templates_local (
  name              text NOT NULL,
  language          text NOT NULL,
  template_id       text,
  header_format     text,
  header_object_key text,
  header_filename   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (name, language)
);
