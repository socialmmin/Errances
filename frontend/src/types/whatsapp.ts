export interface WhatsAppTemplate {
  id: string;
  name: string;
  body_template: string;
  is_active: boolean;
  created_at: string;
}

export interface WhatsAppLog {
  id: string;
  to_number: string;
  template_name: string | null;
  status: string;
  sent_at: string | null;
  created_at: string;
  message_type?: string;
  error_message?: string | null;
  lead_id?: string | null;
  package_id?: string | null;
  package_name?: string | null;
  customer_name?: string | null;
  lead_number?: string | null;
  campaign_name?: string | null;
  message_id?: string | null;
}

export interface WhatsAppConfig {
  phone_number_id: string | null;
  business_account_id: string | null;
  is_configured: boolean;
  configured_at: string | null;
  // Which way WhatsApp runs: through Twilio, or through Meta's own Cloud API.
  provider?: 'twilio' | 'meta';
  sender?: string;
}

export const WHATSAPP_MERGE_VARIABLES = [
  'customer_name', 'executive_name', 'destination', 'travel_date',
  'guest_count', 'package_name', 'company_name', 'executive_phone',
] as const;
