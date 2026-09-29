-- Inbox: per-conversation state (unread marker, open/waiting/done) and saved quick replies.
CREATE TABLE IF NOT EXISTS whatsapp_chat_state (
  lead_id uuid PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','waiting','done')),
  last_read_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS whatsapp_quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
