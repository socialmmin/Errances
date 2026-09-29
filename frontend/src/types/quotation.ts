export const QUOTATION_ITEM_CATEGORIES = [
  'hotel', 'flight', 'transport', 'activity', 'visa', 'insurance', 'guide', 'other',
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
  quotation_number: string;
  lead_id: string | null;
  customer_id: string | null;
  package_id: string | null;
  destination: string | null;
  travel_from: string | null;
  travel_to: string | null;
  adults: number;
  children: number;
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
  packageId?: string | null;
  destination?: string;
  travelFrom?: string;
  travelTo?: string;
  adults?: number;
  children?: number;
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
}

// Margin color-coding, ported from hala-audit quotation-detail.tsx:
// red < 10%, amber < 20%, green >= 20%.
export function marginColorClass(margin: number): string {
  if (margin < 10) return 'text-red-600 dark:text-red-400';
  if (margin < 20) return 'text-amber-600 dark:text-amber-400';
  return 'text-green-600 dark:text-green-400';
}
