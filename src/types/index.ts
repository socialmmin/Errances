export type User = {
    id: string;
    email: string;
    access_key?: string;
    full_name: string;
    role: 'admin' | 'sales_manager' | 'sales_executive' | 'support';
    avatar_url?: string;
    department?: string;
    phone?: string;
    status?: 'active' | 'inactive';
    permissions?: string[];
};

export type LeadPriority = 'low' | 'medium' | 'high' | 'urgent';
export type LeadGender = 'male' | 'female' | 'other';

export type Lead = {
    id: string;
    lead_number?: number;
    name: string;
    email: string;
    phone: string;
    whatsapp_number?: string | null;
    // Admin-configurable via the `lead_statuses` table — not a fixed union anymore.
    status: string;
    source: string;
    campaign?: string | null;
    tour_interest?: string;
    requirement?: string | null;
    selected_package?: string;
    selection_timestamp?: string;
    budget?: number;
    expected_closing_date?: string | null;
    travel_date?: string;
    assigned_staff_id?: string | null;
    lead_owner_id?: string | null;
    priority?: LeadPriority;
    dob?: string | null;
    gender?: LeadGender | null;
    passport_number?: string | null;
    photo_url?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    pincode?: string | null;
    next_action?: string | null;
    last_contacted_at?: string | null;
    follow_up_date?: string | null;
    follow_up_time?: string | null;
    follow_up_type?: string | null;
    follow_up_notes?: string | null;
    created_at: string;
    notes?: string;
};

export type LeadStatusConfig = {
    id: string;
    key: string;
    label: string;
    color: string;
    sort_order: number;
    is_closed_won: boolean;
    is_closed_lost: boolean;
};

export type LeadActivity = {
    id: string;
    lead_id: string;
    type: string;
    description: string;
    actor_id: string | null;
    actor_name: string | null;
    metadata: Record<string, any> | null;
    created_at: string;
};

export type LeadFollowup = {
    id: string;
    lead_id: string;
    due_date: string;
    due_time?: string | null;
    type: 'call' | 'whatsapp' | 'email' | 'meeting' | 'visit' | 'other';
    notes?: string | null;
    assigned_staff_id?: string | null;
    priority: LeadPriority;
    status: 'pending' | 'done' | 'cancelled';
    created_by?: string | null;
    created_by_name?: string | null;
    completed_at?: string | null;
    created_at: string;
};

export type LeadDocument = {
    id: string;
    lead_id: string;
    name: string;
    doc_type: string;
    file_url: string;
    uploaded_by?: string | null;
    uploaded_by_name?: string | null;
    created_at: string;
};

export type LeadPayment = {
    id: string;
    lead_id: string;
    amount: number;
    method?: string | null;
    note?: string | null;
    recorded_by?: string | null;
    recorded_by_name?: string | null;
    created_at: string;
};

export type WhatsAppConversation = {
    automation_step?: string;
    automation_data?: Record<string, string>;
    bot_paused?: boolean;
    automation_error?: string | null;
    opted_out?: boolean;
    id: string;
    phone: string;
    stage: string;
    selected_package: string | null;
    contact_lead_id: string | null;
    assigned_staff_id: string | null;
    status: 'open' | 'pending' | 'resolved';
    unread_count: number;
    last_message_at: string | null;
    last_message_preview: string | null;
    last_inbound_at: string | null;
    channel: string;
    created_at: string;
    updated_at: string;
};

export type WhatsAppMessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'undelivered';

export type WhatsAppMessageRecord = {
    id: string;
    lead_id: string;
    conversation_id: string | null;
    sender: 'user' | 'contact';
    content: string;
    status: WhatsAppMessageStatus;
    direction: 'inbound' | 'outbound';
    message_type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'template' | 'location';
    media_url: string | null;
    media_content_type: string | null;
    error_code: string | null;
    error_message: string | null;
    sent_by: string | null;
    twilio_sid: string | null;
    created_at: string;
};

export type WhatsAppTemplateStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'paused' | 'disabled';

export type WhatsAppTemplate = {
    id: string;
    name: string;
    twilio_content_sid: string;
    category: string;
    language: string;
    body_preview: string | null;
    variables: string[];
    is_active: boolean;
    status: WhatsAppTemplateStatus;
    rejection_reason: string | null;
    content_type: string;
    header_text: string | null;
    footer_text: string | null;
    buttons: Array<{ type: string; title: string; url?: string; phone?: string }>;
    sample_values: Record<string, string>;
    synced_at: string | null;
    created_by?: string | null;
    created_by_name?: string | null;
    created_at: string;
    updated_at: string;
};

export type WhatsAppSettings = {
    connected: boolean;
    whatsappNumber: string | null;
    webhookConfigured: boolean;
    incomingWebhookUrl: string | null;
    statusWebhookUrl: string | null;
    activeTemplateCount: number;
    canManage: boolean;
    settings: {
        id: number;
        business_name: string | null;
        default_template_id: string | null;
        session_window_hours: number;
        automation_enabled?: boolean;
        updated_at: string;
    } | null;
};

export type TourPackage = {
    id: string;
    title: string;
    destination: string;
    price: number;
    duration: number; // days
    description: string;
    itinerary: any; // Rich text content
    inclusions?: string[];
    exclusions?: string[];
    images: string[];
    status: 'active' | 'inactive';
};

export type KPI = {
    label: string;
    value: string | number;
    change?: number; // percentage
    icon?: string;
    link?: string;
};
