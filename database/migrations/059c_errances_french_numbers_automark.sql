-- Errances: the automatic "invalid number" / "duplicate" marking (042) knew Indian numbers only.
-- A French mobile typed the usual way (06 12 34 56 78 -- ten digits starting with 0) was marked
-- invalid, and the same person saved once as 06 12 34 56 78 and once as +33 6 12 34 56 78 was not
-- seen as a duplicate. This replaces the function only: no existing lead is changed.

CREATE OR REPLACE FUNCTION fn_automark_lead_status() RETURNS trigger AS $$
DECLARE
  digits text;
  dup boolean;
BEGIN
  IF NEW.status::text <> 'new' OR NEW.quality_override IS NOT NULL THEN RETURN NEW; END IF;
  digits := regexp_replace(COALESCE(NULLIF(NEW.whatsapp_number,''), NULLIF(NEW.phone,''), ''), '[^0-9]', '', 'g');

  IF NOT (digits ~ '^(91|0)?[6-9][0-9]{9}$'
          OR digits ~ '^0[1-9][0-9]{8}$'
          OR (length(digits) BETWEEN 11 AND 15 AND digits !~ '^91[0-9]{10}$')) THEN
    NEW.status := 'invalid_number';
    NEW.lost_reason := COALESCE(NEW.lost_reason, 'No phone / invalid number');
    RETURN NEW;
  END IF;

  -- Last nine digits: the part 06 12 34 56 78 and +33 6 12 34 56 78 have in common.
  SELECT EXISTS (
    SELECT 1 FROM leads o WHERE o.is_deleted = false AND o.id <> NEW.id AND o.created_at < NEW.created_at
      AND length(digits) >= 10
      AND right(regexp_replace(COALESCE(NULLIF(o.whatsapp_number,''), NULLIF(o.phone,''), ''), '[^0-9]', '', 'g'), 9) = right(digits, 9)
  ) INTO dup;
  IF dup THEN
    NEW.status := 'duplicate';
    NEW.lost_reason := COALESCE(NEW.lost_reason, 'Duplicate');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
