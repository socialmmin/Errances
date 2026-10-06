-- A customer can ask for more than one trip ("requirement"), and each requirement can have
-- several quotations. Every quotation says which requirement it is for.
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS requirement_no integer NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_quotations_lead_requirement ON quotations(lead_id, requirement_no) WHERE is_deleted = false;
