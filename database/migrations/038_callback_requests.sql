-- A customer tapping "Call our experts" on the itinerary message used to only
-- fire a transient popup -- nothing stayed on record if the call didn't happen
-- right then. This is the persistent list: stays pending until someone marks
-- the call as done.
CREATE TABLE IF NOT EXISTS callback_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id),
  customer_name text NOT NULL,
  phone text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  called_at timestamptz,
  called_by uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_callback_requests_pending ON callback_requests(requested_at DESC) WHERE called_at IS NULL;
