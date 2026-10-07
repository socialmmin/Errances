-- Errances: file storage without an external bucket, and WhatsApp templates through Twilio.

-- Files (itinerary PDFs, documents sent in WhatsApp, customer photos) are kept here when no R2
-- bucket is configured. Served only through signed, expiring links (see BuiltInFilesController).
CREATE TABLE IF NOT EXISTS stored_files (
  object_key   text PRIMARY KEY,
  content_type text NOT NULL,
  size         integer NOT NULL,
  body         bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Short public links Twilio fetches a document or image from when it sends it on WhatsApp.
-- Templates need the file under a fixed address (https://<api>/api/wa-media/<id>/<file name>),
-- and the last part of that address is the file name the customer sees.
CREATE TABLE IF NOT EXISTS wa_media_links (
  id           text PRIMARY KEY,
  object_key   text,
  url          text,
  filename     text NOT NULL,
  content_type text,
  keep         boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (object_key IS NOT NULL OR url IS NOT NULL)
);

-- A CRM template submitted through Twilio: its WhatsApp approval state and how the CRM's
-- template parameters map onto the Twilio Content variables.
ALTER TABLE twilio_contents
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS meta jsonb,
  ADD COLUMN IF NOT EXISTS checked_at timestamptz;
