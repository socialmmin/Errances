-- ============================================================
-- ErranceVoyages_Tourism_2026 — consolidated database schema
-- Adapted from reference project "Hala" (tourism ERP/CRM), stripped of:
--   - Supabase Row Level Security (RLS) policies
--   - auth.uid() / auth.* schema references (GoTrue)
-- Auth is instead handled entirely in the NestJS backend (JWT + bcrypt),
-- with a local `users` table replacing Supabase's auth.users + profiles.
--
-- Conventions (kept from Hala):
--   - branch_id on every business table (multi-branch scoping)
--   - soft-delete via is_deleted boolean (never hard delete business rows)
--   - created_at / updated_at / created_by audit columns
--   - money stored as bigint in the smallest currency unit (paise/fils/cents)
--     -> divide by 100 for display
--   - dates/timestamps stored UTC (timestamptz)
--
-- This file is a single consolidated schema (NOT a migration replay of
-- Hala's 00001-00030). It folds in the masters data, location hierarchy,
-- itinerary templates, hotels, transport/activities, lead history, employee
-- joining workflow, PTA reviews/checklist, and booking approval pipeline
-- pieces from those later migrations, simplified to their table shapes.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ============================================================
-- ENUM TYPES
-- ============================================================
CREATE TYPE travel_type AS ENUM ('family', 'couple', 'solo', 'group', 'corporate', 'honeymoon');
CREATE TYPE lead_source AS ENUM ('website', 'referral', 'walk_in', 'social_media', 'phone', 'whatsapp', 'agent', 'other');
CREATE TYPE lead_priority AS ENUM ('strong', 'hot', 'cold', 'dead');
CREATE TYPE lead_status AS ENUM ('new', 'contacted', 'message_sent', 'follow_up', 'qualified', 'itinerary_sent', 'quotation_sent', 'negotiation', 'booking_confirmed', 'won', 'no_response', 'not_interested', 'lost');
CREATE TYPE lead_activity_type AS ENUM ('call', 'whatsapp', 'email', 'meeting', 'note', 'status_change');
CREATE TYPE followup_status AS ENUM ('pending', 'done', 'missed', 'rescheduled');
CREATE TYPE customer_type AS ENUM ('individual', 'corporate', 'agent');
CREATE TYPE doc_type AS ENUM ('passport', 'visa', 'id_card', 'other');
CREATE TYPE quotation_status AS ENUM ('draft', 'sent', 'accepted', 'rejected', 'expired', 'converted');
CREATE TYPE booking_status AS ENUM ('pending_approval', 'confirmed', 'in_progress', 'completed', 'cancelled');
CREATE TYPE payment_status AS ENUM ('pending', 'partial', 'paid', 'overdue', 'refunded');
CREATE TYPE task_status AS ENUM ('open', 'in_progress', 'done', 'cancelled');
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');

-- ============================================================
-- TABLE: branches
-- ============================================================
CREATE TABLE branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  city        text,
  country     text DEFAULT 'India',
  phone       text,
  email       text,
  address     text,
  manager_id  uuid,
  is_active   boolean NOT NULL DEFAULT true,
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid
);

-- ============================================================
-- TABLE: roles
-- ============================================================
CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE, -- e.g. super_admin, branch_manager, ...
  permissions jsonb NOT NULL DEFAULT '[]', -- array of permission strings, mirrors backend static map
  description text,
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid
);

-- ============================================================
-- TABLE: users (replaces Supabase auth.users + profiles)
-- ============================================================
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL, -- bcrypt
  full_name     text NOT NULL,
  phone         text,
  employee_code text UNIQUE,
  role_id       uuid REFERENCES roles(id),
  branch_id     uuid REFERENCES branches(id),
  avatar_url    text,
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  refresh_token_hash text, -- hashed current refresh token, for rotation/revocation
  is_deleted    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid
);

ALTER TABLE branches
  ADD CONSTRAINT fk_branches_manager
  FOREIGN KEY (manager_id) REFERENCES users(id);

