'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CalendarClock, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';

interface Reminder { id: string; send_at: string; status: string; error: string | null; sent_at: string | null; created_by_name: string | null }
const inr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n) || 0);
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const STATUS: Record<string, string> = { scheduled: 'bg-amber-100 text-amber-800', sent: 'bg-emerald-100 text-emerald-700', failed: 'bg-red-100 text-red-700', skipped: 'bg-slate-100 text-slate-600', cancelled: 'bg-slate-100 text-slate-500', sending: 'bg-sky-100 text-sky-700' };
// yyyy-mm-ddThh:mm in local time, for the date-and-time box
const localInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// The payment reminder pop-up: send it on WhatsApp right now, or set a date and time and the
// CRM sends it by itself then. Reminders already set are listed underneath and can be cancelled.
export function ReminderDialog({ invoiceId, invoiceNumber, customerName, total, paid, onClose }: { invoiceId: string; invoiceNumber: string; customerName?: string | null; total: number; paid: number; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const balance = Math.max(total - paid, 0);
  const tomorrow10 = (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d; })();
  const [sendAt, setSendAt] = useState(localInput(tomorrow10));
  const [busy, setBusy] = useState('');
  const list = useQuery({ queryKey: ['finance', 'reminders', invoiceId], queryFn: () => api.get<{ data: Reminder[] }>(`/finance/invoices/${invoiceId}/reminders`) });

  async function sendNow() {
    setBusy('now');
    try { const r = await api.post<{ sentTo: string }>(`/finance/invoices/${invoiceId}/remind`, {}); toast(`Reminder sent on WhatsApp to ${r.sentTo}`, 'success'); onClose(); }
    catch (e: any) { toast(e.message || 'Could not send the reminder', 'error'); }
    finally { setBusy(''); }
  }
  async function schedule() {
    if (!sendAt) { toast('Choose a date and time', 'error'); return; }
    setBusy('later');
    try { const r = await api.post<{ rescheduled?: boolean }>(`/finance/invoices/${invoiceId}/reminders`, { sendAt: new Date(sendAt).toISOString() }); toast(`Reminder ${r.rescheduled ? 'moved to' : 'set for'} ${when(new Date(sendAt).toISOString())}`, 'success'); qc.invalidateQueries({ queryKey: ['finance'] }); }
    catch (e: any) { toast(e.message || 'Could not set the reminder', 'error'); }
    finally { setBusy(''); }
  }
  async function cancel(id: string) {
    try { await api.delete(`/finance/reminders/${id}`); qc.invalidateQueries({ queryKey: ['finance'] }); }
    catch (e: any) { toast(e.message || 'Could not cancel', 'error'); }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3"><span className="rounded-xl bg-amber-100 p-2.5 text-amber-600"><BellRing className="h-5 w-5" /></span>
            <div><h3 className="text-base font-bold text-navy">Payment reminder</h3><p className="text-xs text-slate-500">{invoiceNumber} · {customerName || 'Customer'}</p></div></div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Total</p><p className="font-bold tabular-nums text-navy">{inr(total)}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Received</p><p className="font-bold tabular-nums text-emerald-700">{inr(paid)}</p></div>
          <div className="rounded-xl bg-navy p-3"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-300">Balance</p><p className="font-bold tabular-nums text-gold">{inr(balance)}</p></div>
        </div>
        <p className="mt-3 rounded-xl bg-[#efe7dd] p-3 text-xs leading-relaxed text-slate-800">The customer gets: <i>“Dear {customerName || 'Customer'}, this is a payment reminder from Errances Voyages for invoice {invoiceNumber}. Received so far: {inr(paid)}. Balance pending: {inr(balance)}. Kindly make the remaining payment.”</i> with the link to the invoice.</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-navy"><Send className="h-4 w-4 text-emerald-600" />Send now</p>
            <p className="mt-1 text-xs text-slate-500">Goes on WhatsApp straight away.</p>
            <Button type="button" className="mt-3 w-full bg-emerald-600 text-white hover:bg-emerald-700" disabled={balance <= 0 || !!busy} onClick={sendNow}>{busy === 'now' ? 'Sending…' : 'Send on WhatsApp now'}</Button>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-navy"><CalendarClock className="h-4 w-4 text-amber-600" />Send later, automatically</p>
            <p className="mt-1 text-xs text-slate-500">One reminder per customer: a new date replaces the one already set.</p>
            <input type="datetime-local" value={sendAt} min={localInput(new Date())} onChange={(e) => setSendAt(e.target.value)} className="mt-2 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-gold" />
            <Button type="button" variant="gold" className="mt-2 w-full" disabled={balance <= 0 || !!busy} onClick={schedule}>{busy === 'later' ? 'Saving…' : list.data?.data.some((r) => r.status === 'scheduled') ? 'Reschedule reminder' : 'Set reminder'}</Button>
          </div>
        </div>
        {balance <= 0 && <p className="mt-3 text-xs font-semibold text-emerald-700">This invoice is fully paid — no reminder is needed.</p>}

        <div className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Reminders for this invoice</p>
          {!list.data?.data.length ? <p className="mt-1 text-xs text-slate-500">{list.isLoading ? 'Loading…' : 'None set yet.'}</p> : (
            <ul className="mt-1 divide-y divide-slate-100 rounded-xl border border-slate-200">
              {list.data.data.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div><p className="font-semibold text-navy">{when(r.send_at)}</p>{r.error && <p className="text-[11px] text-red-600">{r.error}</p>}{r.created_by_name && <p className="text-[11px] text-slate-500">set by {r.created_by_name}</p>}</div>
                  <div className="flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${STATUS[r.status] ?? 'bg-slate-100'}`}>{r.status}</span>{r.status === 'scheduled' && <button type="button" onClick={() => cancel(r.id)} className="text-xs font-semibold text-red-600 hover:underline">Cancel</button>}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
