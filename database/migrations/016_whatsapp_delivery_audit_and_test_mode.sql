ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS message_id text;
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS package_id uuid REFERENCES tour_packages(id) ON DELETE SET NULL;
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'template';
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS error_message text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_logs_message_id ON whatsapp_logs(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_lead ON whatsapp_logs(lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_automation_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  live_mode boolean NOT NULL DEFAULT false,
  test_numbers text[] NOT NULL DEFAULT ARRAY['917338914677','917358723600','919944946955']::text[],
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);
INSERT INTO whatsapp_automation_settings(id) VALUES(true) ON CONFLICT(id) DO NOTHING;
