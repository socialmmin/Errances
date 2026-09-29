export interface RevenuePoint {
  month: string;
  amount: number;
}

export interface ConversionBySource {
  source: string;
  rawSource: string;
  total: number;
  booked: number;
  rate: number;
}

export interface LostReason {
  name: string;
  value: number;
}

export interface DestinationReport {
  destination: string;
  total: number;
  assigned: number;
  unassigned: number;
  booked: number;
  rate: number;
}

export interface OutstandingBooking {
  id: string;
  booking_number: string;
  balance_amount: number;
  customer_name: string | null;
}

export interface SalesPerformance {
  id: string;
  name: string;
  assigned: number;
  converted: number;
  revenue: number;
  rate: number;
}

export interface ExecutiveLead {
  id: string;
  lead_number: string | null;
  customer_name: string;
  phone: string | null;
  destination: string | null;
  status: string;
  expected_revenue: number;
  created_at: string;
}

export interface ExecutiveDetail {
  profile: { id: string; full_name: string; employee_code: string | null; role_name: string | null } | null;
  leads: ExecutiveLead[];
  stats: { assigned: number; converted: number; revenue: number; rate: number };
}
