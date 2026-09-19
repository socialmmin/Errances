import type { Lead, LeadPriority, LeadStatusConfig } from '@/types';

// --- Lead ID display ---

export function formatLeadNumber(lead: Pick<Lead, 'lead_number' | 'id'>): string {
    if (lead.lead_number) return `LD-${String(lead.lead_number).padStart(6, '0')}`;
    return `LD-${lead.id.slice(0, 6).toUpperCase()}`;
}

// --- Age calculation ---

export function calculateAge(dob?: string | null): number | null {
    if (!dob) return null;
    const birth = new Date(dob);
    if (Number.isNaN(birth.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    return age;
}

// --- Default pipeline (used until /api/db/lead_statuses loads, and as a safe fallback) ---

export const DEFAULT_LEAD_STATUSES: LeadStatusConfig[] = [
    { id: 'new', key: 'new', label: 'New', color: 'rose', sort_order: 0, is_closed_won: false, is_closed_lost: false },
    { id: 'contacted', key: 'contacted', label: 'Contacted', color: 'blue', sort_order: 1, is_closed_won: false, is_closed_lost: false },
    { id: 'follow_up', key: 'follow_up', label: 'Follow-up', color: 'amber', sort_order: 2, is_closed_won: false, is_closed_lost: false },
    { id: 'qualified', key: 'qualified', label: 'Qualified', color: 'amber', sort_order: 3, is_closed_won: false, is_closed_lost: false },
    { id: 'proposal', key: 'proposal', label: 'Proposal', color: 'indigo', sort_order: 4, is_closed_won: false, is_closed_lost: false },
    { id: 'negotiation', key: 'negotiation', label: 'Negotiation', color: 'indigo', sort_order: 5, is_closed_won: false, is_closed_lost: false },
    { id: 'won', key: 'won', label: 'Won', color: 'emerald', sort_order: 6, is_closed_won: true, is_closed_lost: false },
    { id: 'lost', key: 'lost', label: 'Lost', color: 'slate', sort_order: 7, is_closed_won: false, is_closed_lost: true },
    { id: 'junk', key: 'junk', label: 'Junk', color: 'slate', sort_order: 8, is_closed_won: false, is_closed_lost: true },
    { id: 'not_interested', key: 'not_interested', label: 'Not Interested', color: 'slate', sort_order: 9, is_closed_won: false, is_closed_lost: true },
    { id: 'duplicate', key: 'duplicate', label: 'Duplicate', color: 'slate', sort_order: 10, is_closed_won: false, is_closed_lost: true },
];

const COLOR_CLASSES: Record<string, string> = {
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    slate: 'bg-slate-100 text-slate-600 border-slate-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    teal: 'bg-teal-50 text-teal-700 border-teal-200',
};

const COLOR_DOT_CLASSES: Record<string, string> = {
    rose: 'bg-rose-500',
    blue: 'bg-blue-500',
    amber: 'bg-amber-500',
    indigo: 'bg-indigo-500',
    emerald: 'bg-emerald-500',
    slate: 'bg-slate-400',
    red: 'bg-red-500',
    teal: 'bg-teal-500',
};

export function statusBadgeClass(color: string): string {
    return COLOR_CLASSES[color] || COLOR_CLASSES.slate;
}

export function statusDotClass(color: string): string {
    return COLOR_DOT_CLASSES[color] || COLOR_DOT_CLASSES.slate;
}

export function getStatusConfig(statuses: LeadStatusConfig[], key: string): LeadStatusConfig {
    return (
        statuses.find((s) => s.key === key) ||
        DEFAULT_LEAD_STATUSES.find((s) => s.key === key) || {
            id: key,
            key,
            label: key ? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Unknown',
            color: 'slate',
            sort_order: 999,
            is_closed_won: false,
            is_closed_lost: false,
        }
    );
}

// --- Priority ---

export const PRIORITY_CONFIG: Record<LeadPriority, { label: string; className: string; dot: string }> = {
    low: { label: 'Low', className: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
    medium: { label: 'Medium', className: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
    high: { label: 'High', className: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
    urgent: { label: 'Urgent', className: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
};

// --- Follow-up helpers ---

export function isFollowupOverdue(dueDate: string, dueTime?: string | null): boolean {
    const now = new Date();
    const due = new Date(`${dueDate}T${dueTime || '23:59'}`);
    return due.getTime() < now.getTime();
}

export function isSameDay(dateStr: string, target: Date): boolean {
    const d = new Date(dateStr);
    return (
        d.getFullYear() === target.getFullYear() &&
        d.getMonth() === target.getMonth() &&
        d.getDate() === target.getDate()
    );
}

// --- Misc formatting shared across list/detail views ---

export function formatPhoneDisplay(phone?: string | null): string {
    return phone && phone.trim() ? phone : '—';
}

export function initialsFromName(name: string): string {
    return name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase())
        .join('');
}
