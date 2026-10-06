export const INVOICE_TYPES = ['proforma', 'tax_invoice', 'credit_note'] as const;

export const INVOICE_TYPE_LABELS: Record<string, string> = {
  proforma: 'Proforma',
  tax_invoice: 'Tax Invoice',
  credit_note: 'Credit Note',
};

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  partial: 'Partial',
  paid: 'Paid',
  overdue: 'Overdue',
  refunded: 'Refunded',
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  completed: 'Completed',
  failed: 'Failed',
};

export interface Invoice {
  id: string;
  invoice_number: string;
  booking_id: string | null;
  booking_number?: string | null;
  quotation_id?: string | null;
  quotation_number?: string | null;
  public_share_token?: string | null;
  customer_id: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  amount: number;
  tax_amount: number;
  total_amount: number;
  paid_amount?: number;
  balance_due?: number;
  type: string;
  status: string;
  due_date: string | null;
  branch_id: string;
  created_at: string;
  payments?: Payment[];
  // cancellation and refunds
  next_reminder_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  cancel_policy?: string | null;
  cancel_deduction?: number | null;
  refunded_amount?: number;
  retained_amount?: number;
  refunds?: { id: string; amount: number; reason: string | null; method: string | null; reference: string | null; refunded_at: string; refunded_by_name: string | null }[];
}

export interface Payment {
  id: string;
  invoice_id: string | null;
  booking_id: string | null;
  booking_number?: string | null;
  customer_name?: string | null;
  amount: number;
  method: string | null;
  reference: string | null;
  transaction_id: string | null;
  status: string;
  collected_by: string | null;
  collected_by_name?: string | null;
  verified_by: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  paid_at: string;
}

export interface OverdueInstallment {
  id: string;
  booking_id: string;
  booking_number?: string | null;
  customer_name?: string | null;
  due_date: string;
  amount: number;
  status: string;
  days_overdue: number;
}

export interface PtaCollection {
  id: string;
  booking_id: string | null;
  booking_number?: string | null;
  customer_name?: string | null;
  pta_name: string;
  amount: number;
  method: string | null;
  status: string;
  paid_at: string;
}

export interface FinanceKpis {
  todayCollection: number;
  monthCollection: number;
  outstanding: number;
  overdueCount: number;
}
