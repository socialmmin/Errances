-- Follow-ups: created from a lead's own profile page, and shown centrally on one
-- Follow-ups page across all leads (same records, two views).
CREATE TABLE IF NOT EXISTS lead_follow_ups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  due_at       timestamptz NOT NULL,
  note         text,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
  outcome      text,
  created_by   uuid,
  completed_by uuid,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_follow_ups_lead ON lead_follow_ups(lead_id, due_at);
CREATE INDEX IF NOT EXISTS idx_lead_follow_ups_due ON lead_follow_ups(status, due_at);
