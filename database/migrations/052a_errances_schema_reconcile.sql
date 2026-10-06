-- Errances: tables and columns the synced CRM code relies on but that the upstream repository never
-- defined in SQL (they were created by hand on the upstream server). Without them the API cannot start
-- (053 alters daily_report_settings) and follow-ups, quotations, invoices from quotations, extra
-- itinerary PDFs and the daily report fail. Named 052a so it runs after 052 and before 053.
-- Additive and idempotent: IF NOT EXISTS / ON CONFLICT everywhere; nothing is dropped or rewritten,
-- and the only UPDATE fills the new invoices.quotation_id column.

-- Audit trail (login attempts, denied access, money/role/user changes). Written fire-and-forget.
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  branch_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  result text NOT NULL,
  request_id text,
  ip text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_action ON audit_logs (user_id, action, created_at);

-- Daily WhatsApp owner report: one settings row (id = true) that the app only ever UPDATEs, so the
-- row must exist. included_sections NULL means every section; empty send_times falls back to send_hour/minute.
CREATE TABLE IF NOT EXISTS daily_report_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  phone_numbers jsonb NOT NULL DEFAULT '[]'::jsonb,
  send_times jsonb,
  send_hour integer NOT NULL DEFAULT 20,
  send_minute integer NOT NULL DEFAULT 0,
  included_sections jsonb,
  template_id text,
  template_name text,
  template_status text,
  template_rejection_reason text,
  last_sent_date text,
  last_sent_slot text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO daily_report_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- Extra itinerary PDFs for a package (other durations), each with its own WhatsApp template.
CREATE TABLE IF NOT EXISTS package_itinerary_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  duration_days integer,
  duration_nights integer,
  object_key text,
  file_name text,
  whatsapp_template_id text,
  whatsapp_template_name text,
  whatsapp_template_status text DEFAULT 'NOT_SUBMITTED',
  whatsapp_template_rejection_reason text,
  whatsapp_template_submitted_at timestamptz,
  whatsapp_template_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_package_itinerary_documents_package ON package_itinerary_documents (package_id, sort_order);

-- Which extra document went to which number; the unique pair is what makes ON CONFLICT DO NOTHING
-- stop a document being sent to the same person twice.
CREATE TABLE IF NOT EXISTS package_document_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES package_itinerary_documents(id) ON DELETE CASCADE,
  to_number text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, to_number)
);

-- Reusable quotation line items, per category (soft-deleted).
CREATE TABLE IF NOT EXISTS quotation_item_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  label text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quotation_item_suggestions_category ON quotation_item_suggestions (category) WHERE is_deleted = false;

-- WhatsApp template used to send quotations: one row (id = true) that the app upserts.
CREATE TABLE IF NOT EXISTS quotation_template_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  template_id text,
  template_name text,
  template_status text,
  template_rejection_reason text,
  submitted_at timestamptz,
  checked_at timestamptz
);

-- Invoices are now reached through their quotation. Invoices created earlier from a booking get the
-- booking's quotation, so they keep showing on Payment Reminders and the work board.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS quotation_id uuid REFERENCES quotations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_quotation ON invoices (quotation_id);
UPDATE invoices i SET quotation_id = b.quotation_id
  FROM bookings b
 WHERE b.id = i.booking_id AND i.quotation_id IS NULL AND b.quotation_id IS NOT NULL;

ALTER TABLE lead_follow_ups ADD COLUMN IF NOT EXISTS follow_up_type text;
ALTER TABLE lead_follow_ups ADD COLUMN IF NOT EXISTS priority text;

ALTER TABLE quotations ADD COLUMN IF NOT EXISTS infants integer NOT NULL DEFAULT 0;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS signature_data text;

-- Automatic pause of an itinerary's WhatsApp sends while Meta stops confirming delivery.
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS auto_paused boolean NOT NULL DEFAULT false;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS auto_paused_at timestamptz;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS auto_pause_count integer NOT NULL DEFAULT 0;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS auto_pause_window_started_at timestamptz;
