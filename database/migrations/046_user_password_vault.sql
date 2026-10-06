-- Encrypted, super-admin-viewable copy of each employee's password (see backend/src/common/crypto/password-vault.ts).
-- Existing users have none until their password is next set or reset.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_enc text;
