ALTER TABLE whatsapp_automation_settings
  ADD COLUMN IF NOT EXISTS itinerary_template_id text,
  ADD COLUMN IF NOT EXISTS itinerary_template_name text,
  ADD COLUMN IF NOT EXISTS itinerary_template_status text NOT NULL DEFAULT 'NOT_SUBMITTED',
  ADD COLUMN IF NOT EXISTS itinerary_template_rejection_reason text,
  ADD COLUMN IF NOT EXISTS itinerary_template_checked_at timestamptz;
