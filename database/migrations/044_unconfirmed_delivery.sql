-- WhatsApp's Cloud API has no endpoint to ask "did this message arrive?" after the fact -- Meta
-- only tells us by pushing a delivery-status webhook. When that webhook never comes, "accepted"
-- (Meta agreed to attempt the send) must never be shown or treated as "Sent" -- it means unknown,
-- and unknown must be flagged, not hidden.
--
-- 'unconfirmed': an itinerary log whose webhook confirmation never arrived within the timeout.
-- Retryable, like 'failed' and 'test_mode_skipped' -- allow a fresh claim for the same person/package.

DROP INDEX IF EXISTS uq_itinerary_claim;
CREATE UNIQUE INDEX uq_itinerary_claim
  ON whatsapp_logs (to_number_norm, package_id)
  WHERE message_type = 'itinerary' AND status NOT IN ('failed', 'test_mode_skipped', 'unconfirmed') AND is_deleted = false;
