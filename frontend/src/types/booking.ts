export const BOOKING_STATUSES = ['pending_approval', 'confirmed', 'in_progress', 'completed', 'cancelled'] as const;

export const BOOKING_STATUS_LABELS: Record<string, string> = {
  pending_approval: 'Pending Approval',
  confirmed: 'Confirmed',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const APPROVAL_STATUS_LABELS: Record<string, string> = {
  pending_approval: 'Pending Approval',
  updated: 'Updated',
  approved: 'Approved',
};

export interface BookingChecklistItem {
  id: string;
  booking_id: string;
  item: string;
  is_done: boolean;
  done_by: string | null;
  done_at: string | null;
  created_at: string;
}

export interface BookingTraveler {
  id: string;
  booking_id: string;
  full_name: string;
  passport_number: string | null;
  dob: string | null;
  nationality: string | null;
  passport_expiry: string | null;
  is_lead_traveler: boolean;
}

export interface HotelBooking {
  id: string;
  booking_id: string;
  hotel_id: string | null;
  hotel_name?: string | null;
  vendor_id: string | null;
  vendor_name?: string | null;
  check_in: string | null;
  check_out: string | null;
  rooms: number;
  cost: number;
  confirmation_number: string | null;
  status: string;
}

export interface FlightBooking {
  id: string;
  booking_id: string;
  airline: string | null;
  flight_number: string | null;
  departure_airport: string | null;
  arrival_airport: string | null;
  departure_at: string | null;
  arrival_at: string | null;
  pnr: string | null;
  cost: number;
  status: string;
}

export interface TransportBooking {
  id: string;
  booking_id: string;
  transport_option_id: string | null;
  vendor_id: string | null;
  vendor_name?: string | null;
  from_date: string | null;
  to_date: string | null;
  cost: number;
  status: string;
}

export interface Payment {
  id: string;
  booking_id: string;
  amount: number;
  method: string | null;
  reference: string | null;
  paid_at: string;
  created_by_name?: string | null;
}

export interface PaymentInstallment {
  id: string;
  booking_id: string;
  due_date: string;
  amount: number;
  status: string;
  paid_at: string | null;
}

export interface VendorPayment {
  id: string;
  booking_id: string;
  vendor_id: string;
  vendor_name?: string | null;
  amount: number;
  status: string;
  notes: string | null;
  created_at: string;
}

export interface Booking {
  id: string;
  booking_number: string;
  quotation_id: string | null;
  customer_id: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  package_id: string | null;
  itinerary_snapshot: any;
  travel_from: string | null;
  travel_to: string | null;
  adults: number;
  children: number;
  total_amount: number;
  paid_amount: number;
  balance_amount?: number;
  status: string;
  approval_status: string;
  approval_status_changed_at: string | null;
  advance_confirmed_at: string | null;
  ops_executive_id: string | null;
  ops_executive_name?: string | null;
  approved_by: string | null;
  approved_by_name?: string | null;
  approved_at: string | null;
  activity_status: string | null;
  branch_id: string;
  created_at: string;
  updated_at: string;
  checklist?: BookingChecklistItem[];
  travelers?: BookingTraveler[];
  hotels?: HotelBooking[];
  flights?: FlightBooking[];
  transports?: TransportBooking[];
  payments?: Payment[];
  installments?: PaymentInstallment[];
  vendorPayments?: VendorPayment[];
}

export interface BookingStats {
  total_bookings: number;
  balance_due: number;
  in_progress_count: number;
}

export interface BookingInput {
  customerId: string;
  quotationId?: string;
  packageId?: string;
  travelFrom?: string;
  travelTo?: string;
  adults?: number;
  children?: number;
  totalAmount?: number;
  branchId: string;
}
