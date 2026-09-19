import { useEffect, useState } from 'react';
import { useAppStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, IndianRupee } from 'lucide-react';
import { format } from 'date-fns';
import type { LeadPayment } from '@/types';

export function PaymentsPanel({ leadId }: { leadId: string }) {
    const { fetchLeadPayments, addLeadPayment, deleteLeadPayment, user } = useAppStore();
    const [payments, setPayments] = useState<LeadPayment[]>([]);
    const [showForm, setShowForm] = useState(false);
    const [amount, setAmount] = useState('');
    const [method, setMethod] = useState('');
    const [note, setNote] = useState('');

    const load = async () => setPayments(await fetchLeadPayments(leadId));
    useEffect(() => { load(); }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps

    const total = payments.reduce((sum, p) => sum + Number(p.amount), 0);

    const handleAdd = async () => {
        const amt = Number(amount);
        if (!amt || amt <= 0) return;
        await addLeadPayment({ lead_id: leadId, amount: amt, method, note, recorded_by: user?.id, recorded_by_name: user?.full_name });
        setAmount(''); setMethod(''); setNote(''); setShowForm(false);
        load();
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <div>
                    <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">Payments</h4>
                    <p className="text-lg font-black text-emerald-600 mt-0.5">€{total.toLocaleString()} <span className="text-[10px] text-slate-400 font-bold uppercase">received</span></p>
                </div>
                <Button size="sm" onClick={() => setShowForm((v) => !v)} className="h-8 text-xs"><Plus className="h-3.5 w-3.5 mr-1" /> Record Payment</Button>
            </div>

            {showForm && (
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <Input type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
                        <Input placeholder="Method (cash, UPI, card...)" value={method} onChange={(e) => setMethod(e.target.value)} />
                    </div>
                    <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
                        <Button size="sm" onClick={handleAdd}>Save</Button>
                    </div>
                </div>
            )}

            <div className="space-y-2">
                {payments.length === 0 && !showForm && <p className="text-sm text-slate-400 italic text-center py-6">No payments recorded yet.</p>}
                {payments.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 p-3 rounded-2xl border border-slate-200 bg-white">
                        <div className="h-9 w-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0"><IndianRupee className="h-4 w-4" /></div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-black text-slate-800">€{Number(p.amount).toLocaleString()} {p.method && <span className="text-xs font-semibold text-slate-400">via {p.method}</span>}</p>
                            {p.note && <p className="text-xs text-slate-500">{p.note}</p>}
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">{p.recorded_by_name || 'Unknown'} · {format(new Date(p.created_at), 'dd MMM yyyy, h:mm a')}</p>
                        </div>
                        <button onClick={async () => { await deleteLeadPayment(p.id); load(); }} className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 flex-shrink-0"><Trash2 className="h-4 w-4" /></button>
                    </div>
                ))}
            </div>
        </div>
    );
}
