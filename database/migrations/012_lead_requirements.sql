-- Keep one CRM profile per contact while retaining every tour enquiry.
CREATE TABLE IF NOT EXISTS lead_requirements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  destination       text,
  campaign_name     text,
  ad_name           text,
  form_name         text,
  meta_leadgen_id   text UNIQUE,
  source            text,
  attribution       jsonb,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_requirements_lead
  ON lead_requirements(lead_id, submitted_at DESC);

-- Preserve the current requirement for profiles created before this table.
INSERT INTO lead_requirements
  (lead_id, destination, campaign_name, ad_name, source, attribution, submitted_at)
SELECT id, destination, campaign_name, ad_name, source::text, meta_attribution, created_at
FROM leads
WHERE is_deleted = false
  AND (destination IS NOT NULL OR campaign_name IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM lead_requirements r WHERE r.lead_id = leads.id);

