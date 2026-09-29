-- Per-user on/off switch for push notifications, independent of browser permission.
ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_enabled boolean NOT NULL DEFAULT true;
