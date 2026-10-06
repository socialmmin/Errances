-- Vendors by category, marked against trips (quotations), with what was agreed, what was paid
-- and what is still to pay. Money paid to a vendor on a trip that is later cancelled stays as
-- credit with that vendor and can be used on another trip.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS category text;            -- hotel | transport | activity | travel | other
UPDATE vendors SET category = CASE WHEN type::text IN ('hotel', 'transport', 'activity') THEN type::text ELSE 'other' END WHERE category IS NULL;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS destinations text[] NOT NULL DEFAULT '{}';   -- empty = serves every destination
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS seaters integer[] NOT NULL DEFAULT '{}';     -- transport: 2, 4, 5, 7, 10 ... seaters
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS travel_modes text[] NOT NULL DEFAULT '{}';   -- travel: flight, train, bus
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_person text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_details text;

CREATE TABLE IF NOT EXISTS trip_vendor_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  category text,
  description text,
  agreed_amount bigint NOT NULL DEFAULT 0,
  is_deleted boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trip_vendor_costs_quotation ON trip_vendor_costs(quotation_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_trip_vendor_costs_vendor ON trip_vendor_costs(vendor_id) WHERE is_deleted = false;

-- kind: payment (money sent to the vendor) | credit_applied (paid out of credit the vendor holds
-- from a cancelled trip: source_cost_id) | vendor_refund (the vendor gave money back to us)
CREATE TABLE IF NOT EXISTS trip_vendor_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_id uuid NOT NULL REFERENCES trip_vendor_costs(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  kind text NOT NULL DEFAULT 'payment',
  amount bigint NOT NULL,
  method text,
  reference text,
  note text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  source_cost_id uuid REFERENCES trip_vendor_costs(id) ON DELETE SET NULL,
  is_deleted boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trip_vendor_payments_cost ON trip_vendor_payments(cost_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_trip_vendor_payments_vendor ON trip_vendor_payments(vendor_id, paid_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_trip_vendor_payments_source ON trip_vendor_payments(source_cost_id) WHERE is_deleted = false;
