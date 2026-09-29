-- One row per signed-in browser/device so several sessions can be active at
-- once (previously a single hash per user logged the others out).
CREATE TABLE IF NOT EXISTS refresh_sessions (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL,
  token_hash   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refresh_sessions_user ON refresh_sessions(user_id);
