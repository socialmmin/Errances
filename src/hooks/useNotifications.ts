import { useMemo } from 'react';
import { useAppStore } from '@/store';
import { isFollowupOverdue, isSameDay } from '@/lib/leadUtils';

export type NotificationItem = {
    id: string;
    type: 'followup_overdue' | 'followup_today' | 'whatsapp_unread';
    title: string;
    subtitle: string;
    dueDate: string;
    link: string;
};

/** Real notifications derived from live follow-up + WhatsApp data — no fabricated event types. */
export function useNotifications(): NotificationItem[] {
    const { followups, leads, conversations, user } = useAppStore();

    return useMemo(() => {
        const today = new Date();
        const leadById = Object.fromEntries(leads.map((l) => [l.id, l]));
        const pending = followups.filter((f) => f.status === 'pending');

        const items: NotificationItem[] = [];
        for (const f of pending) {
            const lead = leadById[f.lead_id];
            const leadName = lead?.name || 'Unknown lead';
            if (isFollowupOverdue(f.due_date, f.due_time)) {
                items.push({
                    id: `overdue-${f.id}`,
                    type: 'followup_overdue',
                    title: `Overdue follow-up — ${leadName}`,
                    subtitle: f.notes || 'No notes',
                    dueDate: f.due_date,
                    link: `/leads/${f.lead_id}`,
                });
            } else if (isSameDay(f.due_date, today)) {
                items.push({
                    id: `today-${f.id}`,
                    type: 'followup_today',
                    title: `Follow-up due today — ${leadName}`,
                    subtitle: f.notes || 'No notes',
                    dueDate: f.due_date,
                    link: `/leads/${f.lead_id}`,
                });
            }
        }

        // Unread WhatsApp conversations — unassigned ones surface for everyone; assigned
        // ones only surface for the assigned agent (or admins/managers) to avoid noise.
        for (const c of conversations) {
            if (c.unread_count <= 0) continue;
            if (c.assigned_staff_id && c.assigned_staff_id !== user?.id && user?.role !== 'admin' && user?.role !== 'sales_manager') continue;
            const lead = c.contact_lead_id ? leadById[c.contact_lead_id] : null;
            items.push({
                id: `whatsapp-${c.id}`,
                type: 'whatsapp_unread',
                title: `${c.unread_count} new WhatsApp message${c.unread_count > 1 ? 's' : ''} — ${lead?.name || c.phone}`,
                subtitle: c.last_message_preview || '',
                dueDate: c.last_message_at || c.updated_at,
                link: '/whatsapp',
            });
        }

        return items.sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime());
    }, [followups, leads, conversations, user]);
}
