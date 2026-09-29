-- ============================================================
-- Migration 002: Packages & Itinerary — full module
-- Additive only: extends tour_packages / itinerary_days with the fields
-- needed by the Packages & Itinerary module (ported from Hala's
-- frontend/src/pages/packages/index.tsx + detail.tsx), and adds
-- package_hotels / package_flights / package_transfers.
-- Safe to re-run (IF NOT EXISTS everywhere).
-- ============================================================

-- tour_packages: new columns
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS package_code text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS destinations text[];
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS max_pax integer;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS language text DEFAULT 'English';
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS is_template boolean NOT NULL DEFAULT false;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS highlights text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS net_price numeric;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS base_price_adult numeric;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS base_price_child numeric;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS price_child_nobed numeric;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS price_infant numeric;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS price_extra_adult numeric;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS markup_pct numeric DEFAULT 15;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS tax_type text DEFAULT 'GST 5%';
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS currency text DEFAULT 'INR';
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS pricing_notes text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS inclusions text[];
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS exclusions text[];
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS cancellation_policy text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS refund_policy text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS terms_and_conditions text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS cover_image_url text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS gallery_urls text[];

-- itinerary_days: new columns
ALTER TABLE itinerary_days ADD COLUMN IF NOT EXISTS date date;
ALTER TABLE itinerary_days ADD COLUMN IF NOT EXISTS meals jsonb;
ALTER TABLE itinerary_days ADD COLUMN IF NOT EXISTS activities jsonb;

-- New child tables
CREATE TABLE IF NOT EXISTS package_hotels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
  option_label text DEFAULT 'OPT 1',
  hotel_name text NOT NULL,
  star_category text,
  location text,
  checkin_date date,
  checkout_date date,
  rooms integer DEFAULT 1,
  meal_plan text,
  room_category text,
  room_occupancy text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS package_flights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
  flight_no text,
  airline text,
  class text,
  from_city text,
  from_datetime timestamptz,
  to_city text,
  to_datetime timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS package_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
  transfer_name text,
  vehicle_type text,
  from_location text,
  to_location text,
  transfer_datetime timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_package_hotels_package_id ON package_hotels(package_id);
CREATE INDEX IF NOT EXISTS idx_package_flights_package_id ON package_flights(package_id);
CREATE INDEX IF NOT EXISTS idx_package_transfers_package_id ON package_transfers(package_id);
