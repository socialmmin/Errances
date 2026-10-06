-- What was deducted on a cancellation, and the terms and conditions it was deducted under.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancel_policy text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancel_deduction bigint;
