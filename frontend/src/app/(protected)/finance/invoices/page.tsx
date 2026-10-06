'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ColumnDef } from '@tanstack/react-table';
import { useQueryClient } from '@tanstack/react-query';
import { BellRing, Download, FileText, IndianRupee, MessageCircle, Trash2 } from 'lucide-react';
import { RowMenu, rowMenuItem } from '@/components/shared/row-menu';
import { DateRangeFilter } from '@/components/shared/date-range-filter';
import { ReminderDialog } from '@/components/finance/reminder-dialog';
import { CancelBookingDialog } from '@/components/finance/cancel-booking-dialog';
import { TemplatePreview } from '@/components/finance/template-preview';
import { SendWhatsAppDialog } from '@/components/quotations/send-whatsapp-dialog';
import { DataTable } from '@/components/shared/data-table';
import { Button } from '@/components/ui/button';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { PERMISSIONS } from '@/lib/permissions';
import { api } from '@/lib/api-client';
import { useInvoices, usePayments, useDeleteInvoice, useFinanceTemplates, useSubmitFinanceTemplate, useSyncFinanceTemplate } from '@/hooks/use-finance';
import { Input } from '@/components/ui/input';
import { QUOTATION_ITEM_CATEGORIES } from '@/types/quotation';
import { Invoice, INVOICE_STATUS_LABELS } from '@/types/finance';
import { RecordPaymentDialog, PaymentResult, inr } from '@/components/finance/record-payment-dialog';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://errances.socialmm.in';
const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  partial: 'bg-blue-100 text-blue-700',
  paid: 'bg-emerald-600 text-white',
  overdue: 'bg-red-100 text-red-700',
  refunded: 'bg-indigo-100 text-indigo-700',
};
const dateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const localDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const filterSelect = 'h-10 w-40 rounded-md border border-input bg-background px-3 text-sm text-foreground';
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function RowActions({ inv, onRecord, onRemind, onSend, onCancel }: { inv: Invoice; onRecord: (i: Invoice) => void; onRemind: (i: Invoice) => void; onSend: (i: Invoice) => void; onCancel: (i: Invoice) => void }) {
  const router = useRouter();
  const confirm = useConfirm();
  const del = useDeleteInvoice();
  const balance = Number(inv.balance_due ?? 0);
  const link = inv.public_share_token ? `${APP_URL}/i/${inv.public_share_token}` : null;
  const icon = 'grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white hover:border-gold disabled:opacity-40';

  return (
    <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      <button type="button" className={`${icon} text-emerald-600`} title="Preview and send the invoice on WhatsApp" aria-label="Send on WhatsApp" disabled={!link || !inv.quotation_id} onClick={() => onSend(inv)}><MessageCircle className="h-4 w-4" /></button>
      <button type="button" className={`${icon} text-navy`} title="Download the invoice PDF" aria-label="Download PDF" disabled={!link} onClick={() => link && window.open(`${link}?print=1`, '_blank', 'noopener')}><Download className="h-4 w-4" /></button>
      <PermissionGuard permission={PERMISSIONS.FINANCE_COLLECT_PAYMENT}>
        <button type="button" className={`${icon} text-amber-600`} title={balance <= 0 ? 'Fully paid' : 'Payment reminder — send now or set a date and time'} aria-label="Payment reminder" disabled={balance <= 0} onClick={() => onRemind(inv)}><BellRing className="h-4 w-4" /></button>
        <button type="button" className="grid h-8 w-8 place-items-center rounded-lg bg-gold text-navy hover:brightness-95 disabled:opacity-40" disabled={balance <= 0} title={balance <= 0 ? 'Fully paid' : 'Record a payment'} aria-label="Record a payment" onClick={() => onRecord(inv)}><IndianRupee className="h-4 w-4" /></button>
      </PermissionGuard>
      <RowMenu>{(close) => (<>
        <button type="button" onClick={() => { close(); router.push(`/finance/invoices/${inv.id}`); }} className={rowMenuItem}><FileText className="h-4 w-4" />Open invoice &amp; payments</button>
        {inv.quotation_id && <button type="button" onClick={() => { close(); router.push(`/quotations/${inv.quotation_id}/edit`); }} className={rowMenuItem}><FileText className="h-4 w-4" />Open quotation {inv.quotation_number}</button>}
        <PermissionGuard permission={PERMISSIONS.FINANCE_COLLECT_PAYMENT}>
          {!inv.cancelled_at && <button type="button" onClick={() => { close(); onCancel(inv); }} className={`${rowMenuItem} border-t text-red-600 hover:bg-red-50`}><Trash2 className="h-4 w-4 opacity-0" />Cancel booking / refund</button>}
          <button type="button" onClick={async () => { close(); const ok = await confirm({ title: `Delete ${inv.invoice_number}?`, description: 'It moves to Settings → Trash and can be restored for 60 days.', confirmLabel: 'Delete', variant: 'destructive' }); if (ok) del.mutate(inv.id); }} className={`${rowMenuItem} border-t text-red-600 hover:bg-red-50`}><Trash2 className="h-4 w-4" />Delete</button>
        </PermissionGuard>
      </>)}</RowMenu>
    </div>
  );
}