-- ============================================================
-- TABLE: leads
-- ============================================================
CREATE TABLE leads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_number      text UNIQUE,
  customer_name    text NOT NULL,
  phone            text,
  whatsapp_number  text,
  email            text,
  nationality      text,
  destination      text,
  travel_from      date,
  travel_to        date,
  adults           int NOT NULL DEFAULT 1,
  children         int NOT NULL DEFAULT 0,
  infants          int NOT NULL DEFAULT 0,
  budget           bigint DEFAULT 0,
  travel_type      travel_type,
  source           lead_source,
  assigned_to      uuid REFERENCES users(id),
  priority         lead_priority DEFAULT 'cold',
  lead_score       int NOT NULL DEFAULT 0,
  status           lead_status NOT NULL DEFAULT 'new',
  expected_revenue bigint DEFAULT 0,
  lost_reason      text,
  remarks          text,
  branch_id        uuid NOT NULL REFERENCES branches(id),
  is_deleted       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES users(id)
);
CREATE INDEX idx_leads_branch ON leads(branch_id) WHERE is_deleted = false;
CREATE INDEX idx_leads_status ON leads(status) WHERE is_deleted = false;
CREATE INDEX idx_leads_assigned_to ON leads(assigned_to) WHERE is_deleted = false;

-- ============================================================
-- TABLE: lead_activities (engagement/history)
-- ============================================================
CREATE TABLE lead_activities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type         lead_activity_type NOT NULL,
  note         text,
  done_by      uuid REFERENCES users(id),
  scheduled_at timestamptz,
  completed_at timestamptz,
  branch_id    uuid NOT NULL REFERENCES branches(id),
  is_deleted   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES users(id)
);

-- ============================================================
-- TABLE: lead_followups
-- ============================================================
CREATE TABLE lead_followups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  followup_date timestamptz NOT NULL,
  note          text,
  status        followup_status NOT NULL DEFAULT 'pending',
  branch_id     uuid NOT NULL REFERENCES branches(id),
  is_deleted    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id)
);

-- ============================================================
-- TABLE: customers
-- ============================================================
CREATE TABLE customers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code    text UNIQUE,
  full_name        text NOT NULL,
  phone            text,
  whatsapp_number  text,
  email            text,
  nationality      text,
  dob              date,
  anniversary_date date,
  address          text,
  city             text,
  country          text,
  type             customer_type NOT NULL DEFAULT 'individual',
  loyalty_points   int NOT NULL DEFAULT 0,
  lifetime_value   bigint NOT NULL DEFAULT 0,
  referral_source  text,
  referred_by      uuid REFERENCES customers(id),
  lead_id          uuid REFERENCES leads(id),
  branch_id        uuid NOT NULL REFERENCES branches(id),
  is_deleted       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES users(id)
);
CREATE INDEX idx_customers_branch ON customers(branch_id) WHERE is_deleted = false;

-- ============================================================
-- TABLE: customer_documents
-- ============================================================
CREATE TABLE customer_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  doc_type          doc_type NOT NULL,
  doc_number        text,
  issue_date        date,
  expiry_date       date,
  r2_object_key     text, -- see files table below; kept here for quick lookup
  alert_days_before int NOT NULL DEFAULT 90,
  notes             text,
  branch_id         uuid NOT NULL REFERENCES branches(id),
  is_deleted        boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES users(id)
);

-- ============================================================
-- TABLE: customer_family_members
-- ============================================================
CREATE TABLE customer_family_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name            text NOT NULL,
  relation        text,
  dob             date,
  nationality     text,
  passport_number text,
  passport_expiry date,
  branch_id       uuid NOT NULL REFERENCES branches(id),
  is_deleted      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id)
);

-- ============================================================
-- MASTERS: location hierarchy (from 00008)
-- ============================================================
CREATE TABLE countries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE destinations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  country_id uuid REFERENCES countries(id),
  country    text,
  is_active  boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id)
);

-- ============================================================
-- MASTERS: room / meal types (from 00007)
-- ============================================================
CREATE TABLE room_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE meal_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL, -- EP, CP, MAP, AP
  name text NOT NULL,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- MASTERS: sightseeing (from 00009/00010)
