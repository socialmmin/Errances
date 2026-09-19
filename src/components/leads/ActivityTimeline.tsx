import { useEffect, useState } from 'react';
import { useAppStore } from '@/store';
import { format } from 'date-fns';
import {
    UserPlus, RefreshCw, MessageSquare, FileText, IndianRupee, CalendarClock,
    StickyNote, ArrowRightLeft, Sparkles,
} from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import type { LeadActivity } from '@/types';

const TYPE_META: Record<string, { icon: any; color: string }> = {
    created: { icon: Sparkles, color: 'bg-indigo-50 text-indigo-600' },
    status_change: { icon: RefreshCw, color: 'bg-amber-50 text-amber-600' },
    assignment: { icon: ArrowRightLeft, color: 'bg-blue-50 text-blue-600' },
    priority_change: { icon: Sparkles, color: 'bg-rose-50 text-rose-600' },
    whatsapp: { icon: MessageSquare, color: 'bg-emerald-50 text-emerald-600' },
    call: { icon: UserPlus, color: 'bg-blue-50 text-blue-600' },
    email: { icon: FileText, color: 'bg-slate-100 text-slate-600' },
    document: { icon: FileText, color: 'bg-indigo-50 text-indigo-600' },
    payment: { icon: IndianRupee, color: 'bg-emerald-50 text-emerald-600' },
    followup: { icon: CalendarClock, color: 'bg-amber-50 text-amber-600' },
    followup_done: { icon: CalendarClock, color: 'bg-emerald-50 text-emerald-600' },
    note: { icon: StickyNote, color: 'bg-slate-100 text-slate-600' },
};

export function ActivityTimeline({ leadId }: { leadId: string }) {
    const { fetchLeadActivities, logLeadActivity } = useAppStore();
    const [activities, setActivities] = useState<LeadActivity[]>([]);
    const [note, setNote] = useState('');

    const load = async () => setActivities(await fetchLeadActivities(leadId));
    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [leadId]);

    const handleAddNote = async () => {
        if (!note.trim()) return;
        await logLeadActivity(leadId, 'note', note.trim());
        setNote('');
        load();
    };

    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                <Textarea placeholder="Add a note to this lead's timeline…" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="flex-1" />
                <Button onClick={handleAddNote} className="self-end h-9">Add Note</Button>
            </div>

            <div className="relative pl-6">
                <div className="absolute left-[11px] top-2 bottom-2 w-px bg-slate-200" />
                {activities.length === 0 && <p className="text-sm text-slate-400 italic text-center py-6">No activity yet.</p>}
                <div className="space-y-5">
                    {activities.map((a) => {
                        const meta = TYPE_META[a.type] || { icon: StickyNote, color: 'bg-slate-100 text-slate-500' };
                        const Icon = meta.icon;
                        return (
                            <div key={a.id} className="relative flex gap-3">
                                <div className={`absolute -left-6 h-6 w-6 rounded-full flex items-center justify-center ${meta.color} ring-4 ring-white`}>
                                    <Icon className="h-3 w-3" />
                                </div>
                                <div className="flex-1 pl-3">
                                    <p className="text-sm font-semibold text-slate-800">{a.description}</p>
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">
                                        {format(new Date(a.created_at), 'dd MMM yyyy · h:mm a')} {a.actor_name ? `· ${a.actor_name}` : ''}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
