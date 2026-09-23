-- Errances Voyages CRM — PostgreSQL schema (replaces Supabase)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS staffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    access_key TEXT UNIQUE,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'sales_manager', 'sales_executive', 'support')),
    avatar_url TEXT,
    department TEXT,
    phone TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    password_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent upgrades for tables created by earlier versions of this schema
-- (safe to re-run on every boot; ALTER ... IF NOT EXISTS / DROP ... IF EXISTS
-- are no-ops once applied).
ALTER TABLE staffs ADD COLUMN IF NOT EXISTS access_key TEXT;
DO $$ BEGIN
    ALTER TABLE staffs ADD CONSTRAINT staffs_access_key_key UNIQUE (access_key);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE staffs DROP CONSTRAINT IF EXISTS staffs_status_check;
ALTER TABLE staffs ADD CONSTRAINT staffs_status_check CHECK (status IN ('active', 'inactive'));

-- Kept alongside `staffs` (legacy dual-table design used by the frontend for
-- lead-assignment FK bookkeeping); mirrors a subset of staff columns.
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES staffs(id) ON DELETE CASCADE,
    full_name TEXT,
    email TEXT,
    role TEXT
);

CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_number SERIAL,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    whatsapp_number TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    source TEXT,
    campaign TEXT,
    tour_interest TEXT,
    requirement TEXT,
    selected_package TEXT,
    selection_timestamp TIMESTAMPTZ,
    budget NUMERIC,
    expected_closing_date DATE,
    travel_date DATE,
    assigned_staff_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    lead_owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    dob DATE,
    gender TEXT CHECK (gender IN ('male', 'female', 'other')),
    passport_number TEXT,
    photo_url TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    country TEXT,
    pincode TEXT,
    next_action TEXT,
    last_contacted_at TIMESTAMPTZ,
    follow_up_date DATE,
    follow_up_time TEXT,
    follow_up_type TEXT,
    follow_up_notes TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent upgrades for `leads` (see comment above the staffs block).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_number SERIAL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS campaign TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS requirement TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS expected_closing_date DATE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium';
