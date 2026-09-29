-- Travel-sales pipeline stages used by lead filters, board and quick editing.
-- PostgreSQL enum additions are additive so existing lead data remains valid.
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'follow_up';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'message_sent';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'itinerary_sent';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'booking_confirmed';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'no_response';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'not_interested';
