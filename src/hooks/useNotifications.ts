import { useMemo } from 'react';
import { useAppStore } from '@/store';
import { isFollowupOverdue, isSameDay } from '@/lib/leadUtils';

export type NotificationItem = {
    id: string;
    type: 'followup_overdue' | 'followup_today';
    title: string;
    subtitle: string;
    leadId: string;
    dueDate: string;
};

/** Real notifications derived from live follow-up data — no fabricated event types. */
export function useNotifications(): NotificationItem[] {
    const { followups, leads } = useAppStore();

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
                    leadId: f.lead_id,
                    dueDate: f.due_date,
                });
            } else if (isSameDay(f.due_date, today)) {
                items.push({
                    id: `today-${f.id}`,
                    type: 'followup_today',
                    title: `Follow-up due today — ${leadName}`,
                    subtitle: f.notes || 'No notes',
                    leadId: f.lead_id,
                    dueDate: f.due_date,
                });
            }
        }

        return items.sort((a, b) => (a.type === 'followup_overdue' ? -1 : 1) - (b.type === 'followup_overdue' ? -1 : 1));
    }, [followups, leads]);
}
