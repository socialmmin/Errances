-- Remembers that the "follow-up is due now" push was sent, so it goes out once per follow-up.
ALTER TABLE lead_follow_ups ADD COLUMN IF NOT EXISTS due_alerted_at timestamptz;
-- Everything already overdue when this ships is not alerted again.
UPDATE lead_follow_ups SET due_alerted_at = now() WHERE due_alerted_at IS NULL AND due_at < now();
