-- The daily WhatsApp report's new layout (today's work, needs attention, team activity) is a
-- separate Meta template. The first one keeps sending until this one is approved.
ALTER TABLE daily_report_settings ADD COLUMN IF NOT EXISTS layout2_template_id text;
ALTER TABLE daily_report_settings ADD COLUMN IF NOT EXISTS layout2_template_name text;
ALTER TABLE daily_report_settings ADD COLUMN IF NOT EXISTS layout2_status text;
ALTER TABLE daily_report_settings ADD COLUMN IF NOT EXISTS layout2_rejection text;
