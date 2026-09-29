-- Meta lead quality + conversion feedback.
-- (ALTER TYPE ... ADD VALUE cannot run inside a transaction block: run this file with psql autocommit.)

ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'interested';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'advance_paid';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'just_checking';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'invalid_number';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'wrong_number';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'duplicate';

-- Meta identity of every Meta lead, as real columns (previously only inside a raw log).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_leadgen_id text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_campaign_id text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_adset_id text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_adset_name text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_ad_id text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_form_id text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_form_name text;
-- Manual override of the automatic quality (NULL = automatic).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS quality_override text;
DO $$ BEGIN
  ALTER TABLE leads ADD CONSTRAINT leads_quality_override_chk CHECK (quality_override IS NULL OR quality_override IN ('GOOD','NEUTRAL','BAD'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_leads_meta_leadgen ON leads(meta_leadgen_id) WHERE meta_leadgen_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_meta_campaign ON leads(meta_campaign_id) WHERE meta_campaign_id IS NOT NULL;

-- Backfill from what Meta already sent us.
UPDATE leads l SET
  meta_leadgen_id = COALESCE(l.meta_leadgen_id, e.leadgen_id),
  meta_campaign_id = COALESCE(l.meta_campaign_id, e.raw_payload->>'campaign_id'),
  meta_adset_name = COALESCE(l.meta_adset_name, e.raw_payload->>'adset_name'),
  meta_ad_id = COALESCE(l.meta_ad_id, e.raw_payload->>'ad_id'),
  meta_form_id = COALESCE(l.meta_form_id, e.raw_payload->>'form_id'),
  meta_form_name = COALESCE(l.meta_form_name, e.form_name)
FROM meta_lead_events e WHERE e.lead_id = l.id;

-- Which CRM outcomes are queued/sent to Meta (one event of each kind per lead).
CREATE TABLE IF NOT EXISTS meta_conversion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  event_time timestamptz NOT NULL DEFAULT now(),
  value numeric,
  status text NOT NULL DEFAULT 'pending',      -- pending | sent | test_sent | failed | skipped
  attempts int NOT NULL DEFAULT 0,
  response text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, event_name)
);
CREATE INDEX IF NOT EXISTS idx_meta_conv_pending ON meta_conversion_events(status) WHERE status = 'pending';

-- Sending is OFF until someone turns it on (off | test | live).
CREATE TABLE IF NOT EXISTS meta_capi_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  mode text NOT NULL DEFAULT 'off' CHECK (mode IN ('off','test','live')),
  dataset_id text,
  test_event_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO meta_capi_settings (id, dataset_id) VALUES (true, '1386248076982327') ON CONFLICT (id) DO NOTHING;

-- Queue an outcome whenever a Meta lead reaches a conversion status. Any code path that changes status is covered.
CREATE OR REPLACE FUNCTION fn_queue_meta_event() RETURNS trigger AS $$
DECLARE ev text;
BEGIN
  IF NEW.meta_leadgen_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  ev := CASE NEW.status::text
    WHEN 'qualified' THEN 'Qualified'
    WHEN 'quotation_sent' THEN 'QuotationSent'
    WHEN 'advance_paid' THEN 'AdvancePaid'
    WHEN 'booking_confirmed' THEN 'Booked'
    WHEN 'won' THEN 'Booked'
    ELSE NULL END;
  IF ev IS NOT NULL THEN
    INSERT INTO meta_conversion_events (lead_id, event_name) VALUES (NEW.id, ev) ON CONFLICT (lead_id, event_name) DO NOTHING;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_queue_meta_event ON leads;
CREATE TRIGGER trg_queue_meta_event AFTER UPDATE OF status ON leads FOR EACH ROW EXECUTE FUNCTION fn_queue_meta_event();

-- Automatic quality: GOOD / NEUTRAL / BAD, with the reason. A manual override always wins.
CREATE OR REPLACE VIEW lead_quality_v AS
WITH base AS (
  SELECT l.id AS lead_id, l.status::text AS status, l.quality_override,
         regexp_replace(COALESCE(NULLIF(l.whatsapp_number,''), NULLIF(l.phone,''), ''), '[^0-9]', '', 'g') AS digits,
         l.created_at
    FROM leads l WHERE l.is_deleted = false
)
SELECT b.lead_id,
  CASE
    WHEN b.quality_override IS NOT NULL THEN b.quality_override
    WHEN b.status IN ('qualified','quotation_sent','advance_paid','booking_confirmed','won') THEN 'GOOD'
    WHEN b.status IN ('invalid_number','wrong_number','duplicate','no_response','just_checking','not_interested','lost') THEN 'BAD'
    WHEN NOT (b.digits ~ '^(91|0)?[6-9][0-9]{9}$' OR (length(b.digits) BETWEEN 11 AND 15 AND b.digits !~ '^91[0-9]{10}$')) THEN 'BAD'
    WHEN EXISTS (SELECT 1 FROM leads o WHERE o.is_deleted = false AND o.id <> b.lead_id AND o.created_at < b.created_at AND length(b.digits) >= 10
                   AND right(regexp_replace(COALESCE(NULLIF(o.whatsapp_number,''), NULLIF(o.phone,''), ''), '[^0-9]', '', 'g'), 10) = right(b.digits, 10)) THEN 'BAD'
    WHEN (SELECT count(*) FROM lead_follow_ups f WHERE f.lead_id = b.lead_id AND f.status = 'done' AND f.outcome ~* '(no answer|not reachable|no response|not picking|switched off|busy)') >= 3
         AND (SELECT min(f.created_at) FROM lead_follow_ups f WHERE f.lead_id = b.lead_id) < now() - interval '7 days'
         AND NOT EXISTS (SELECT 1 FROM whatsapp_messages m WHERE m.lead_id = b.lead_id AND m.direction = 'in'
                          AND m.created_at > (SELECT max(f.completed_at) FROM lead_follow_ups f WHERE f.lead_id = b.lead_id)) THEN 'BAD'
    ELSE 'NEUTRAL'
  END AS quality,
  CASE
    WHEN b.quality_override IS NOT NULL THEN 'manual'
    WHEN b.status IN ('qualified','quotation_sent','advance_paid','booking_confirmed','won') THEN 'status'
    WHEN b.status IN ('invalid_number','wrong_number','duplicate','no_response','just_checking','not_interested','lost') THEN 'status'
    WHEN NOT (b.digits ~ '^(91|0)?[6-9][0-9]{9}$' OR (length(b.digits) BETWEEN 11 AND 15 AND b.digits !~ '^91[0-9]{10}$')) THEN 'invalid_or_missing_phone'
    WHEN EXISTS (SELECT 1 FROM leads o WHERE o.is_deleted = false AND o.id <> b.lead_id AND o.created_at < b.created_at AND length(b.digits) >= 10
                   AND right(regexp_replace(COALESCE(NULLIF(o.whatsapp_number,''), NULLIF(o.phone,''), ''), '[^0-9]', '', 'g'), 10) = right(b.digits, 10)) THEN 'duplicate_phone'
    WHEN (SELECT count(*) FROM lead_follow_ups f WHERE f.lead_id = b.lead_id AND f.status = 'done' AND f.outcome ~* '(no answer|not reachable|no response|not picking|switched off|busy)') >= 3 THEN 'unanswered_followups'
    ELSE NULL
  END AS reason
FROM base b;
