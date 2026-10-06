-- One shared, Meta-approved "payment reminder" WhatsApp template (see finance.service.ts).
CREATE TABLE IF NOT EXISTS payment_reminder_template_settings (
  id                        boolean PRIMARY KEY DEFAULT true CHECK (id),
  template_id               text,
  template_name             text,
  template_status           text,
  template_rejection_reason text,
  submitted_at              timestamptz,
  checked_at                timestamptz
);
