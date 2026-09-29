-- 005_finance_full.sql
-- Additive migration for the Finance module (invoices/payments/collections).
-- Never removes/renames existing columns. Mirrors Hala's finance UI.

-- Payment transaction status is distinct from the invoice-level `payment_status`
-- enum (pending/partial/paid/overdue/refunded) already used by invoices &
-- payment_installments -- a single payment row is a pending/completed/failed
-- transaction, not an invoice lifecycle state.
DO $$ BEGIN
  CREATE TYPE payment_txn_status AS ENUM ('pending', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'tax_invoice'; -- proforma, tax_invoice, credit_note

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS status payment_txn_status NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS transaction_id text,
  ADD COLUMN IF NOT EXISTS collected_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Existing rows recorded via the Bookings module's recordPayment are all
-- accountant-direct entries that already counted toward paid_amount -- the
-- DEFAULT 'completed' above preserves that for them. New PTA field
-- collections are inserted explicitly with status='pending'.

CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_collected_by ON payments(collected_by);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments(paid_at);
CREATE INDEX IF NOT EXISTS idx_payment_installments_due_date ON payment_installments(due_date);
CREATE INDEX IF NOT EXISTS idx_payment_installments_status ON payment_installments(status);