DO $$ BEGIN
    ALTER TABLE leads ADD CONSTRAINT leads_priority_check CHECK (priority IN ('low', 'medium', 'high', 'urgent'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS dob DATE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS gender TEXT;
DO $$ BEGIN
    ALTER TABLE leads ADD CONSTRAINT leads_gender_check CHECK (gender IN ('male', 'female', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS pincode TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_action TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_date DATE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_time TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_type TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_notes TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS passport_number TEXT;
-- `status` is now admin-configurable (see lead_statuses below) rather than a fixed CHECK enum.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;

-- Admin-configurable lead pipeline stages.
CREATE TABLE IF NOT EXISTS lead_statuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'slate',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_closed_won BOOLEAN NOT NULL DEFAULT FALSE,
    is_closed_lost BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO lead_statuses (key, label, color, sort_order, is_closed_won, is_closed_lost) VALUES
    ('new', 'New', 'rose', 0, FALSE, FALSE),
    ('contacted', 'Contacted', 'blue', 1, FALSE, FALSE),
    ('follow_up', 'Follow-up', 'amber', 2, FALSE, FALSE),
    ('qualified', 'Qualified', 'amber', 3, FALSE, FALSE),
    ('proposal', 'Proposal', 'indigo', 4, FALSE, FALSE),
    ('negotiation', 'Negotiation', 'indigo', 5, FALSE, FALSE),
    ('won', 'Won', 'emerald', 6, TRUE, FALSE),
    ('lost', 'Lost', 'slate', 7, FALSE, TRUE),
    ('junk', 'Junk', 'slate', 8, FALSE, TRUE),
    ('not_interested', 'Not Interested', 'slate', 9, FALSE, TRUE),
    ('duplicate', 'Duplicate', 'slate', 10, FALSE, TRUE)
ON CONFLICT (key) DO NOTHING;

-- Per-lead chronological activity feed (auto-logged by the backend).
CREATE TABLE IF NOT EXISTS lead_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    actor_id UUID,
    actor_name TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Status change audit trail.
CREATE TABLE IF NOT EXISTS lead_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    previous_status TEXT,
    new_status TEXT NOT NULL,
    changed_by UUID,
    changed_by_name TEXT,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Follow-ups (a lead can have many, past and future).
CREATE TABLE IF NOT EXISTS lead_followups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    due_date DATE NOT NULL,
    due_time TEXT,
    type TEXT NOT NULL DEFAULT 'call' CHECK (type IN ('call', 'whatsapp', 'email', 'meeting', 'visit', 'other')),
    notes TEXT,
    assigned_staff_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'cancelled')),
    created_by UUID,
    created_by_name TEXT,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Documents attached to a lead (passport/ID/quotation/invoice/etc).
CREATE TABLE IF NOT EXISTS lead_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    doc_type TEXT NOT NULL DEFAULT 'other',
    file_url TEXT NOT NULL,
    uploaded_by UUID,
    uploaded_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Simple manual payment ledger per lead (no payment gateway integration).
CREATE TABLE IF NOT EXISTS lead_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL,
    method TEXT,
    note TEXT,
    recorded_by UUID,
    recorded_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_id ON lead_activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_status_history_lead_id ON lead_status_history(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_followups_lead_id ON lead_followups(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_followups_due_date ON lead_followups(due_date);
CREATE INDEX IF NOT EXISTS idx_lead_documents_lead_id ON lead_documents(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_payments_lead_id ON lead_payments(lead_id);

CREATE TABLE IF NOT EXISTS tours (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    destination TEXT,
    price NUMERIC,
    duration INTEGER,
    description TEXT,
    itinerary JSONB,
    inclusions TEXT[],
    exclusions TEXT[],
    images TEXT[],
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    sender TEXT NOT NULL CHECK (sender IN ('user', 'contact')),
    content TEXT NOT NULL,
    status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT UNIQUE NOT NULL,
    stage TEXT NOT NULL CHECK (stage IN ('collect_name', 'package_selection', 'completed')),
    selected_package TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- --- WhatsApp Business messaging service (Twilio) ---
-- Idempotent upgrades to the tables above, which originally only backed the
-- automated lead-capture bot. They now double as the general-purpose agent
-- inbox's Conversation/Message entities (one whatsapp_conversations row per
-- phone number, already enforced by its UNIQUE(phone) constraint).

ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS contact_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS assigned_staff_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';
DO $$ BEGIN
    ALTER TABLE whatsapp_conversations ADD CONSTRAINT whatsapp_conversations_status_check CHECK (status IN ('open', 'pending', 'resolved'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS unread_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;
ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS last_message_preview TEXT;
ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;
ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'twilio';

ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS twilio_sid TEXT;
DO $$ BEGIN
    ALTER TABLE whatsapp_messages ADD CONSTRAINT whatsapp_messages_twilio_sid_key UNIQUE (twilio_sid);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES whatsapp_conversations(id) ON DELETE SET NULL;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS direction TEXT;
UPDATE whatsapp_messages SET direction = CASE WHEN sender = 'user' THEN 'outbound' ELSE 'inbound' END WHERE direction IS NULL;
ALTER TABLE whatsapp_messages ALTER COLUMN direction SET NOT NULL;
DO $$ BEGIN
    ALTER TABLE whatsapp_messages ADD CONSTRAINT whatsapp_messages_direction_check CHECK (direction IN ('inbound', 'outbound'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text';
DO $$ BEGIN
    ALTER TABLE whatsapp_messages ADD CONSTRAINT whatsapp_messages_message_type_check CHECK (message_type IN ('text', 'image', 'document', 'audio', 'video', 'template', 'location'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_content_type TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS error_code TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS sent_by UUID REFERENCES staffs(id) ON DELETE SET NULL;
ALTER TABLE whatsapp_messages DROP CONSTRAINT IF EXISTS whatsapp_messages_status_check;
ALTER TABLE whatsapp_messages ADD CONSTRAINT whatsapp_messages_status_check CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'undelivered'));

-- Approved Twilio WhatsApp content templates agents can pick from.
CREATE TABLE IF NOT EXISTS whatsapp_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    twilio_content_sid TEXT NOT NULL,
    category TEXT DEFAULT 'utility',
    language TEXT NOT NULL DEFAULT 'en',
    body_preview TEXT,
    variables JSONB NOT NULL DEFAULT '[]',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID,
    created_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
    ALTER TABLE whatsapp_templates ADD CONSTRAINT whatsapp_templates_content_sid_key UNIQUE (twilio_content_sid);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;

-- Singleton admin-configurable WhatsApp settings (never holds secrets — those stay in env vars).
CREATE TABLE IF NOT EXISTS whatsapp_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    business_name TEXT,
    default_template_id UUID REFERENCES whatsapp_templates(id) ON DELETE SET NULL,
    session_window_hours INTEGER NOT NULL DEFAULT 24,
    updated_by UUID,
    updated_by_name TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO whatsapp_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_contact_lead_id ON whatsapp_conversations(contact_lead_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_assigned_staff_id ON whatsapp_conversations(assigned_staff_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_last_message_at ON whatsapp_conversations(last_message_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_id ON whatsapp_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_twilio_sid ON whatsapp_messages(twilio_sid);

CREATE TABLE IF NOT EXISTS user_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    event_type TEXT NOT NULL,
    page_path TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_staff ON leads(assigned_staff_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_lead_id ON whatsapp_messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_created_at ON whatsapp_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity(user_id);
