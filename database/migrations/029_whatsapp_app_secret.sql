-- Meta App Secret kept in the CRM (validated against Meta before saving) so
-- incoming WhatsApp messages can be verified without editing server settings.
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS app_secret text;
