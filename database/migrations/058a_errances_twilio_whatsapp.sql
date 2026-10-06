-- Errances: WhatsApp goes through Twilio. Twilio sends buttons, lists and approved templates by
-- "Content SID"; this remembers which Content serves which message layout (session:<shape>) or
-- CRM template (template:<name>), so each is created once and reused.
CREATE TABLE IF NOT EXISTS twilio_contents (
  key text PRIMARY KEY,
  content_sid text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
