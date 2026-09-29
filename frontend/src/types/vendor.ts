export interface Vendor {
  id: string;
  name: string;
  type: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gst_number: string | null;
  branch_id: string;
  created_at: string;
}

export interface VendorInput {
  name: string;
  type?: string;
  phone?: string;
  email?: string;
  address?: string;
  gstNumber?: string;
  branchId: string;
}
