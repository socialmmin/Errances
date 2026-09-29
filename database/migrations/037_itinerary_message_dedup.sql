-- The chat log (whatsapp_messages, what the Inbox displays) was inserting a
-- brand-new "itinerary sent" bubble on every retry attempt -- because Meta's
-- send API returns "accepted, queued" immediately, before its own async
-- throttle later rejects the message. Each retry looked optimistically
-- successful for a moment, so a person retried 5 times (all of which Meta
-- ultimately rejected) showed 5 identical bubbles in the Inbox.
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS package_id uuid;
UPDATE whatsapp_messages SET package_id = (meta->>'packageId')::uuid
  WHERE msg_type = 'itinerary' AND package_id IS NULL AND meta->>'packageId' IS NOT NULL;

-- Collapse existing duplicate bubbles first (keep the earliest per phone+package)
-- so the unique index below can be created.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY phone_number, package_id ORDER BY created_at ASC) AS rn
  FROM whatsapp_messages WHERE msg_type = 'itinerary' AND package_id IS NOT NULL
)
DELETE FROM whatsapp_messages WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_messages_itinerary
  ON whatsapp_messages (phone_number, package_id) WHERE msg_type = 'itinerary';
