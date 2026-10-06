-- Trash: when a record is deleted (is_deleted flips to true) remember when, so Settings > Trash
-- can list it, count down 60 days and restore it. A trigger keeps deleted_at right whichever
-- screen did the delete or the restore.
CREATE OR REPLACE FUNCTION stamp_deleted_at() RETURNS trigger AS $$
BEGIN
  IF NEW.is_deleted AND NOT COALESCE(OLD.is_deleted, false) THEN NEW.deleted_at := now();
  ELSIF NOT NEW.is_deleted AND COALESCE(OLD.is_deleted, false) THEN NEW.deleted_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leads','quotations','invoices','tour_packages','customers','bookings','users','vendors','tasks'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_at timestamptz', t);
    EXECUTE format('UPDATE %I SET deleted_at = COALESCE(updated_at, now()) WHERE is_deleted = true AND deleted_at IS NULL', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_stamp_deleted_at ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_stamp_deleted_at BEFORE UPDATE OF is_deleted ON %I FOR EACH ROW EXECUTE FUNCTION stamp_deleted_at()', t);
  END LOOP;
END $$;
