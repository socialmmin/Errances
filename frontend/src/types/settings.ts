export interface Branch {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  manager_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Role {
  id: string;
  name: string;
  permissions: string[];
  description: string | null;
}

export interface UserRow {
  id: string;
  email: string;
  full_name: string;
  employee_code: string | null;
  phone: string | null;
  branch_id: string | null;
  role_id: string | null;
  role_name: string | null;
  branch_name: string | null;
  is_active: boolean;
  participate_round_robin: boolean;
  last_login_at: string | null;
  created_at: string;
}