-- ============================================================
CREATE TABLE sightseeing (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  destination_id uuid REFERENCES destinations(id),
  description    text,
  image_url      text,
  duration_hours numeric,
  is_deleted     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- MASTERS: transport & activities (from 00014)
-- ============================================================
CREATE TABLE transport_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  vehicle_type text,
  capacity int,
  destination_id uuid REFERENCES destinations(id),
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  destination_id uuid REFERENCES destinations(id),
  description text,
  price bigint DEFAULT 0,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- TABLE: hotels (from 00012)
-- ============================================================
CREATE TABLE hotels (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  destination_id uuid REFERENCES destinations(id),
  star_rating    int,
  address        text,
  phone          text,
  email          text,
  is_deleted     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES users(id)
);

CREATE TABLE hotel_rooms (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id     uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_type_id uuid REFERENCES room_types(id),
  meal_plan_id uuid REFERENCES meal_plans(id),
  price_per_night bigint DEFAULT 0,
  is_deleted   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- TABLE: vendors
-- ============================================================
CREATE TABLE vendors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  type        text, -- hotel, transport, dmc, freelancer, other
  phone       text,
  email       text,
  address     text,
  gst_number  text,
  branch_id   uuid NOT NULL REFERENCES branches(id),
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id)
);

-- ============================================================
-- TABLE: tour_packages
-- ============================================================
CREATE TABLE tour_packages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  destination_id uuid REFERENCES destinations(id),
  duration_days  int,
  duration_nights int,
  base_price     bigint DEFAULT 0,
  description    text,
  is_active      boolean NOT NULL DEFAULT true,
  branch_id      uuid NOT NULL REFERENCES branches(id),
  is_deleted     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES users(id)
);

-- ============================================================
-- MASTERS: itinerary templates (from 00011/00019)
-- ============================================================
CREATE TABLE itinerary_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid REFERENCES tour_packages(id) ON DELETE CASCADE,
  version    int NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id)
);

CREATE TABLE itinerary_days (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id   uuid REFERENCES tour_packages(id) ON DELETE CASCADE,
  template_id  uuid REFERENCES itinerary_templates(id) ON DELETE CASCADE,
  day_number   int NOT NULL,
  title        text,
  description  text,
  hotel_id     uuid REFERENCES hotels(id),
  meal_plan_id uuid REFERENCES meal_plans(id),
  is_deleted   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- MIGRATION 002: Packages & Itinerary — full module
-- Additive columns for tour_packages / itinerary_days plus new child
-- tables (package_hotels/flights/transfers). See
-- database/migrations/002_packages_full.sql (identical DDL, re-runnable).
-- ============================================================
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS package_code text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS destinations text[];
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS max_pax integer;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS language text DEFAULT 'English';
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS is_template boolean NOT NULL DEFAULT false;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS highlights text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS net_price numeric;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS base_price_adult numeric;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS base_price_child numeric;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS price_child_nobed numeric;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS price_infant numeric;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS price_extra_adult numeric;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS markup_pct numeric DEFAULT 15;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS tax_type text DEFAULT 'GST 5%';
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS currency text DEFAULT 'INR';
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS pricing_notes text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS inclusions text[];
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS exclusions text[];
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS cancellation_policy text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS refund_policy text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS terms_and_conditions text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS cover_image_url text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS gallery_urls text[];

ALTER TABLE itinerary_days ADD COLUMN IF NOT EXISTS date date;
ALTER TABLE itinerary_days ADD COLUMN IF NOT EXISTS meals jsonb;
ALTER TABLE itinerary_days ADD COLUMN IF NOT EXISTS activities jsonb;

CREATE TABLE IF NOT EXISTS package_hotels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
  option_label text DEFAULT 'OPT 1',
  hotel_name text NOT NULL,
  star_category text,
  location text,
  checkin_date date,
  checkout_date date,
  rooms integer DEFAULT 1,
  meal_plan text,
  room_category text,
  room_occupancy text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS package_flights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
  flight_no text,
  airline text,
  class text,
  from_city text,
  from_datetime timestamptz,
  to_city text,
  to_datetime timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS package_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
  transfer_name text,
  vehicle_type text,
  from_location text,
  to_location text,
  transfer_datetime timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_package_hotels_package_id ON package_hotels(package_id);
CREATE INDEX IF NOT EXISTS idx_package_flights_package_id ON package_flights(package_id);
CREATE INDEX IF NOT EXISTS idx_package_transfers_package_id ON package_transfers(package_id);

-- ============================================================
-- TABLE: quotations
-- ============================================================
CREATE TABLE quotations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_number text UNIQUE,
  lead_id          uuid REFERENCES leads(id),
  customer_id      uuid REFERENCES customers(id),
  package_id       uuid REFERENCES tour_packages(id),
  destination      text,
  travel_from      date,
  travel_to        date,
  adults           int NOT NULL DEFAULT 1,
  children         int NOT NULL DEFAULT 0,
  total_amount     bigint NOT NULL DEFAULT 0,
  discount_amount  bigint NOT NULL DEFAULT 0,
  final_amount     bigint NOT NULL DEFAULT 0,
  status           quotation_status NOT NULL DEFAULT 'draft',
  valid_until      date,
  public_share_token uuid DEFAULT gen_random_uuid(),
  notes            text, -- customer-facing notes
  branch_id        uuid NOT NULL REFERENCES branches(id),
  is_deleted       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES users(id),
  -- added in 003_quotations_full.sql
  base_amount      bigint NOT NULL DEFAULT 0,
  gst_amount       bigint NOT NULL DEFAULT 0,
  cost_amount      bigint NOT NULL DEFAULT 0,
  profit_margin    numeric(5,2) NOT NULL DEFAULT 0,
  internal_notes   text,
  approved_by      uuid REFERENCES users(id),
  version          int NOT NULL DEFAULT 1
);

