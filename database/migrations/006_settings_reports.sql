-- 006_settings_reports.sql
-- WhatsApp templates + message logs for the Settings > WhatsApp module.
-- Reports and the rest of Settings (branches/roles/users) are computed
-- against tables that already exist — no new tables needed for those.

CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  body_template  text NOT NULL,
  is_active      boolean NOT NULL DEFAULT true,
  branch_id      uuid REFERENCES branches(id),
  is_deleted     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS whatsapp_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_number      text NOT NULL,
  template_id    uuid REFERENCES whatsapp_templates(id),
  template_name  text,
  status         text NOT NULL DEFAULT 'pending',
  sent_at        timestamptz,
  branch_id      uuid REFERENCES branches(id),
  is_deleted     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Write-only WhatsApp Business API configuration. We never store or echo
-- back the actual access token in application responses; this row just
-- tracks whether a configuration has been saved and when.
CREATE TABLE IF NOT EXISTS whatsapp_config (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number_id        text,
  business_account_id    text,
  access_token_encrypted text,
  is_configured          boolean NOT NULL DEFAULT false,
  configured_at          timestamptz,
  configured_by          uuid REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_branch ON whatsapp_templates(branch_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_branch ON whatsapp_logs(branch_id) WHERE is_deleted = false;

INSERT INTO whatsapp_templates (name, body_template, is_active) VALUES
  ('Booking Confirmation', 'Hi {{customer_name}}, your booking with {{company_name}} for {{destination}} on {{travel_date}} ({{guest_count}} guests) is confirmed! Package: {{package_name}}. Your executive {{executive_name}} ({{executive_phone}}) will be in touch.', true),
  ('Payment Reminder', 'Hi {{customer_name}}, this is a reminder that a payment is due for your upcoming trip to {{destination}} on {{travel_date}}. Please contact {{executive_name}} ({{executive_phone}}) to complete your payment. — {{company_name}}', true),
  ('Itinerary Shared', 'Hi {{customer_name}}, your itinerary for {{package_name}} to {{destination}} (travel date {{travel_date}}) has been shared. Reach out to {{executive_name}} at {{executive_phone}} for any questions. — {{company_name}}', true),
  ('Thank You', 'Hi {{customer_name}}, thank you for travelling with {{company_name}}! We hope you enjoyed your trip to {{destination}}. Your executive {{executive_name}} would love to hear your feedback.', true)
ON CONFLICT DO NOTHING;
