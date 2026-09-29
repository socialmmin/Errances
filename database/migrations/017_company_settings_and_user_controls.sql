CREATE TABLE IF NOT EXISTS company_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id), company_name text NOT NULL DEFAULT 'Errances Voyages',
  legal_name text, tagline text NOT NULL DEFAULT 'Travels CRM', logo_url text, logo_object_key text,
  favicon_url text, favicon_object_key text, phone text, email text, website text, address text, gstin text,
  bank_name text, bank_account_name text, bank_account_number text, bank_ifsc text, bank_branch text, upi_id text,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES users(id)
);
INSERT INTO company_settings(id) VALUES(true) ON CONFLICT(id) DO NOTHING;
ALTER TABLE users ADD COLUMN IF NOT EXISTS participate_round_robin boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone_active ON users ((regexp_replace(phone, '[^0-9]', '', 'g')))
  WHERE phone IS NOT NULL AND phone <> '' AND is_deleted = false;
