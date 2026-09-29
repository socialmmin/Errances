DELETE FROM itinerary_presets WHERE kind='message' AND value LIKE 'Planning your {destination} trip?%' OR kind='message' AND value LIKE 'Looking for the perfect {destination}%' OR kind='message' AND value LIKE 'Great choice — {destination}%';
INSERT INTO itinerary_presets (kind, value) VALUES
('message','Dreaming of {destination} but worried about planning, hotels and cost? ✨ We have done it for you — a ready {destination} itinerary with handpicked stays, sightseeing and transfers, all within your budget. Tap below to talk to our expert.'),
('message','Want a stress-free {destination} trip without the planning hassle? Here is your complete day-wise plan — best stays, top sights and pickups included at a fair price. Call our expert for dates and the best offer.'),
('message','Not sure where to stay or what to see in {destination}? Your plan is ready: comfortable hotels, must-see places and smooth transfers, fitted to your budget. Talk to our expert to customise it.')
ON CONFLICT DO NOTHING;
