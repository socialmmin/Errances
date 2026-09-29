-- 012_itinerary_contact_number.sql
-- Consultant call number typed on the itinerary page. It is baked into the
-- itinerary's WhatsApp template as a tap-to-call button, so one approved
-- template exists per distinct number.
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS contact_number text;
