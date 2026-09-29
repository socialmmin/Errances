-- Saved dropdown values for the itinerary/WhatsApp form (consultant names,
-- call numbers, button texts and message templates with a {destination} placeholder).
CREATE TABLE IF NOT EXISTS itinerary_presets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('name','number','button','message')),
  value       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, value)
);

INSERT INTO itinerary_presets (kind, value) VALUES
 ('button','Call our experts'),
 ('message','Planning your {destination} trip? We have put together a complete {destination} itinerary for you — day-wise sightseeing, handpicked stays and private transfers, planned to keep the trip stress-free and within your budget. Have a look at the attached plan, and our travel expert will help you with the best dates, price and any changes you need.'),
 ('message','Looking for the perfect {destination} holiday? Here is our {destination} itinerary with the best places to see, comfortable hotels and hassle-free transfers, all designed around your comfort and budget. Go through the plan and our travel expert will customise it for you.'),
 ('message','Great choice — {destination} is wonderful this season! We have prepared a ready-to-go {destination} itinerary with sightseeing, stays and transport included. Review the attached plan and speak to our expert for today''s best package price.')
ON CONFLICT DO NOTHING;
