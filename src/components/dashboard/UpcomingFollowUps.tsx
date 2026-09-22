import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CalendarClock, ArrowRight, AlertTriangle } from 'lucide-react';
import { useAppStore } from '@/store';
import { isFollowupOverdue } from '@/lib/leadUtils';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

export function UpcomingFollowUps() {
    const { followups, leads } = useAppStore();
    const leadById = Object.fromEntries(leads.map((l) => [l.id, l]));

    const upcoming = followups
        .filter((f) => f.status === 'pending')
        .sort((a, b) => `${a.due_date}${a.due_time || ''}`.localeCompare(`${b.due_date}${b.due_time || ''}`))
        .slice(0, 5);

    return (
        <Card className="border-none shadow-sm rounded-3xl bg-white/70 backdrop-blur-sm overflow-hidden">
            <CardHeader className="border-b border-slate-100/50 pb-4 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                    <CalendarClock className="h-4 w-4 text-amber-500" /> Upcoming Follow-ups
                </CardTitle>
                {upcoming.length > 0 && (
                    <Link to={`/leads/${upcoming[0].lead_id}`} className="text-[11px] font-black text-indigo-600 hover:text-indigo-700 flex items-center gap-1 uppercase tracking-wide">
                        View <ArrowRight className="h-3 w-3" />
                    </Link>
                )}
            </CardHeader>
            <CardContent className="pt-4">
                {upcoming.length === 0 ? (
                    <p className="text-sm text-slate-400 italic text-center py-8">No follow-ups scheduled.</p>
                ) : (
                    <div className="space-y-1">
                        {upcoming.map((f) => {
                            const overdue = isFollowupOverdue(f.due_date, f.due_time);
                            const lead = leadById[f.lead_id];
                            return (
                                <Link
                                    key={f.id}
                                    to={`/leads/${f.lead_id}`}
                                    className="flex items-center gap-2.5 py-2 px-2 -mx-2 rounded-xl hover:bg-slate-50 transition-colors"
                                >
                                    <div className={cn('h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0', overdue ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600')}>
                                        {overdue ? <AlertTriangle className="h-3.5 w-3.5" /> : <CalendarClock className="h-3.5 w-3.5" />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-bold text-slate-800 truncate">{lead?.name || 'Unknown lead'}</p>
                                        <p className="text-[10px] text-slate-400 truncate">{f.notes || f.type}</p>
                                    </div>
                                    <span className={cn('text-[10px] font-black uppercase flex-shrink-0', overdue ? 'text-red-500' : 'text-slate-400')}>
                                        {format(new Date(f.due_date), 'dd MMM')}
                                    </span>
                                </Link>
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
