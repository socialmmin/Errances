-- The evening work report each employee receives on WhatsApp can be switched off per employee.
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_report_enabled boolean NOT NULL DEFAULT true;