CREATE TABLE quotation_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  item_type    text, -- hotel, transport, activity, flight, other (legacy, kept for compat)
  description  text,
  quantity     int NOT NULL DEFAULT 1,
  unit_price   bigint NOT NULL DEFAULT 0,
  total_price  bigint NOT NULL DEFAULT 0,
  is_deleted   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- added in 003_quotations_full.sql
  category      text, -- hotel/flight/transport/activity/visa/insurance/guide/other
  markup_pct    numeric(5,2) NOT NULL DEFAULT 0,
  unit_cost     bigint,
  selling_price bigint
);

CREATE TABLE quotation_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  version      int NOT NULL,
  snapshot     jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES users(id)
);

-- ============================================================
-- TABLE: bookings (+ approval pipeline from 00022)
-- ============================================================
CREATE TABLE bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_number    text UNIQUE,
  quotation_id      uuid REFERENCES quotations(id),
  customer_id       uuid NOT NULL REFERENCES customers(id),
  package_id        uuid REFERENCES tour_packages(id),
  itinerary_snapshot jsonb, -- frozen copy of itinerary at time of booking
  travel_from       date,
  travel_to         date,
  adults            int NOT NULL DEFAULT 1,
  children          int NOT NULL DEFAULT 0,
  total_amount      bigint NOT NULL DEFAULT 0,
  paid_amount       bigint NOT NULL DEFAULT 0,
  status            booking_status NOT NULL DEFAULT 'pending_approval',
  approved_by       uuid REFERENCES users(id),
  approved_at       timestamptz,
  activity_status   text, -- e.g. upcoming, ongoing, completed — free text tag for ops board
  branch_id         uuid NOT NULL REFERENCES branches(id),
  is_deleted        boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES users(id)
);