const TEMPLATE_NAMES: Record<string, string> = { payment_receipt: 'Payment confirmation', payment_reminder: 'Payment reminder' };

export default function InvoicesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, isError, error } = useInvoices();
  const { data: templates } = useFinanceTemplates();
  const submitTpl = useSubmitFinanceTemplate();
  const syncTpl = useSyncFinanceTemplate();
  const [payFor, setPayFor] = useState<Invoice | null>(null);
  const [remindFor, setRemindFor] = useState<Invoice | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [cancelFor, setCancelFor] = useState<Invoice | null>(null);
  const [sendFor, setSendFor] = useState<Invoice | null>(null);
  const allRows = data?.data ?? [];
  // Two lists on this page: the invoices, and every payment received against them.
  const [view, setView] = useState<'invoices' | 'payments'>('invoices');
  const payments = usePayments();
  // ?search= arrives when a lead's stage change (Advance Paid / Booking Confirmed / Won) sends the employee here.
  const [search, setSearch] = useState(useSearchParams().get('search') ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [category, setCategory] = useState('');
  const [destination, setDestination] = useState('');
  const [status, setStatus] = useState('');
  const filtered = !!(search || from || to || category || destination || status);
  const clear = () => { setSearch(''); setFrom(''); setTo(''); setCategory(''); setDestination(''); setStatus(''); };
  const destinations = useMemo(() => Array.from(new Set(allRows.map((i: any) => String(i.destination ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [allRows]);
  const inDates = (iso?: string | null) => { if (!iso) return !from && !to; const d = localDay(iso); return (!from || d >= from) && (!to || d <= to); };
  const hit = (text: string) => !search || text.toLowerCase().includes(search.trim().toLowerCase());
  const rows = allRows.filter((i: any) => inDates(i.created_at) && (!status || i.status === status) && (!destination || String(i.destination ?? '').trim() === destination)
    && (!category || (i.categories ?? []).includes(category)) && hit(`${i.invoice_number} ${i.quotation_number ?? ''} ${i.customer_name ?? ''} ${i.customer_phone ?? ''} ${i.destination ?? ''} ${i.total_amount}`));
  const paymentRows = (payments.data?.data ?? []).filter((p: any) => inDates(p.paid_at || p.created_at) && (!destination || String(p.destination ?? '').trim() === destination)
    && hit(`${p.invoice_number ?? ''} ${p.customer_name ?? ''} ${p.method ?? ''} ${p.reference ?? ''} ${p.transaction_id ?? ''} ${p.amount} ${p.collected_by_name ?? ''}`));

  const totals = useMemo(() => {
    const invoiced = rows.reduce((n, i) => n + Number(i.total_amount || 0), 0);
    const paid = rows.reduce((n, i) => n + Number(i.paid_amount || 0), 0);
    return { invoiced, paid, outstanding: Math.max(invoiced - paid, 0), fullyPaid: rows.filter((i) => i.status === 'paid').length, open: rows.filter((i) => Number(i.balance_due ?? 0) > 0).length };
  }, [rows]);

  const columns: ColumnDef<Invoice>[] = [
    { id: 'sn', header: 'S.No', cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.index + 1}</span> },
    { id: 'created', header: 'Date & time', cell: ({ row }) => <span className="whitespace-nowrap text-xs">{dateTime(row.original.created_at)}</span> },
    { accessorKey: 'invoice_number', header: 'Invoice #', cell: ({ row }) => <div><p className="font-semibold text-navy">{row.original.invoice_number}</p><p className="text-[11px] text-muted-foreground">{row.original.quotation_number ? `from ${row.original.quotation_number}` : row.original.booking_number ?? ''}</p></div> },
    { id: 'customer', header: 'Customer', cell: ({ row }) => <div><p>{row.original.customer_name ?? '—'}</p>{(row.original as any).customer_phone && <p className="text-[11px] tabular-nums text-muted-foreground">{(row.original as any).customer_phone}</p>}</div> },
    { id: 'destination', header: 'Destination', cell: ({ row }) => (row.original as any).destination || '—' },
    { accessorKey: 'total_amount', header: 'Total', cell: ({ getValue }) => <span className="font-semibold tabular-nums">{inr(Number(getValue() ?? 0))}</span> },
    { id: 'reminder', header: 'Reminder', cell: ({ row }) => row.original.next_reminder_at ? <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800" title="A payment reminder is set for this date and time">{dateTime(row.original.next_reminder_at)}</span> : <span className="text-xs text-muted-foreground">—</span> },
    { id: 'margin', header: 'Our margin', cell: ({ row }) => { const m = Number((row.original as any).margin_amount ?? 0); return <span className={`tabular-nums ${m > 0 ? 'font-semibold text-emerald-700' : 'text-slate-500'}`} title="What we keep after our cost (before GST). Not shown to the customer.">{(row.original as any).margin_amount == null ? '—' : inr(m)}</span>; } },
    { id: 'paid', header: 'Paid', cell: ({ row }) => <span className="tabular-nums text-emerald-700">{inr(Number(row.original.paid_amount ?? 0))}</span> },
    { id: 'balance', header: 'Balance', cell: ({ row }) => { const b = Number(row.original.balance_due ?? 0); return <span className={`tabular-nums ${b > 0 ? 'font-semibold text-red-600' : 'text-emerald-600'}`}>{inr(b)}</span>; } },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue, row }) => { if ((row.original as any).cancelled_at) return <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-bold text-red-700">Cancelled{Number((row.original as any).refunded_amount) > 0 ? ` · ${inr(Number((row.original as any).refunded_amount))} refunded` : ''}</span>; const st = String(getValue() ?? 'pending'); return <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_BADGE[st] ?? 'bg-muted'}`}>{INVOICE_STATUS_LABELS[st] ?? st}</span>; } },
    { id: 'actions', header: () => <span className="block text-right">Actions</span>, cell: ({ row }) => <RowActions inv={row.original} onRecord={setPayFor} onRemind={setRemindFor} onSend={setSendFor} onCancel={setCancelFor} /> },
  ];

  const paymentColumns: ColumnDef<any>[] = [
    { id: 'sn', header: 'S.No', cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.index + 1}</span> },
    { id: 'when', header: 'Date & time', cell: ({ row }) => <span className="whitespace-nowrap text-xs">{dateTime(row.original.paid_at || row.original.created_at)}</span> },
    { id: 'invoice', header: 'Invoice #', cell: ({ row }) => <span className="font-semibold text-navy">{row.original.invoice_number ?? row.original.booking_number ?? '—'}</span> },
    { id: 'customer', header: 'Customer', cell: ({ row }) => row.original.customer_name ?? '—' },
    { id: 'destination', header: 'Destination', cell: ({ row }) => row.original.destination || '—' },
    { id: 'amount', header: 'Amount', cell: ({ row }) => <span className="font-semibold tabular-nums text-emerald-700">{inr(Number(row.original.amount ?? 0))}</span> },
    { id: 'method', header: 'Method', cell: ({ row }) => <span className="capitalize">{String(row.original.method ?? '—').replace(/_/g, ' ')}</span> },
    { id: 'ref', header: 'Reference', cell: ({ row }) => <span className="text-xs">{row.original.reference || row.original.transaction_id || '—'}</span> },
    { id: 'by', header: 'Recorded by', cell: ({ row }) => <span className="text-xs">{row.original.collected_by_name ?? '—'}</span> },
    { id: 'status', header: 'Status', cell: ({ row }) => <span className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${row.original.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{row.original.status === 'completed' ? 'Received' : String(row.original.status).replace(/_/g, ' ')}</span> },
  ];

  const tiles = [
    { label: 'Invoices', value: String(rows.length), cls: 'text-white' },
    { label: 'Total invoiced', value: inr(totals.invoiced), cls: 'text-white' },
    { label: 'Paid', value: inr(totals.paid), cls: 'text-emerald-300' },
    { label: 'Outstanding', value: inr(totals.outstanding), cls: totals.outstanding ? 'text-rose-300' : 'text-slate-300' },
    { label: 'Fully paid', value: String(totals.fullyPaid), cls: 'text-sky-300' },
    { label: 'With balance', value: String(totals.open), cls: 'text-amber-300' },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-gradient-to-br from-navy to-slate-900 p-5 text-white shadow-xl">
        <p className="text-xs font-bold uppercase tracking-widest text-gold">Payments</p>
        <h1 className="mt-1 text-2xl font-bold">Invoices</h1>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {tiles.map((t) => <div key={t.label} className="rounded-xl bg-white/5 p-3"><p className={`truncate text-lg font-bold tabular-nums ${t.cls}`}>{t.value}</p><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t.label}</p></div>)}
        </div>
        <p className="mt-3 border-t border-white/10 pt-3 text-xs text-slate-300">
          Paid <b className="text-emerald-300">{inr(totals.paid)}</b> + Outstanding <b className="text-rose-300">{inr(totals.outstanding)}</b> = Total invoiced <b className="text-white">{inr(totals.invoiced)}</b>
        </p>
        {/* WhatsApp messages for payments need Meta-approved templates to reach customers who
            haven't messaged in the last 24 hours. */}
        <PermissionGuard permission={PERMISSIONS.FINANCE_COLLECT_PAYMENT}>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-300">
            {(['payment_receipt', 'payment_reminder'] as const).map((kind) => { const t = templates?.[kind]; return (
              <span key={kind} className="flex items-center gap-2">
                <b className="text-white">{TEMPLATE_NAMES[kind]} template:</b>
                {t?.templateStatus === 'APPROVED' ? <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 font-bold text-emerald-300">Approved</span>
                  : t?.templateStatus === 'PENDING' ? <><span className="rounded-full bg-amber-400/20 px-2 py-0.5 font-bold text-amber-300">With Meta for review</span><button type="button" className="font-semibold text-gold underline" onClick={() => syncTpl.mutate(kind)}>check</button></>
                  : <><span>{t?.templateStatus === 'REJECTED' ? 'rejected' : 'not submitted'} (24-hour window only)</span><Button size="sm" variant="gold" disabled={submitTpl.isPending} onClick={() => submitTpl.mutate(kind, { onSuccess: () => toast('Submitted to Meta for approval', 'success'), onError: (e: any) => toast(e.message || 'Could not submit', 'error') })}>Submit</Button></>}
              </span>
            ); })}
            <button type="button" className="font-semibold text-gold underline" onClick={() => setShowTemplates((v) => !v)}>{showTemplates ? 'Hide template previews' : 'Preview the templates'}</button>
          </div>
          {showTemplates && <div className="mt-3 grid gap-3 md:grid-cols-2">{(['payment_receipt', 'payment_reminder'] as const).map((kind) => <TemplatePreview key={kind} title={`${TEMPLATE_NAMES[kind]} template`} preview={(templates?.[kind] as any)?.preview} button={(templates?.[kind] as any)?.button} status={templates?.[kind]?.templateStatus} />)}</div>}
        </PermissionGuard>
      </section>

      <div className="flex gap-1 border-b border-border">
        {([['invoices', `Invoices (${rows.length})`], ['payments', `Payments received (${paymentRows.length})`]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setView(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${view === k ? 'border-gold text-navy dark:text-white' : 'border-transparent text-muted-foreground hover:text-navy'}`}>{label}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <label className="min-w-[13rem] flex-1 space-y-1"><span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Search</span>
          <Input placeholder={view === 'invoices' ? 'Invoice number, customer, mobile, destination, amount…' : 'Invoice number, customer, method, reference, amount…'} value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <DateRangeFilter title="Select invoice date" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        {view === 'invoices' && <label className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Category</span>
          <select className={filterSelect} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{QUOTATION_ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</select></label>}
        <label className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Destination</span>
          <select className={filterSelect} value={destination} onChange={(e) => setDestination(e.target.value)}><option value="">All destinations</option>{destinations.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
        {view === 'invoices' && <label className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Status</span>
          <select className={filterSelect} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="pending">Unpaid</option><option value="partial">Part paid</option><option value="paid">Paid</option></select></label>}
        {filtered && <Button variant="outline" onClick={clear}>Clear</Button>}
      </div>

      {isError && <p className="text-sm text-red-500">Failed to load invoices: {(error as Error)?.message ?? 'unknown error'}</p>}

      {view === 'invoices' ? (
        <DataTable columns={columns} data={rows} isLoading={isLoading} stickyLastColumn
          emptyMessage={filtered ? 'No invoices match these filters.' : 'No invoices yet. One is created when a customer approves a quotation, or when you record a payment on a quotation.'}
          onRowClick={(row) => router.push(`/finance/invoices/${row.id}`)} />
      ) : (
        <DataTable columns={paymentColumns} data={paymentRows} isLoading={payments.isLoading}
          emptyMessage={filtered ? 'No payments match these filters.' : 'No payments recorded yet.'}
          onRowClick={(row) => row.invoice_id && router.push(`/finance/invoices/${row.invoice_id}`)} />
      )}

      {cancelFor && <CancelBookingDialog invoiceId={cancelFor.id} invoiceNumber={cancelFor.invoice_number} customerName={cancelFor.customer_name} paid={Number(cancelFor.paid_amount || 0)} refunded={Number(cancelFor.refunded_amount || 0)} onClose={() => setCancelFor(null)} />}
      {remindFor && <ReminderDialog invoiceId={remindFor.id} invoiceNumber={remindFor.invoice_number} customerName={remindFor.customer_name} total={Number(remindFor.total_amount || 0)} paid={Number(remindFor.paid_amount || 0)} onClose={() => setRemindFor(null)} />}
      {sendFor && sendFor.quotation_id && (
        <SendWhatsAppDialog title="Send invoice on WhatsApp" what="Invoice"
          quotationId={sendFor.quotation_id} phone={String((sendFor as any).customer_phone || '')} customerName={sendFor.customer_name}
          defaultText={`Dear ${sendFor.customer_name || 'Customer'},\n\nYour invoice *${sendFor.invoice_number}* from Errances Voyages.\n\n${(sendFor as any).destination ? `*Destination:* ${(sendFor as any).destination}\n` : ''}*Invoice total:* ${inr(Number(sendFor.total_amount || 0))}\n*Received:* ${inr(Number(sendFor.paid_amount || 0))}\n*Balance:* ${inr(Number(sendFor.balance_due || 0))}\n\nView and download your invoice here:\n${APP_URL}/i/${sendFor.public_share_token}\n\nErrances Voyages`}
          onClose={() => setSendFor(null)} />
      )}

      {payFor && (
        <RecordPaymentDialog
          title="Record payment"
          subtitle={`${payFor.invoice_number} · ${payFor.customer_name ?? 'Customer'}`}
          total={Number(payFor.total_amount || 0)} paid={Number(payFor.paid_amount || 0)}
          onClose={() => setPayFor(null)}
          onSubmit={async (dto) => {
            const r = await api.post<PaymentResult>(`/finance/invoices/${payFor.id}/payments`, dto);
            qc.invalidateQueries({ queryKey: ['finance'] }); qc.invalidateQueries({ queryKey: ['quotations'] });
            return r;
          }}
        />
      )}
    </div>
  );
}
