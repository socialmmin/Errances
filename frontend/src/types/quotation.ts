export const QUOTATION_ITEM_CATEGORIES = [
  'package', 'hotel', 'flight', 'transport', 'activity', 'visa', 'insurance', 'guide', 'other',
] as const;

// Matches the backend's lead_source enum -- shown only when creating a new lead from the
// quotation builder (an existing lead already has its own source).
export const LEAD_SOURCES = [
  'meta_ads', 'website', 'referral', 'walk_in', 'social_media', 'phone', 'whatsapp', 'agent', 'other',
] as const;

export const QUOTATION_STATUSES = [
  'draft', 'sent', 'accepted', 'rejected', 'expired', 'converted',
] as const;

export const QUOTATION_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
  converted: 'Converted',
};

export interface QuotationItem {
  id: string;
  quotation_id: string;
  category: string | null;
  item_type: string | null;
  description: string | null;
  quantity: number;
  unit_cost: number | null;
  markup_pct: number;
  selling_price: number | null;
  unit_price: number;
  total_price: number;
}

export interface Quotation {
  id: string;
  // set once the quotation has an invoice (approved through the link, or a payment recorded)
  invoice_id?: string | null;
  invoice_number?: string | null;
  paid_amount?: number;
  quotation_number: string;
  lead_id: string | null;
  customer_id: string | null;
  package_id: string | null;
  destination: string | null;
  travel_from: string | null;
  travel_to: string | null;
  adults: number;
  children: number;
  infants: number;
  total_amount: number;
  discount_amount: number;
  final_amount: number;
  base_amount: number;
  gst_amount: number;
  cost_amount: number;
  profit_margin: number;
  status: string;
  valid_until: string | null;
  notes: string | null;
  internal_notes: string | null;
  public_share_token: string | null;
  version: number;
  // which of the customer's requirements this is for, and its place among that requirement's quotations
  requirement_no?: number;
  option_no?: number;
  option_count?: number;
  branch_id: string;
  created_at: string;
  updated_at: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  lead_customer_name?: string | null;
  lead_phone?: string | null;
  lead_email?: string | null;
  items?: QuotationItem[];
}

export interface QuotationItemInput {
  id?: string;
  category: string;
  description?: string;
  quantity?: number;
  unitCost: number;
  markupPct?: number;
}

export interface QuotationInput {
  leadId?: string | null;
  customerId?: string | null;
  newCustomerName?: string;
  newCustomerPhone?: string;
  newCustomerEmail?: string;
  newCustomerSource?: string;
  packageId?: string | null;
  requirementNo?: number;
  destination?: string;
  travelFrom?: string;
  travelTo?: string;
  adults?: number;
  children?: number;
  infants?: number;
  discountPct?: number;
  gstPct?: number;
  validUntil?: string;
  notes?: string;
  internalNotes?: string;
  branchId: string;
  items?: QuotationItemInput[];
}

export interface QuotationStats {
  total_count: number;
  total_value: number;
  draft_count: number;
  approved_unpaid_count?: number;
  awaiting_count?: number;
}

// Margin color-coding, ported from hala-audit quotation-detail.tsx:
// red < 10%, amber < 20%, green >= 20%.
export function marginColorClass(margin: number): string {
  if (margin < 10) return 'text-red-600 dark:text-red-400';
  if (margin < 20) return 'text-amber-600 dark:text-amber-400';
  return 'text-green-600 dark:text-green-400';
}
