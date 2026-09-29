-- Rich record of the itinerary message we send (so the inbox can show what the customer sees)
-- and a small stored preview of each itinerary's first page.
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS meta jsonb;
CREATE TABLE IF NOT EXISTS package_thumbnails (
  package_id uuid PRIMARY KEY,
  data_url   text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
