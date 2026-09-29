-- The single database-enforced guarantee behind "never send the same itinerary
-- twice": a generated, normalized phone-number column plus a partial unique
-- index. Postgres itself refuses a second non-failed itinerary claim for the
-- same (phone, package) pair -- not application code checking first, which is
-- exactly the race condition that caused repeated duplicate sends.
ALTER TABLE whatsapp_logs
  ADD COLUMN IF NOT EXISTS to_number_norm text GENERATED ALWAYS AS (right(regexp_replace(to_number, '[^0-9]', '', 'g'), 10)) STORED;

-- Historical duplicates already exist (found and reported earlier) -- the new
-- unique index can't be created while they violate it. Soft-delete every
-- non-earliest row in each duplicate group; is_deleted rows are excluded from
-- the index below, so nothing already delivered is lost, only de-duplicated
-- from the constraint's point of view. The earliest row (the one actually
-- delivered first) is always kept as the real record.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY right(regexp_replace(to_number, '[^0-9]', '', 'g'), 10), package_id
    ORDER BY created_at ASC
  ) AS rn
  FROM whatsapp_logs
  WHERE message_type = 'itinerary' AND status NOT IN ('failed', 'test_mode_skipped') AND is_deleted = false AND package_id IS NOT NULL
)
UPDATE whatsapp_logs SET is_deleted = true WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_itinerary_claim
  ON whatsapp_logs (to_number_norm, package_id)
  WHERE message_type = 'itinerary' AND status NOT IN ('failed', 'test_mode_skipped') AND is_deleted = false;

-- Records what actually triggered a send (auto on new lead, backlog, a named
-- agent's manual resend) -- separate from sent_by, which is only the acting
-- user for a manual resend.
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS triggered_by text;