CREATE TABLE booking_travelers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  passport_number text,
  dob         date,
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE booking_checklist (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  item        text NOT NULL,
  is_done     boolean NOT NULL DEFAULT false,
  done_by     uuid REFERENCES users(id),
  done_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- daily PTA (pre-travel-arrangement) checklist, from 00030
CREATE TABLE daily_pta_checklist (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  check_date  date NOT NULL,
  item        text NOT NULL,
  is_done     boolean NOT NULL DEFAULT false,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- PTA / trip reviews, from 00023
CREATE TABLE pta_reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  rating      int,
  feedback    text,
  reviewed_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hotel_bookings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  hotel_id    uuid REFERENCES hotels(id),
  vendor_id   uuid REFERENCES vendors(id),
  check_in    date,
  check_out   date,
  rooms       int NOT NULL DEFAULT 1,
  cost        bigint DEFAULT 0,
  confirmation_number text,
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE flight_bookings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  airline     text,
  flight_number text,
  departure_airport text,
  arrival_airport text,
  departure_at timestamptz,
  arrival_at   timestamptz,
  pnr          text,
  cost         bigint DEFAULT 0,
  is_deleted   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transport_bookings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  transport_option_id uuid REFERENCES transport_options(id),
  vendor_id   uuid REFERENCES vendors(id),
  from_date   date,
  to_date     date,
  cost        bigint DEFAULT 0,
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- FINANCE
-- ============================================================
CREATE TABLE invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text UNIQUE,
  booking_id     uuid REFERENCES bookings(id),
  customer_id    uuid REFERENCES customers(id),
  amount         bigint NOT NULL DEFAULT 0,
  tax_amount     bigint NOT NULL DEFAULT 0,
  total_amount   bigint NOT NULL DEFAULT 0,
  status         payment_status NOT NULL DEFAULT 'pending',
  due_date       date,
  branch_id      uuid NOT NULL REFERENCES branches(id),
  is_deleted     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES users(id)
);

CREATE TABLE payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid REFERENCES invoices(id),
  booking_id  uuid REFERENCES bookings(id),
  amount      bigint NOT NULL DEFAULT 0,
  method      text, -- cash, card, upi, bank_transfer
  reference   text,
  paid_at     timestamptz NOT NULL DEFAULT now(),
  branch_id   uuid NOT NULL REFERENCES branches(id),
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id)
);

CREATE TABLE payment_installments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  due_date    date NOT NULL,
  amount      bigint NOT NULL DEFAULT 0,
  status      payment_status NOT NULL DEFAULT 'pending',
  paid_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refunds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid REFERENCES bookings(id),
  amount      bigint NOT NULL DEFAULT 0,
  reason      text,
  approved_by uuid REFERENCES users(id),
  status      text DEFAULT 'pending', -- pending, approved, rejected, paid
  branch_id   uuid NOT NULL REFERENCES branches(id),
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id)
);

CREATE TABLE expenses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid REFERENCES bookings(id),
  category    text,
  amount      bigint NOT NULL DEFAULT 0,
  notes       text,
  branch_id   uuid NOT NULL REFERENCES branches(id),
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id)
);

CREATE TABLE vendor_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id   uuid NOT NULL REFERENCES vendors(id),
  booking_id  uuid REFERENCES bookings(id),
  amount      bigint NOT NULL DEFAULT 0,
  status      payment_status NOT NULL DEFAULT 'pending',
  paid_at     timestamptz,
  branch_id   uuid NOT NULL REFERENCES branches(id),
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id)
);

-- ============================================================
-- TASKS
-- ============================================================
CREATE TABLE tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  description text,
  related_type text, -- lead, customer, booking, quotation
  related_id  uuid,
  assigned_to uuid REFERENCES users(id),
  due_date    timestamptz,
  priority    task_priority NOT NULL DEFAULT 'medium',
  status      task_status NOT NULL DEFAULT 'open',
  branch_id   uuid NOT NULL REFERENCES branches(id),
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id)
);

-- ============================================================
-- EMPLOYEE JOINING WORKFLOW (from 00027)
-- ============================================================
CREATE TABLE employee_joining_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name    text NOT NULL,
  email        text NOT NULL,
  phone        text,
  role_id      uuid REFERENCES roles(id),
  branch_id    uuid REFERENCES branches(id),
  status       text NOT NULL DEFAULT 'pending', -- pending, approved, rejected
  requested_by uuid REFERENCES users(id),
  approved_by  uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- FILE STORAGE (R2 metadata only — actual bytes live in Cloudflare R2)
