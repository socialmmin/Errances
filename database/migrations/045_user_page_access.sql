-- Per-employee access overrides on top of their role's defaults.
-- NULL = use the role's defaults. Otherwise a JSON object of access-key -> true/false, e.g.
-- {"reports": false, "dashboard.meta_ads": true}. Only keys that differ from the role default
-- need to be stored; anything absent falls back to the role default.
ALTER TABLE users ADD COLUMN IF NOT EXISTS page_access jsonb;
