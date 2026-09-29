-- Distinguish an automatic itinerary send from one an agent manually triggered
-- (the "Resend" button), so the Messages page can show "Sent by: Auto" vs
-- "Sent by: <agent name>" instead of leaving every send looking identical.
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS sent_by uuid REFERENCES users(id);
