-- Itineraries a person sent by hand (personal WhatsApp) because the Cloud API number could not.
CREATE TABLE IF NOT EXISTS manual_itinerary_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
  marked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  marked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, package_id)
);
