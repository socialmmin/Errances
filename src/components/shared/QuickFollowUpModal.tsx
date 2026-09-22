import { useMemo, useState } from 'react';
import { useAppStore } from '@/store';
import { useAuth } from '@/components/AuthProvider';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search } from 'lucide-react';
import type { LeadPriority } from '@/types';

export function QuickFollowUpModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
    const { leads, addFollowup } = useAppStore();
    const { user } = useAuth();

    const [search, setSearch] = useState('');
    const [leadId, setLeadId] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [dueTime, setDueTime] = useState('');
    const [type, setType] = useState('call');
    const [priority, setPriority] = useState<LeadPriority>('medium');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);

    const matches = useMemo(() => {
        if (!search.trim()) return [];
        const q = search.trim().toLowerCase();
        return leads.filter((l) => l.name?.toLowerCase().includes(q) || l.phone?.includes(q)).slice(0, 6);
    }, [search, leads]);

    const selectedLead = leads.find((l) => l.id === leadId);

    const reset = () => {
        setSearch(''); setLeadId(''); setDueDate(''); setDueTime(''); setType('call'); setPriority('medium'); setNotes('');
    };

    const handleSave = async () => {
        if (!leadId || !dueDate) return;
        setSaving(true);
        try {
            await addFollowup({
                lead_id: leadId,
                due_date: dueDate,
                due_time: dueTime || null,
                type: type as any,
                priority,
                notes,
                assigned_staff_id: user?.id,
                created_by: user?.id,
                created_by_name: user?.full_name,
            });
            reset();
            onOpenChange(false);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>New Follow-up</DialogTitle>
                    <DialogDescription>Schedule a follow-up for any lead, from anywhere in the CRM.</DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {!selectedLead ? (
                        <div>
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 pl-1">Find Lead</label>
                            <div className="relative mt-1.5">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <Input placeholder="Search by name or mobile…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
                            </div>
                            {matches.length > 0 && (
                                <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                                    {matches.map((l) => (
                                        <button key={l.id} type="button" onClick={() => setLeadId(l.id)} className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm">
                                            <span className="font-bold text-slate-800">{l.name}</span>
                                            {l.phone && <span className="text-slate-400 ml-2 text-xs">{l.phone}</span>}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center justify-between p-3 bg-indigo-50 border border-indigo-100 rounded-xl">
                            <div>
                                <p className="text-sm font-bold text-slate-800">{selectedLead.name}</p>
                                {selectedLead.phone && <p className="text-xs text-slate-500">{selectedLead.phone}</p>}
                            </div>
                            <button type="button" className="text-xs font-bold text-indigo-600" onClick={() => setLeadId('')}>Change</button>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                        <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
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
                    </div>
                    <Textarea placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button disabled={!leadId || !dueDate || saving} onClick={handleSave}>{saving ? 'Saving…' : 'Schedule Follow-up'}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
