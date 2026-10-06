-- Before/after history for the two things managers ask about on a lead: its stage and who it is
-- assigned to. A trigger records every change, whichever screen or automation made it; the API
-- then stamps who did it (changed_by stays NULL for automatic changes).
CREATE TABLE IF NOT EXISTS lead_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  field text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_changes_lead ON lead_changes(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_changes_user ON lead_changes(changed_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_changes_at ON lead_changes(created_at DESC);

CREATE OR REPLACE FUNCTION record_lead_change() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO lead_changes(lead_id, field, old_value, new_value) VALUES (NEW.id, 'status', OLD.status::text, NEW.status::text);
  END IF;
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    INSERT INTO lead_changes(lead_id, field, old_value, new_value) VALUES (NEW.id, 'assigned_to', OLD.assigned_to::text, NEW.assigned_to::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_record_lead_change ON leads;
CREATE TRIGGER trg_record_lead_change AFTER UPDATE OF status, assigned_to ON leads
  FOR EACH ROW EXECUTE FUNCTION record_lead_change();
