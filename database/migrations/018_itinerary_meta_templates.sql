ALTER TABLE tour_packages
  ADD COLUMN IF NOT EXISTS whatsapp_template_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_template_name text,
  ADD COLUMN IF NOT EXISTS whatsapp_template_status text NOT NULL DEFAULT 'NOT_SUBMITTED',
  ADD COLUMN IF NOT EXISTS whatsapp_template_rejection_reason text,
  ADD COLUMN IF NOT EXISTS whatsapp_template_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_template_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tour_packages_whatsapp_template_status
  ON tour_packages (whatsapp_template_status)
  WHERE is_deleted = false;
