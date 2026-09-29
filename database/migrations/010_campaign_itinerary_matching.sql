-- 010_campaign_itinerary_matching.sql
-- Lets staff tag a tour package with the Meta ad campaign name it belongs
-- to, so the WhatsApp bot can auto-send that package's itinerary the
-- moment someone clicks in from that specific campaign, instead of always
-- showing the generic package menu first.

ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS campaign_name text;
CREATE INDEX IF NOT EXISTS idx_tour_packages_campaign_name ON tour_packages(campaign_name) WHERE is_deleted = false AND campaign_name IS NOT NULL;
