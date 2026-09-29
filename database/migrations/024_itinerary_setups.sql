-- Whole saved setups (destination, message, consultant, call button, PDF) as one preset.
ALTER TABLE itinerary_presets DROP CONSTRAINT IF EXISTS itinerary_presets_kind_check;
ALTER TABLE itinerary_presets ADD CONSTRAINT itinerary_presets_kind_check CHECK (kind IN ('name','number','button','message','setup'));
