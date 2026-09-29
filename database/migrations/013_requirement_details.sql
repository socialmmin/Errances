ALTER TABLE lead_requirements
  ADD COLUMN IF NOT EXISTS travel_from date,
  ADD COLUMN IF NOT EXISTS travel_to date,
  ADD COLUMN IF NOT EXISTS adults int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS children int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS infants int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS budget bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Recover all question/answer pairs from already imported Meta events.
WITH event_answers AS (
  SELECT DISTINCT ON (e.lead_id)
    e.lead_id, e.leadgen_id, e.form_name,
    COALESCE((
      SELECT jsonb_object_agg(field->>'name', COALESCE(field->'values'->>0, ''))
      FROM jsonb_array_elements(COALESCE(e.raw_payload->'field_data', '[]'::jsonb)) field
    ), '{}'::jsonb) AS answers
  FROM meta_lead_events e
  WHERE e.lead_id IS NOT NULL
  ORDER BY e.lead_id, e.created_at DESC
)
UPDATE lead_requirements r
SET answers = e.answers,
    form_name = COALESCE(r.form_name, e.form_name),
    meta_leadgen_id = COALESCE(r.meta_leadgen_id, e.leadgen_id)
FROM event_answers e
WHERE r.lead_id = e.lead_id AND r.source = 'meta_ads';
