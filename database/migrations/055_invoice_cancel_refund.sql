-- Cancelling a booked trip and refunding money against its invoice. A refund is whatever the
-- cancellation policy allows; what is not refunded stays with the company ("retained").
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES invoices(id) ON DELETE CASCADE;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS method text;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS reference text;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS refunded_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE refunds ALTER COLUMN booking_id DROP NOT NULL;
ALTER TABLE refunds ALTER COLUMN branch_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_refunds_invoice ON refunds(invoice_id) WHERE is_deleted = false;
