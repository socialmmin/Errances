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

export type Lead = {
    id: string;
    name: string;
    email: string;
    phone: string;
    status: 'new' | 'contacted' | 'qualified' | 'proposal_sent' | 'converted' | 'lost';
    source: string;
    tour_interest?: string;
    selected_package?: string;
    selection_timestamp?: string;
    budget?: number;
    travel_date?: string;
    assigned_staff_id?: string | null;
    created_at: string;
    notes?: string;
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