-- ============================================================
CREATE TABLE files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name      text NOT NULL,
  file_type      text,
  file_size      bigint,
  r2_object_key  text NOT NULL UNIQUE,
  related_type   text, -- customer_document, quotation, booking, other
  related_id     uuid,
  uploaded_by    uuid REFERENCES users(id),
  branch_id      uuid REFERENCES branches(id),
  is_deleted     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- updated_at trigger helper (kept from Hala's convention)
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY['branches','roles','users','leads','customers',
      'customer_documents','customer_family_members','hotels','vendors',
      'tour_packages','quotations','bookings','invoices','tasks',
      'employee_joining_requests'])
  LOOP
    EXECUTE format('CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t);
  END LOOP;
END $$;
-- 004_bookings_full.sql
-- Additive migration for the Bookings & Operations module.
-- Never removes/renames existing columns.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending_approval',
  ADD COLUMN IF NOT EXISTS approval_status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS advance_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ops_executive_id uuid REFERENCES users(id);

ALTER TABLE booking_travelers
  ADD COLUMN IF NOT EXISTS nationality text,
  ADD COLUMN IF NOT EXISTS passport_expiry date,
  ADD COLUMN IF NOT EXISTS is_lead_traveler boolean NOT NULL DEFAULT false;

ALTER TABLE hotel_bookings
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

ALTER TABLE flight_bookings
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

ALTER TABLE transport_bookings
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

ALTER TABLE vendor_payments
  ADD COLUMN IF NOT EXISTS notes text;

CREATE INDEX IF NOT EXISTS idx_bookings_ops_executive_id ON bookings(ops_executive_id);
CREATE INDEX IF NOT EXISTS idx_bookings_approval_status ON bookings(approval_status);

-- 005_finance_full.sql
-- Additive migration for the Finance module (invoices/payments/collections).
-- Never removes/renames existing columns. Mirrors Hala's finance UI.

-- Payment transaction status is distinct from the invoice-level `payment_status`
-- enum (pending/partial/paid/overdue/refunded) already used by invoices &
-- payment_installments -- a single payment row is a pending/completed/failed
-- transaction, not an invoice lifecycle state.
DO $$ BEGIN
  CREATE TYPE payment_txn_status AS ENUM ('pending', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'tax_invoice'; -- proforma, tax_invoice, credit_note

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS status payment_txn_status NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS transaction_id text,
  ADD COLUMN IF NOT EXISTS collected_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Existing rows recorded via the Bookings module's recordPayment are all
-- accountant-direct entries that already counted toward paid_amount -- the
-- DEFAULT 'completed' above preserves that for them. New PTA field
-- collections are inserted explicitly with status='pending'.

CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_collected_by ON payments(collected_by);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments(paid_at);
CREATE INDEX IF NOT EXISTS idx_payment_installments_due_date ON payment_installments(due_date);
CREATE INDEX IF NOT EXISTS idx_payment_installments_status ON payment_installments(status);
-- 006_settings_reports.sql
-- WhatsApp templates + message logs for the Settings > WhatsApp module.
-- Reports and the rest of Settings (branches/roles/users) are computed
-- against tables that already exist — no new tables needed for those.

CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  body_template  text NOT NULL,
  is_active      boolean NOT NULL DEFAULT true,
  branch_id      uuid REFERENCES branches(id),
  is_deleted     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS whatsapp_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_number      text NOT NULL,
  template_id    uuid REFERENCES whatsapp_templates(id),
  template_name  text,
  status         text NOT NULL DEFAULT 'pending',
  sent_at        timestamptz,
  branch_id      uuid REFERENCES branches(id),
  is_deleted     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Write-only WhatsApp Business API configuration. We never store or echo
-- back the actual access token in application responses; this row just
-- tracks whether a configuration has been saved and when.
CREATE TABLE IF NOT EXISTS whatsapp_config (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number_id        text,
  business_account_id    text,
  access_token_encrypted text,
  is_configured          boolean NOT NULL DEFAULT false,
  configured_at          timestamptz,
  configured_by          uuid REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_branch ON whatsapp_templates(branch_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_branch ON whatsapp_logs(branch_id) WHERE is_deleted = false;

INSERT INTO whatsapp_templates (name, body_template, is_active) VALUES
  ('Booking Confirmation', 'Hi {{customer_name}}, your booking with {{company_name}} for {{destination}} on {{travel_date}} ({{guest_count}} guests) is confirmed! Package: {{package_name}}. Your executive {{executive_name}} ({{executive_phone}}) will be in touch.', true),
  ('Payment Reminder', 'Hi {{customer_name}}, this is a reminder that a payment is due for your upcoming trip to {{destination}} on {{travel_date}}. Please contact {{executive_name}} ({{executive_phone}}) to complete your payment. — {{company_name}}', true),
  ('Itinerary Shared', 'Hi {{customer_name}}, your itinerary for {{package_name}} to {{destination}} (travel date {{travel_date}}) has been shared. Reach out to {{executive_name}} at {{executive_phone}} for any questions. — {{company_name}}', true),
  ('Thank You', 'Hi {{customer_name}}, thank you for travelling with {{company_name}}! We hope you enjoyed your trip to {{destination}}. Your executive {{executive_name}} would love to hear your feedback.', true)
ON CONFLICT DO NOTHING;

-- Idempotency tracking for Meta (Facebook/Instagram) Lead Ads webhook
-- ingestion. Meta retries webhook deliveries, so we record each
-- leadgen_id once and skip re-processing on retry.
CREATE TABLE IF NOT EXISTS meta_lead_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leadgen_id   text NOT NULL UNIQUE,
  lead_id      uuid REFERENCES leads(id),
  form_name    text,
  ad_name      text,
  raw_payload  jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Per-phone-number conversation state for the inbound WhatsApp bot:
-- greet -> show package list -> customer taps one -> send that package's
-- itinerary PDF.
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number     text NOT NULL UNIQUE,
  contact_name     text,
  state            text NOT NULL DEFAULT 'greeted',
  context          jsonb,
  last_message_at  timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Where the bot finds the itinerary PDF to send for a given package,
-- uploaded via the existing /files/upload endpoint (folder=itineraries)
-- and attached to the package from the Packages editor.
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS itinerary_pdf_object_key text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS itinerary_pdf_file_name text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS whatsapp_template_id text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS whatsapp_template_name text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS whatsapp_template_status text NOT NULL DEFAULT 'NOT_SUBMITTED';
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS whatsapp_template_rejection_reason text;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS whatsapp_template_submitted_at timestamptz;
ALTER TABLE tour_packages ADD COLUMN IF NOT EXISTS whatsapp_template_checked_at timestamptz;
ALTER TABLE whatsapp_automation_settings ADD COLUMN IF NOT EXISTS itinerary_template_id text;
ALTER TABLE whatsapp_automation_settings ADD COLUMN IF NOT EXISTS itinerary_template_name text;
ALTER TABLE whatsapp_automation_settings ADD COLUMN IF NOT EXISTS itinerary_template_status text NOT NULL DEFAULT 'NOT_SUBMITTED';
ALTER TABLE whatsapp_automation_settings ADD COLUMN IF NOT EXISTS itinerary_template_rejection_reason text;
ALTER TABLE whatsapp_automation_settings ADD COLUMN IF NOT EXISTS itinerary_template_checked_at timestamptz;
CREATE TABLE IF NOT EXISTS lead_collaborators (
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_lead_collaborators_user ON lead_collaborators(user_id, lead_id);
CREATE TABLE IF NOT EXISTS lead_assignment_state (
  branch_id uuid PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
  last_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS message_id text;
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS package_id uuid REFERENCES tour_packages(id) ON DELETE SET NULL;
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'template';
ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS error_message text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_logs_message_id ON whatsapp_logs(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_lead ON whatsapp_logs(lead_id, created_at DESC);
CREATE TABLE IF NOT EXISTS whatsapp_automation_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  live_mode boolean NOT NULL DEFAULT false,
  test_numbers text[] NOT NULL DEFAULT ARRAY['917338914677','917358723600','919944946955']::text[],
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);
INSERT INTO whatsapp_automation_settings(id) VALUES(true) ON CONFLICT(id) DO NOTHING;
