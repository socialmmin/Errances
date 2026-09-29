-- Freeform notes typed directly on a lead's Notes tab. Separate from the
-- read-only notes that already live inside requirements/quotations/follow-ups --
-- those stay in their own tables (they're business records, not scratch notes)
-- and are only ever displayed here, never deleted from here.
CREATE TABLE IF NOT EXISTS lead_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_notes_lead_id ON lead_notes(lead_id, created_at DESC);
