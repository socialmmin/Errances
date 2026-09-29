-- Per-category WhatsApp conversation rates (INR), set by the team from their real
-- Meta invoice/rate card -- never invented by the app -- used to price what was actually sent.
CREATE TABLE IF NOT EXISTS whatsapp_rates (
  category   text PRIMARY KEY CHECK (category IN ('MARKETING','UTILITY','AUTHENTICATION','SERVICE')),
  price_inr  numeric(10,4) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
INSERT INTO whatsapp_rates (category, price_inr) VALUES
 ('MARKETING', 0), ('UTILITY', 0), ('AUTHENTICATION', 0), ('SERVICE', 0)
ON CONFLICT DO NOTHING;
