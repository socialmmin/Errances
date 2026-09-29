-- 004_bookings_full.sql
-- Additive migration for the Bookings & Operations module.
-- Never removes/renames existing columns.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending_approval',
  ADD COLUMN IF NOT EXISTS approval_status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS advance_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ops_executive_id uuid REFERENCES users(id);

ALTER TABLE booking_travelers
  ADD COLUMN IF NOT EXISTS nationality text,
  ADD COLUMN IF NOT EXISTS passport_expiry date,
  ADD COLUMN IF NOT EXISTS is_lead_traveler boolean NOT NULL DEFAULT false;

ALTER TABLE hotel_bookings
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

ALTER TABLE flight_bookings
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

ALTER TABLE transport_bookings
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

ALTER TABLE vendor_payments
  ADD COLUMN IF NOT EXISTS notes text;

CREATE INDEX IF NOT EXISTS idx_bookings_ops_executive_id ON bookings(ops_executive_id);
CREATE INDEX IF NOT EXISTS idx_bookings_approval_status ON bookings(approval_status);
