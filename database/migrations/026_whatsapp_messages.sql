-- Two-way chat history (customer messages in, agent messages out).
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number  text NOT NULL,
  lead_id       uuid REFERENCES leads(id),
  direction     text NOT NULL CHECK (direction IN ('in','out')),
  msg_type      text NOT NULL DEFAULT 'text',
  body          text NOT NULL,
  wa_message_id text,
  sent_by       uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_lead ON whatsapp_messages(lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone ON whatsapp_messages(phone_number, created_at);
