CREATE TABLE IF NOT EXISTS lead_collaborators (
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_lead_collaborators_user ON lead_collaborators(user_id, lead_id);

CREATE TABLE IF NOT EXISTS lead_assignment_state (
  branch_id uuid PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
  last_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
