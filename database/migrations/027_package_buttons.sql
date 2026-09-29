-- Configurable WhatsApp buttons per itinerary: [{type:'call'|'url'|'chat', text, phone?, url?}]
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS buttons jsonb;
