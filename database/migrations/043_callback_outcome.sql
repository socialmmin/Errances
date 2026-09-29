ALTER TABLE callback_requests ADD COLUMN IF NOT EXISTS outcome text;
ALTER TABLE callback_requests ADD COLUMN IF NOT EXISTS note text;
