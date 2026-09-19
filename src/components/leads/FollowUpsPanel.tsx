import { useState } from 'react';
import { useAppStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Check, Trash2, Phone, MessageSquare, Mail, Users, MapPin, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { isFollowupOverdue, PRIORITY_CONFIG } from '@/lib/leadUtils';
import type { LeadPriority } from '@/types';

const TYPE_ICONS: Record<string, any> = { call: Phone, whatsapp: MessageSquare, email: Mail, meeting: Users, visit: MapPin, other: Calendar };

export function FollowUpsPanel({ leadId }: { leadId: string }) {
    const { followups, staff, addFollowup, updateFollowup, deleteFollowup, user } = useAppStore();
    const leadFollowups = followups.filter((f) => f.lead_id === leadId).sort((a, b) => a.due_date.localeCompare(b.due_date));

    const [showForm, setShowForm] = useState(false);
    const [dueDate, setDueDate] = useState('');
    const [dueTime, setDueTime] = useState('');
    const [type, setType] = useState('call');
    const [priority, setPriority] = useState<LeadPriority>('medium');
    const [assignedTo, setAssignedTo] = useState('');
    const [notes, setNotes] = useState('');

    const handleAdd = async () => {
        if (!dueDate) return;
        await addFollowup({
            lead_id: leadId,
            due_date: dueDate,
            due_time: dueTime || null,
            type: type as any,
            priority,
            assigned_staff_id: assignedTo || user?.id || null,
            notes,
            created_by: user?.id,
            created_by_name: user?.full_name,
        });
        setShowForm(false);
        setDueDate(''); setDueTime(''); setNotes('');
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">Follow-ups</h4>
                <Button size="sm" onClick={() => setShowForm((v) => !v)} className="h-8 text-xs">
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Follow-up
                </Button>
            </div>

            {showForm && (
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                        <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <Select value={type} onValueChange={setType}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="call">Call</SelectItem>
                                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                                <SelectItem value="email">Email</SelectItem>
                                <SelectItem value="meeting">Meeting</SelectItem>
                                <SelectItem value="visit">Visit</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={priority} onValueChange={(v) => setPriority(v as LeadPriority)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="low">Low</SelectItem>
                                <SelectItem value="medium">Medium</SelectItem>
                                <SelectItem value="high">High</SelectItem>
                                <SelectItem value="urgent">Urgent</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={assignedTo} onValueChange={setAssignedTo}>
                            <SelectTrigger><SelectValue placeholder="Assign to" /></SelectTrigger>
                            <SelectContent>
                                {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <Textarea placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
                        <Button size="sm" onClick={handleAdd}>Schedule</Button>
                    </div>
                </div>
            )}

            <div className="space-y-2">
                {leadFollowups.length === 0 && !showForm && (
                    <p className="text-sm text-slate-400 italic text-center py-6">No follow-ups scheduled yet.</p>
                )}
                {leadFollowups.map((f) => {
                    const Icon = TYPE_ICONS[f.type] || Calendar;
                    const overdue = f.status === 'pending' && isFollowupOverdue(f.due_date, f.due_time);
                    const assignee = staff.find((s) => s.id === f.assigned_staff_id);
                    return (
                        <div key={f.id} className={cn('flex items-start gap-3 p-3.5 rounded-2xl border', f.status === 'done' ? 'bg-slate-50 border-slate-100 opacity-60' : overdue ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200')}>
                            <div className={cn('h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0', overdue ? 'bg-red-100 text-red-600' : 'bg-indigo-50 text-indigo-600')}>
                                <Icon className="h-4 w-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-bold text-slate-800">{format(new Date(f.due_date), 'dd MMM yyyy')}{f.due_time ? `, ${f.due_time}` : ''}</span>
                                    {overdue && <span className="text-[9px] font-black uppercase text-red-600 bg-red-100 px-2 py-0.5 rounded-full">Overdue</span>}
                                    {f.status === 'done' && <span className="text-[9px] font-black uppercase text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">Done</span>}
                                    <span className={cn('text-[9px] font-black uppercase px-2 py-0.5 rounded-full border', PRIORITY_CONFIG[f.priority].className)}>{PRIORITY_CONFIG[f.priority].label}</span>
                                </div>
                                {f.notes && <p className="text-xs text-slate-500 mt-1">{f.notes}</p>}
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">{assignee?.full_name || 'Unassigned'}</p>
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                                {f.status === 'pending' && (
                                    <button onClick={() => updateFollowup(f.id, { status: 'done', completed_at: new Date().toISOString() })} className="h-7 w-7 flex items-center justify-center rounded-lg text-emerald-500 hover:bg-emerald-50" title="Mark done">
                                        <Check className="h-4 w-4" />
                                    </button>
                                )}
                                <button onClick={() => deleteFollowup(f.id)} className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50" title="Delete">
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
