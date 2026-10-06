-- Payment reminders set for a date and time: the server sends the WhatsApp reminder by itself
-- when the time comes (skipped if the invoice is fully paid by then).
CREATE TABLE IF NOT EXISTS invoice_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  send_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',   -- scheduled | sent | failed | skipped | cancelled
  error text,
  sent_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_due ON invoice_reminders(send_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_invoice ON invoice_reminders(invoice_id, send_at DESC);
