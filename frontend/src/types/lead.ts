export interface Lead {
  id: string;
  quality?: 'GOOD' | 'NEUTRAL' | 'BAD' | null;
  quality_reason?: string | null;
  quality_override?: 'GOOD' | 'NEUTRAL' | 'BAD' | null;
  lost_reason?: string | null;
  lead_number: string;
  customer_name: string;
  phone: string | null;
  whatsapp_number: string | null;
  email: string | null;
  destination: string | null;
  itinerary_status: string | null;
  last_reply_at?: string | null;
  travel_from: string | null;
  travel_to: string | null;
  adults: number;
  children: number;
  status: string;
  priority: string;
  source: string | null;
  nationality: string | null;
  // What the lead asked for on WhatsApp: ticket | visa | package | other.
  service_type?: string | null;
  infants: number;
  budget: number | null;
  travel_type: string | null;
  expected_revenue: number | null;
  remarks: string | null;
  whatsapp_status: string | null;
  meta_attribution: Record<string, unknown> | null;
  campaign_name: string | null;
  ad_name: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  branch_id: string;
  created_at: string;
  lead_date?: string;
  updated_at: string;
  requirements?: LeadRequirement[];
  collaborators?: { id: string; full_name: string }[];
}

export interface LeadRequirement {
  id: string;
  destination: string | null;
  campaign_name: string | null;
  ad_name: string | null;
  form_name: string | null;
  source: string | null;
  submitted_at: string;
  travel_from: string | null;
  travel_to: string | null;
  adults: number;
  children: number;
  infants: number;
  budget: number | null;
  notes: string | null;
  answers: Record<string, string>;
}

export interface LeadInput {
  lostReason?: string;
  customerName: string;
  phone?: string;
  whatsappNumber?: string;
  email?: string;
  nationality?: string;
  destination?: string;
  travelFrom?: string;
  travelTo?: string;
  adults?: number;
  children?: number;
  infants?: number;
  budget?: number;
  travelType?: string;
  source?: string;
  status?: string;
  priority?: string;
  expectedRevenue?: number;
  remarks?: string;
  assignedTo?: string;
  branchId: string;
}
