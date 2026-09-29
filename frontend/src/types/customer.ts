export interface Customer {
  id: string;
  customer_code: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  country: string | null;
  type: string;
  loyalty_points: number;
  branch_id: string;
  created_at: string;
}

export interface CustomerInput {
  fullName: string;
  phone?: string;
  email?: string;
  city?: string;
  country?: string;
  type?: string;
  branchId: string;
}
