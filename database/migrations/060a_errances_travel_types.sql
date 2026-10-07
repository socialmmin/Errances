-- Errances: the Create New Lead form offers Bachelors, Students and Adventure as travel types,
-- which the travel_type list did not have (saving a lead with one of them failed).
ALTER TYPE travel_type ADD VALUE IF NOT EXISTS 'bachelors';
ALTER TYPE travel_type ADD VALUE IF NOT EXISTS 'students';
ALTER TYPE travel_type ADD VALUE IF NOT EXISTS 'adventure';
