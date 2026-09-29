-- Auto-mark a lead's actual Status (not just the Good/Neutral/Bad overlay) when it is a
-- no-number / invalid-number / duplicate-number scenario. Only touches leads still at 'new'
-- (never overrides a lead someone has already started working), and never fires if the team
-- set quality_override by hand.

CREATE OR REPLACE FUNCTION fn_automark_lead_status() RETURNS trigger AS $$
DECLARE
  digits text;
  dup boolean;
BEGIN
  IF NEW.status::text <> 'new' OR NEW.quality_override IS NOT NULL THEN RETURN NEW; END IF;
  digits := regexp_replace(COALESCE(NULLIF(NEW.whatsapp_number,''), NULLIF(NEW.phone,''), ''), '[^0-9]', '', 'g');

  IF NOT (digits ~ '^(91|0)?[6-9][0-9]{9}$' OR (length(digits) BETWEEN 11 AND 15 AND digits !~ '^91[0-9]{10}$')) THEN
    NEW.status := 'invalid_number';
    NEW.lost_reason := COALESCE(NEW.lost_reason, 'No phone / invalid number');
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM leads o WHERE o.is_deleted = false AND o.id <> NEW.id AND o.created_at < NEW.created_at
      AND length(digits) >= 10
      AND right(regexp_replace(COALESCE(NULLIF(o.whatsapp_number,''), NULLIF(o.phone,''), ''), '[^0-9]', '', 'g'), 10) = right(digits, 10)
  ) INTO dup;
  IF dup THEN
    NEW.status := 'duplicate';
    NEW.lost_reason := COALESCE(NEW.lost_reason, 'Duplicate');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_automark_lead_status_ins ON leads;
CREATE TRIGGER trg_automark_lead_status_ins BEFORE INSERT ON leads FOR EACH ROW EXECUTE FUNCTION fn_automark_lead_status();

DROP TRIGGER IF EXISTS trg_automark_lead_status_upd ON leads;
CREATE TRIGGER trg_automark_lead_status_upd BEFORE UPDATE OF phone, whatsapp_number ON leads FOR EACH ROW EXECUTE FUNCTION fn_automark_lead_status();

-- One-time backfill: existing leads still sitting at 'new' that are actually no-number/invalid/duplicate.
UPDATE leads l SET status = 'invalid_number', lost_reason = COALESCE(l.lost_reason, 'No phone / invalid number'), updated_at = now()
WHERE l.is_deleted = false AND l.status::text = 'new' AND l.quality_override IS NULL
  AND NOT (
    regexp_replace(COALESCE(NULLIF(l.whatsapp_number,''), NULLIF(l.phone,''), ''), '[^0-9]', '', 'g') ~ '^(91|0)?[6-9][0-9]{9}$'
    OR (length(regexp_replace(COALESCE(NULLIF(l.whatsapp_number,''), NULLIF(l.phone,''), ''), '[^0-9]', '', 'g')) BETWEEN 11 AND 15
        AND regexp_replace(COALESCE(NULLIF(l.whatsapp_number,''), NULLIF(l.phone,''), ''), '[^0-9]', '', 'g') !~ '^91[0-9]{10}$')
  );

UPDATE leads l SET status = 'duplicate', lost_reason = COALESCE(l.lost_reason, 'Duplicate'), updated_at = now()
WHERE l.is_deleted = false AND l.status::text = 'new' AND l.quality_override IS NULL
  AND length(regexp_replace(COALESCE(NULLIF(l.whatsapp_number,''), NULLIF(l.phone,''), ''), '[^0-9]', '', 'g')) >= 10
  AND EXISTS (
    SELECT 1 FROM leads o WHERE o.is_deleted = false AND o.id <> l.id AND o.created_at < l.created_at
      AND right(regexp_replace(COALESCE(NULLIF(o.whatsapp_number,''), NULLIF(o.phone,''), ''), '[^0-9]', '', 'g'), 10)
        = right(regexp_replace(COALESCE(NULLIF(l.whatsapp_number,''), NULLIF(l.phone,''), ''), '[^0-9]', '', 'g'), 10)
  );
