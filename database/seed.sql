-- ============================================================
-- ErranceVoyages_Tourism_2026 — seed data
-- Adapted from Hala's supabase/migrations/00002_seed_admin.sql, but for a
-- local `users` table (no Supabase auth.users) with backend-issued JWTs.
--
-- Bootstraps: one branch + all 11 roles (with permission arrays matching
-- backend/src/common/rbac/role-permissions.ts) + one super_admin user.
--
-- IMPORTANT: the password hash below is a bcrypt hash (cost 10) of the
-- placeholder password "ChangeMe123!" — for local/dev bootstrap only.
-- Rotate this password immediately after first login in any real
-- deployment. Generate a fresh hash with:
--   node -e "console.log(require('bcrypt').hashSync('ChangeMe123!', 10))"
-- ============================================================

INSERT INTO branches (id, name, city, country, phone, email, is_active)
VALUES (
  'a1b2c3d4-0000-4000-8000-000000000001',
  'Head Office',
  'Tiruchirappalli',
  'India',
  '+91-0000000000',
  'ops@errance.example',
  true
);

INSERT INTO roles (name, permissions, description) VALUES
('super_admin', '["*"]', 'Full system access'),
('branch_manager', '["leads:view","leads:create","leads:edit","leads:delete","leads:assign","leads:export","customers:view","customers:create","customers:edit","customers:delete","quotations:view","quotations:create","quotations:edit","quotations:approve","quotations:send","bookings:view","bookings:create","bookings:edit","bookings:cancel","finance:view","finance:collect_payment","finance:approve_refund","finance:reports","vendors:view","vendors:create","vendors:edit","masters:view","masters:manage","operations:view","operations:manage","reports:view","reports:export","settings:branches","hr:view","hr:manage"]', 'Manages a single branch, all modules except role/user administration'),
('sales_manager', '["leads:view","leads:create","leads:edit","leads:delete","leads:assign","leads:export","customers:view","customers:create","customers:edit","customers:delete","quotations:view","quotations:create","quotations:edit","quotations:approve","quotations:send","bookings:view","masters:view","reports:view"]', 'Manages sales team, leads and quotations'),
('sales_executive', '["leads:view","leads:create","leads:edit","quotations:view","quotations:create","quotations:edit","customers:view","masters:view"]', 'Handles individual leads and quotations'),
('operations_manager', '["bookings:view","bookings:create","bookings:edit","bookings:cancel","vendors:view","vendors:create","vendors:edit","masters:view","masters:manage","operations:view","operations:manage","reports:view"]', 'Manages bookings and vendor operations'),
('operations_executive', '["bookings:view","bookings:edit","masters:view","operations:view"]', 'Executes day-to-day booking operations'),
('accounts_manager', '["finance:view","finance:collect_payment","finance:approve_refund","finance:reports","reports:view","reports:export","bookings:view"]', 'Manages finance and reporting'),
('accounts_executive', '["finance:view","finance:collect_payment"]', 'Collects payments, views finance records'),
('marketing_executive', '["leads:view","leads:create","reports:view"]', 'Generates and views leads from marketing campaigns'),
('hr_executive', '["hr:view","hr:manage"]', 'Manages employee records and joining workflow'),
('support_staff', '["leads:view","customers:view","bookings:view","quotations:view","finance:view","vendors:view","operations:view","reports:view"]', 'Read-only support access across modules');

-- Password: ChangeMe123! (bcrypt cost 10) — rotate immediately.
INSERT INTO users (id, email, password_hash, full_name, employee_code, role_id, branch_id, is_active)
SELECT
  'a1b2c3d4-0000-4000-8000-000000000002',
  'admin@errance.example',
  '$2b$10$NoAPKMc/0jfaNcKp5qhq..Bk6OINk0Q7I6TRNXb4CuFDQme9Spjzi',
  'Super Admin',
  'EMP-0001',
  r.id,
  'a1b2c3d4-0000-4000-8000-000000000001',
  true
FROM roles r WHERE r.name = 'super_admin';

UPDATE branches SET manager_id = 'a1b2c3d4-0000-4000-8000-000000000002'
WHERE id = 'a1b2c3d4-0000-4000-8000-000000000001';
