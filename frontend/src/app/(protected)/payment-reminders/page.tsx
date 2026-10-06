'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ColumnDef } from '@tanstack/react-table';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarClock, FileText, IndianRupee, Send, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/shared/data-table';
import { DateRangeFilter } from '@/components/shared/date-range-filter';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { PERMISSIONS } from '@/lib/permissions';
import { api } from '@/lib/api-client';
import { usePaymentReminders, PaymentReminderRow } from '@/hooks/use-finance';
import { ReminderDialog } from '@/components/finance/reminder-dialog';
import { CancelBookingDialog } from '@/components/finance/cancel-booking-dialog';
import { RowMenu, rowMenuItem } from '@/components/shared/row-menu';
import { RecordPaymentDialog, PaymentResult, inr } from '@/components/finance/record-payment-dialog';

type Filter = 'all' | 'set' | 'today' | 'overdue' | 'none' | 'sent';
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const ymd = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const filterSelect = 'h-10 w-52 rounded-md border border-input bg-background px-3 text-sm text-foreground';

// Every invoice that still has money to collect, with its payment reminder. One reminder per
// customer: set it, reschedule it, send it now, or record the payment when it comes in. Whatever
// is done here is the same record the Invoices page shows.
export default function PaymentRemindersPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data, isLoading, isError } = usePaymentReminders();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [destination, setDestination] = useState('');
  const [dateOf, setDateOf] = useState<'reminder' | 'invoice' | 'payment'>('reminder');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [remindFor, setRemindFor] = useState<PaymentReminderRow | null>(null);
  const [payFor, setPayFor] = useState<PaymentReminderRow | null>(null);
  const [cancelFor, setCancelFor] = useState<PaymentReminderRow | null>(null);
  const [busy, setBusy] = useState('');
  const rows = data?.data ?? [];
  const now = Date.now();
  const today = dayKey(new Date());
  const balance = (r: PaymentReminderRow) => Math.max(Number(r.total_amount) - Number(r.paid_amount), 0);
  const tagOf = (r: PaymentReminderRow): Exclude<Filter, 'all' | 'set'> | 'upcoming' => {
    if (r.send_at) return new Date(r.send_at).getTime() < now ? 'overdue' : dayKey(new Date(r.send_at)) === today ? 'today' : 'upcoming';
    return r.last_status === 'sent' ? 'sent' : 'none';
  };
  const counts = useMemo(() => {
    const c = { all: rows.length, set: 0, today: 0, overdue: 0, none: 0, sent: 0, toCollect: 0 };
    for (const r of rows) { const t = tagOf(r); if (r.send_at) c.set++; if (t === 'today') c.today++; if (t === 'overdue') c.overdue++; if (t === 'none') c.none++; if (t === 'sent') c.sent++; c.toCollect += balance(r); }
    return c;
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const destinations = useMemo(() => Array.from(new Set(rows.map((r) => String(r.destination ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [rows]);
  const filtered = !!(search || destination || from || to || filter !== 'all');
  const shown = rows.filter((r) => {
    const t = tagOf(r);
    if (!(filter === 'all' || (filter === 'set' ? !!r.send_at : t === filter))) return false;
    if (destination && String(r.destination ?? '').trim() !== destination) return false;
    if (from || to) {
      const iso = dateOf === 'reminder' ? r.send_at : dateOf === 'invoice' ? r.invoice_date : r.last_paid_at;
      if (!iso) return false;
      const d = ymd(iso);
      if ((from && d < from) || (to && d > to)) return false;
    }
    return !search || `${r.customer_name ?? ''} ${r.customer_phone ?? ''} ${r.invoice_number} ${r.quotation_number ?? ''} ${r.destination ?? ''}`.toLowerCase().includes(search.toLowerCase());
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['finance'] }); qc.invalidateQueries({ queryKey: ['quotations'] }); };

  async function sendNow(r: PaymentReminderRow) {
    const ok = await confirm({ title: `Send the reminder to ${r.customer_name || 'the customer'} now?`, description: `A WhatsApp reminder for ${inr(balance(r))} on ${r.invoice_number} goes out straight away.`, confirmLabel: 'Send now' });
    if (!ok) return;
    setBusy(r.invoice_id);
    try { const res = await api.post<{ sentTo: string }>(`/finance/invoices/${r.invoice_id}/remind`, {}); toast(`Reminder sent on WhatsApp to ${res.sentTo}`, 'success'); refresh(); }
    catch (e: any) { toast(e.message || 'Could not send the reminder', 'error'); }
    finally { setBusy(''); }
  }
  async function cancel(r: PaymentReminderRow) {
    if (!r.reminder_id) return;
    try { await api.delete(`/finance/reminders/${r.reminder_id}`); toast('Reminder cancelled', 'success'); refresh(); }
    catch (e: any) { toast(e.message || 'Could not cancel', 'error'); }
  }

  const tiles: { key: Filter; label: string; value: string; cls: string }[] = [
    { key: 'all', label: 'Invoices to collect', value: String(counts.all), cls: 'text-white' },
    { key: 'set', label: 'Reminders set', value: String(counts.set), cls: 'text-amber-300' },
    { key: 'today', label: 'Going out today', value: String(counts.today), cls: 'text-sky-300' },
    { key: 'overdue', label: 'Time passed, not sent', value: String(counts.overdue), cls: 'text-rose-300' },
    { key: 'none', label: 'No reminder set', value: String(counts.none), cls: 'text-slate-300' },
    { key: 'sent', label: 'Reminded, still unpaid', value: String(counts.sent), cls: 'text-emerald-300' },
  ];
  const icon = 'grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white hover:border-gold disabled:opacity-40';

  const columns: ColumnDef<PaymentReminderRow>[] = [
    { id: 'sn', header: 'S.No', cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.index + 1}</span> },
    { id: 'customer', header: 'Customer', cell: ({ row }) => <div><p className="font-semibold text-navy">{row.original.customer_name || '—'}</p><p className="text-[11px] tabular-nums text-muted-foreground">{row.original.customer_phone || ''}</p></div> },
    { id: 'destination', header: 'Destination', cell: ({ row }) => row.original.destination || '—' },
    { id: 'invoice', header: 'Invoice', cell: ({ row }) => <div><p className="whitespace-nowrap font-semibold text-navy">{row.original.invoice_number}</p><p className="whitespace-nowrap text-[11px] text-muted-foreground">{new Date(row.original.invoice_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p></div> },
    { id: 'total', header: 'Total', cell: ({ row }) => <span className="tabular-nums">{inr(row.original.total_amount)}</span> },
    { id: 'received', header: 'Received', cell: ({ row }) => <div><span className="tabular-nums text-emerald-700">{inr(row.original.paid_amount)}</span>{row.original.last_paid_at && <p className="whitespace-nowrap text-[11px] text-muted-foreground">last {new Date(row.original.last_paid_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>}</div> },
    { id: 'balance', header: 'Balance', cell: ({ row }) => <span className="font-bold tabular-nums text-red-600">{inr(balance(row.original))}</span> },
    { id: 'reminder', header: 'Reminder', cell: ({ row }) => { const r = row.original; const t = tagOf(r); return r.send_at
      ? <div><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${t === 'overdue' ? 'bg-red-100 text-red-700' : t === 'today' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800'}`}>{t === 'overdue' ? 'Time passed' : t === 'today' ? 'Today' : 'Set'}</span><p className="mt-1 whitespace-nowrap text-xs font-semibold text-navy">{when(r.send_at)}</p></div>
      : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">Not set</span>; } },
    { id: 'last', header: 'Last reminder', cell: ({ row }) => { const r = row.original; return r.last_status
      ? <div className="text-xs"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${r.last_status === 'sent' ? 'bg-emerald-100 text-emerald-700' : r.last_status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{r.last_status}</span><p className="mt-1 whitespace-nowrap text-muted-foreground">{when(r.last_sent_at || r.last_send_at)}</p></div>
      : <span className="whitespace-nowrap text-xs text-muted-foreground">Never reminded</span>; } },
    { id: 'actions', header: () => <span className="block text-right">Actions</span>, cell: ({ row }) => { const r = row.original; return (
      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <PermissionGuard permission={PERMISSIONS.FINANCE_COLLECT_PAYMENT}>
          <button type="button" className={`${icon} text-amber-600`} title={r.send_at ? 'Reschedule the reminder' : 'Set a reminder (date and time)'} aria-label={r.send_at ? 'Reschedule reminder' : 'Set reminder'} onClick={() => setRemindFor(r)}><CalendarClock className="h-4 w-4" /></button>
          <button type="button" className={`${icon} text-emerald-600`} title="Send the reminder on WhatsApp now" aria-label="Send reminder now" disabled={busy === r.invoice_id} onClick={() => sendNow(r)}><Send className="h-4 w-4" /></button>
          <button type="button" className="grid h-8 w-8 place-items-center rounded-lg bg-gold text-navy hover:brightness-95" title="Record a payment (added to the invoice)" aria-label="Record payment" onClick={() => setPayFor(r)}><IndianRupee className="h-4 w-4" /></button>
        </PermissionGuard>
        <RowMenu>{(close) => (<>
          <button type="button" onClick={() => { close(); router.push(`/finance/invoices/${r.invoice_id}`); }} className={rowMenuItem}><FileText className="h-4 w-4" />Open invoice &amp; payments</button>
          {r.quotation_id && <button type="button" onClick={() => { close(); router.push(`/quotations/${r.quotation_id}/edit`); }} className={rowMenuItem}><FileText className="h-4 w-4" />Open quotation {r.quotation_number}</button>}
          <PermissionGuard permission={PERMISSIONS.FINANCE_COLLECT_PAYMENT}>
            {r.reminder_id && <button type="button" onClick={() => { close(); cancel(r); }} className={rowMenuItem}><X className="h-4 w-4" />Cancel the reminder</button>}
            <button type="button" onClick={() => { close(); setCancelFor(r); }} className={`${rowMenuItem} border-t text-red-600 hover:bg-red-50`}><Ban className="h-4 w-4" />Cancel booking / refund</button>
          </PermissionGuard>
        </>)}</RowMenu>
      </div>
    ); } },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-gradient-to-br from-navy to-slate-900 p-5 text-white shadow-xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs font-bold uppercase tracking-widest text-gold">Collections</p><h1 className="mt-1 text-2xl font-bold">Payment Reminders</h1></div>
          <p className="text-sm text-slate-300">Still to collect <b className="text-xl text-gold">{inr(counts.toCollect)}</b></p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {tiles.map((t) => <button key={t.key} type="button" onClick={() => setFilter(t.key)} className={`rounded-xl p-3 text-left transition ${filter === t.key ? 'bg-gold/25 ring-1 ring-gold' : 'bg-white/5 hover:bg-white/10'}`}><p className={`text-xl font-bold tabular-nums ${t.cls}`}>{t.value}</p><p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-400">{t.label}</p></button>)}
        </div>
        <p className="mt-3 border-t border-white/10 pt-3 text-xs text-slate-300">One reminder per customer. At the set date and time the CRM sends the WhatsApp reminder by itself and notifies you. A payment recorded here is added to the invoice, and the reminder shows on the Invoices page too.</p>
      </section>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <label className="min-w-[14rem] flex-1 space-y-1"><span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Search</span>
          <Input placeholder="Customer, mobile, invoice number, destination…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <label className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Show</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className={`${filterSelect} font-semibold`}>
            {tiles.map((t) => <option key={t.key} value={t.key}>{t.label} ({t.value})</option>)}
          </select></label>
        <label className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Destination</span>
          <select value={destination} onChange={(e) => setDestination(e.target.value)} className={filterSelect}><option value="">All destinations</option>{destinations.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
        <label className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Date of</span>
          <select value={dateOf} onChange={(e) => setDateOf(e.target.value as 'reminder' | 'invoice' | 'payment')} className={`${filterSelect} w-40`}><option value="reminder">Reminder</option><option value="invoice">Invoice</option><option value="payment">Last payment</option></select></label>
        <div className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Dates</span>
          <DateRangeFilter title={`Select ${dateOf === 'payment' ? 'last payment' : dateOf} date`} from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} /></div>
        {filtered && <Button variant="outline" onClick={() => { setSearch(''); setDestination(''); setFrom(''); setTo(''); setFilter('all'); }}>Clear</Button>}
      </div>
      {filtered && <p className="text-xs text-slate-500">{shown.length} of {rows.length} shown.</p>}
      {isError && <p className="text-sm text-red-500">Could not load the payment reminders.</p>}

      <DataTable columns={columns} data={shown} isLoading={isLoading} stickyLastColumn
        emptyMessage={rows.length ? 'Nothing matches these filters.' : 'Every invoice is fully paid — nothing to collect.'}
        onRowClick={(row) => router.push(`/finance/invoices/${row.invoice_id}`)} />

      {remindFor && <ReminderDialog invoiceId={remindFor.invoice_id} invoiceNumber={remindFor.invoice_number} customerName={remindFor.customer_name} total={Number(remindFor.total_amount)} paid={Number(remindFor.paid_amount)} onClose={() => { setRemindFor(null); refresh(); }} />}
      {cancelFor && <CancelBookingDialog invoiceId={cancelFor.invoice_id} invoiceNumber={cancelFor.invoice_number} customerName={cancelFor.customer_name} paid={Number(cancelFor.paid_amount)} onClose={() => { setCancelFor(null); refresh(); }} />}
      {payFor && (
        <RecordPaymentDialog title="Record payment" subtitle={`${payFor.invoice_number} · ${payFor.customer_name ?? 'Customer'}`} total={Number(payFor.total_amount)} paid={Number(payFor.paid_amount)} onClose={() => setPayFor(null)}
          onSubmit={async (dto) => { const res = await api.post<PaymentResult>(`/finance/invoices/${payFor.invoice_id}/payments`, dto); refresh(); return res; }} />
      )}
    </div>
  );
}
