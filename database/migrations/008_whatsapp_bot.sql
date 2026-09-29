-- 008_whatsapp_bot.sql
-- Per-phone-number conversation state for the inbound WhatsApp bot:
-- greet -> show package list -> customer taps one -> send that package's
-- itinerary PDF.

CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number     text NOT NULL UNIQUE,
  contact_name     text,
  state            text NOT NULL DEFAULT 'greeted',
  context          jsonb,
  last_message_at  timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Where the bot finds the itinerary PDF to send for a given package,
-- uploaded via the existing /files/upload endpoint (folder=itineraries)
-- and attached to the package from the Packages editor.
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS itinerary_pdf_object_key text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS itinerary_pdf_file_name text;
