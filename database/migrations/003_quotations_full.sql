-- Extends quotations / quotation_items with fields needed to match the
-- Hala reference app's pricing model (base/gst/cost/margin split) and
-- itemized line items by category. Additive only — no existing columns
-- renamed or dropped.

ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS base_amount     bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_amount      bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_amount     bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profit_margin   numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS internal_notes  text,
  ADD COLUMN IF NOT EXISTS approved_by     uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS version         int NOT NULL DEFAULT 1;

ALTER TABLE quotation_items
  ADD COLUMN IF NOT EXISTS category      text,
  ADD COLUMN IF NOT EXISTS markup_pct    numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_cost     bigint,
  ADD COLUMN IF NOT EXISTS selling_price bigint;
