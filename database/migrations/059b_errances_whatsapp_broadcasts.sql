-- Errances: bulk WhatsApp (an approved template sent to a filtered list of leads, through Twilio).

CREATE TABLE IF NOT EXISTS whatsapp_broadcasts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  content_sid    text NOT NULL,
  template_name  text NOT NULL,
  template_body  text,
  -- For each template variable number: {"source": "name" | "destination" | "text", "value": "..."}
  variables      jsonb NOT NULL DEFAULT '{}'::jsonb,
  audience       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- draft -> sending -> done; "paused" by a person, "waiting" for WhatsApp's 24-hour limit to free up
  status         text NOT NULL DEFAULT 'sending',
  total          integer NOT NULL DEFAULT 0,
  estimated_cost numeric(10,2),
  currency       text,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz
);

CREATE TABLE IF NOT EXISTS whatsapp_broadcast_recipients (
  id            bigserial PRIMARY KEY,
  broadcast_id  uuid NOT NULL REFERENCES whatsapp_broadcasts(id) ON DELETE CASCADE,
  lead_id       uuid REFERENCES leads(id) ON DELETE SET NULL,
  phone         text NOT NULL,
  name          text,
  -- queued -> sent -> delivered -> read, or failed / skipped
  status        text NOT NULL DEFAULT 'queued',
  error         text,
  message_sid   text,
  sent_at       timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (broadcast_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_queue ON whatsapp_broadcast_recipients (broadcast_id, status);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_sid ON whatsapp_broadcast_recipients (message_sid) WHERE message_sid IS NOT NULL;

-- Customers who replied STOP: never included in a bulk send again (until they reply START).
CREATE TABLE IF NOT EXISTS whatsapp_opt_outs (
  phone       text PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now()
);
