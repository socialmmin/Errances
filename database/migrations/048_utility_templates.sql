-- Shared, Meta-approved utility WhatsApp templates keyed by purpose (payment_reminder, payment_receipt).
CREATE TABLE IF NOT EXISTS utility_templates (
  kind                      text PRIMARY KEY,
  template_id               text,
  template_name             text,
  template_status           text,
  template_rejection_reason text,
  submitted_at              timestamptz,
  checked_at                timestamptz
);
