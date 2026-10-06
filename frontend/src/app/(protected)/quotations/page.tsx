'use client';

import { useMemo, useState } from 'react';
import { RowMenu, rowMenuItem } from '@/components/shared/row-menu';
import { DateRangeFilter } from '@/components/shared/date-range-filter';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ColumnDef } from '@tanstack/react-table';
import { useQueryClient } from '@tanstack/react-query';
import { BellRing, Download, ExternalLink, FileText, IndianRupee, MessageCircle, Pencil, Trash2 } from 'lucide-react';
import { ReminderDialog } from '@/components/finance/reminder-dialog';
import { DataTable } from '@/components/shared/data-table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { PERMISSIONS } from '@/lib/permissions';
import { api } from '@/lib/api-client';
import { useQuotations, useQuotationStats, useQuotationTemplate, useSubmitQuotationTemplate, useSyncQuotationTemplate, useDeleteQuotation } from '@/hooks/use-quotations';
import { Quotation, QUOTATION_STATUS_LABELS, QUOTATION_ITEM_CATEGORIES } from '@/types/quotation';
import { SendWhatsAppDialog, quotationMessage } from '@/components/quotations/send-whatsapp-dialog';
import { RecordPaymentDialog, PaymentResult, inr } from '@/components/finance/record-payment-dialog';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://errances.socialmm.in';
const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-orange-100 text-orange-700',
  converted: 'bg-indigo-100 text-indigo-700',
};
const filterSelect = 'h-10 w-44 rounded-md border border-input bg-background px-3 text-sm text-foreground';
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// Row quick actions: Download, WhatsApp, Record payment; everything else under the ⋮ menu.
function RowActions({ q, onRecord, onSend, onRemind }: { q: Quotation; onRecord: (q: Quotation) => void; onSend: (q: Quotation) => void; onRemind: (q: Quotation) => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const del = useDeleteQuotation();
  const publicLink = q.public_share_token ? `${APP_URL}/q/${q.public_share_token}` : null;
  const icon = 'grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white hover:border-gold disabled:opacity-40';

  async function remove() {
    const ok = await confirm({ title: `Delete ${q.quotation_number}?`, description: `${Number(q.paid_amount) > 0 ? 'This quotation has payments recorded against it. ' : ''}It moves to Settings → Trash and can be restored for 60 days.`, confirmLabel: 'Delete', variant: 'destructive' });
    if (!ok) return;
    try { await del.mutateAsync(q.id); toast('Quotation deleted', 'success'); } catch (e: any) { toast(e.message || 'Could not delete', 'error'); }
  }

  return (
    <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      <button type="button" className={`${icon} text-navy`} title="Download PDF" aria-label="Download PDF" disabled={!publicLink} onClick={() => publicLink && window.open(`${publicLink}?print=1`, '_blank', 'noopener')}><Download className="h-4 w-4" /></button>
      <PermissionGuard permission={PERMISSIONS.QUOTATIONS_EDIT}>
        <button type="button" className={`${icon} text-emerald-600`} title="Preview and send on WhatsApp" aria-label="Send on WhatsApp" onClick={() => onSend(q)}><MessageCircle className="h-4 w-4" /></button>
      </PermissionGuard>
      <PermissionGuard permission={PERMISSIONS.FINANCE_COLLECT_PAYMENT}>
        <button type="button" className="inline-flex h-8 items-center gap-1 rounded-lg bg-gold px-2.5 text-xs font-bold text-navy hover:brightness-95" title="Record a payment (creates the invoice if there isn't one yet)" onClick={() => onRecord(q)}><IndianRupee className="h-3.5 w-3.5" />Record</button>
      </PermissionGuard>
      <RowMenu>{(close) => (<>
        <button type="button" onClick={() => { close(); router.push(`/quotations/${q.id}/edit`); }} className={rowMenuItem}><Pencil className="h-4 w-4" />{q.invoice_id || q.status === 'accepted' ? 'Open / add services' : 'Edit'}</button>
        {publicLink && <a href={publicLink} target="_blank" rel="noreferrer" onClick={close} className={rowMenuItem}><ExternalLink className="h-4 w-4" />Customer's view</a>}
        {q.invoice_id && <button type="button" onClick={() => { close(); router.push(`/finance/invoices/${q.invoice_id}`); }} className={rowMenuItem}><FileText className="h-4 w-4" />Open invoice {q.invoice_number}</button>}
        {q.invoice_id && Number(q.final_amount) > Number(q.paid_amount || 0) && <button type="button" onClick={() => { close(); onRemind(q); }} className={rowMenuItem}><BellRing className="h-4 w-4" />Payment reminder</button>}
        <PermissionGuard permission={PERMISSIONS.QUOTATIONS_DELETE}>
          <button type="button" onClick={() => { close(); remove(); }} className={`${rowMenuItem} border-t text-red-600 hover:bg-red-50`}><Trash2 className="h-4 w-4" />Delete</button>
        </PermissionGuard>
      </>)}</RowMenu>
    </div>
  );
}

export default function QuotationsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [category, setCategory] = useState('');
  const [destination, setDestination] = useState('');
  const [scope, setScope] = useState<'all' | 'open' | 'approved'>('all');
  const filtered = !!(search || from || to || category || destination || scope !== 'all');
  const { data, isLoading, isError, error } = useQuotations({ search: search || undefined, from: from || undefined, to: to || undefined, category: category || undefined, destination: destination || undefined });
  // every destination that has a quotation, for the filter (not narrowed by the other filters)
  const { data: all } = useQuotations();
  const destinations = useMemo(() => Array.from(new Set((all?.data ?? []).map((q) => (q.destination ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [all]);
  const [sendFor, setSendFor] = useState<Quotation | null>(null);
  function openSend(q: Quotation) {
    if (!(q.customer_phone || q.lead_phone)) { toast('This quotation has no customer mobile number yet — open it and add one', 'error'); return; }
    setSendFor(q);
  }
  const { data: stats } = useQuotationStats();
  const { data: template } = useQuotationTemplate();
  const submitTemplate = useSubmitQuotationTemplate();
  const syncTemplate = useSyncQuotationTemplate();
  const [payFor, setPayFor] = useState<Quotation | null>(null);
  const [remindFor, setRemindFor] = useState<Quotation | null>(null);

  // An approved quotation has become an invoice, so it leaves the working list; it stays one click
  // away under "Approved" for reference.
  const rows = data?.data ?? [];
  const isApprovedRow = (q: Quotation) => !!q.invoice_id || q.status === 'accepted' || q.status === 'converted';
  const shownRows = scope === 'all' ? rows : rows.filter((q) => (scope === 'approved') === isApprovedRow(q));
  const approvedCount = rows.filter(isApprovedRow).length;
  const totals = useMemo(() => {
    const approved = rows.filter((q) => q.invoice_id || q.status === 'accepted' || q.status === 'converted');
    const approvedValue = approved.reduce((n, q) => n + Number(q.final_amount || 0), 0);
    const collected = rows.reduce((n, q) => n + Number(q.paid_amount || 0), 0);
    return { approved: approved.length, approvedValue, collected, outstanding: Math.max(approvedValue - collected, 0) };
  }, [rows]);

  const columns: ColumnDef<Quotation>[] = [
    { id: 'sn', header: 'S.No', cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.index + 1}</span> },
    { accessorKey: 'quotation_number', header: 'Quote #', cell: ({ row }) => <div><p className="font-semibold text-navy">{row.original.quotation_number}</p>{row.original.invoice_number && <p className="text-[11px] text-emerald-700">Invoice {row.original.invoice_number}</p>}</div> },
    { id: 'requirement', header: 'Requirement', cell: ({ row }) => <span className="whitespace-nowrap rounded-full bg-navy px-2.5 py-1 text-xs font-bold text-white" title={`Requirement ${row.original.requirement_no ?? 1}, quotation ${row.original.option_no ?? 1}`}>R{row.original.requirement_no ?? 1} · Q{row.original.option_no ?? 1}</span> },
    { id: 'customer', header: 'Customer', cell: ({ row }) => <div><p>{row.original.customer_name ?? row.original.lead_customer_name ?? '—'}</p>{(row.original.customer_phone || row.original.lead_phone) && <p className="text-[11px] tabular-nums text-muted-foreground">{row.original.customer_phone || row.original.lead_phone}</p>}</div> },
    { accessorKey: 'destination', header: 'Destination', cell: ({ row }) => row.original.destination ? <span className="font-medium text-navy">{row.original.destination}</span> : <span className="text-xs text-red-500">Not filled</span> },
    { id: 'travelDates', header: 'Travel dates', cell: ({ row }) => row.original.travel_from ? <span className="whitespace-nowrap text-xs">{day(row.original.travel_from)}{row.original.travel_to ? ` → ${day(row.original.travel_to)}` : ''}</span> : '—' },
    { accessorKey: 'final_amount', header: 'Total', cell: ({ getValue }) => <span className="font-semibold tabular-nums">{inr(Number(getValue() ?? 0))}</span> },
    { id: 'margin', header: 'Our margin', cell: ({ row }) => { const m = Number(row.original.base_amount || 0) - Number(row.original.discount_amount || 0) - Number(row.original.cost_amount || 0); return <span className={`tabular-nums ${m > 0 ? 'font-semibold text-emerald-700' : 'text-slate-500'}`} title="What we keep after our cost (before GST). Not shown to the customer.">{inr(m)}</span>; } },
    { id: 'paid', header: 'Paid', cell: ({ row }) => <span className="tabular-nums text-emerald-700">{inr(Number(row.original.paid_amount ?? 0))}</span> },
    { id: 'balance', header: 'Balance', cell: ({ row }) => { const b = Math.max(Number(row.original.final_amount || 0) - Number(row.original.paid_amount || 0), 0); return <span className={`tabular-nums ${b > 0 ? 'font-semibold text-red-600' : 'text-emerald-600'}`}>{inr(b)}</span>; } },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => { const st = String(row.original.status ?? 'draft'); const fullyPaid = Number(row.original.final_amount) > 0 && Number(row.original.paid_amount) >= Number(row.original.final_amount); return <span className={`rounded-full px-2 py-1 text-xs font-medium ${fullyPaid ? 'bg-emerald-600 text-white' : STATUS_BADGE[st] ?? 'bg-muted'}`}>{fullyPaid ? 'Paid' : QUOTATION_STATUS_LABELS[st] ?? st}</span>; } },
    { accessorKey: 'created_at', header: 'Created', cell: ({ getValue }) => <span className="whitespace-nowrap text-xs">{day(String(getValue()))}</span> },
    { id: 'actions', header: () => <span className="block text-right">Actions</span>, cell: ({ row }) => <RowActions q={row.original} onRecord={setPayFor} onSend={openSend} onRemind={setRemindFor} /> },
  ];

  const tiles = [
    { label: 'Quotations', value: String(stats?.total_count ?? rows.length), cls: 'text-white' },
    { label: 'Total value', value: inr(Number(stats?.total_value ?? 0)), cls: 'text-white' },
    { label: 'Drafts', value: String(stats?.draft_count ?? 0), cls: 'text-slate-300' },
    { label: 'Approved', value: `${totals.approved} · ${inr(totals.approvedValue)}`, cls: 'text-sky-300' },
    { label: 'Collected', value: inr(totals.collected), cls: 'text-emerald-300' },
    { label: 'Outstanding', value: inr(totals.outstanding), cls: totals.outstanding ? 'text-rose-300' : 'text-slate-300' },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-gradient-to-br from-navy to-slate-900 p-5 text-white shadow-xl">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-gold">Sales</p>
          <h1 className="mt-1 text-2xl font-bold">Quotations</h1>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {tiles.map((t) => <div key={t.label} className="rounded-xl bg-white/5 p-3"><p className={`truncate text-lg font-bold tabular-nums ${t.cls}`}>{t.value}</p><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t.label}</p></div>)}
        </div>
        {/* "Send on WhatsApp" uses this one shared template once Meta approves it; until then it
            falls back to a plain message, which only reaches customers inside the 24-hour window. */}
        <PermissionGuard permission={PERMISSIONS.QUOTATIONS_CREATE}>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 text-xs text-slate-300">
            <span><b className="text-white">WhatsApp quotation template:</b>{' '}
              {!template?.templateId && 'not submitted yet — sends go as a plain message (24-hour window only).'}
              {template?.templateId && template.templateStatus === 'APPROVED' && 'approved — quotations reach customers any time.'}
              {template?.templateId && template.templateStatus === 'PENDING' && 'with Meta for review.'}
              {template?.templateId && template.templateStatus === 'REJECTED' && `rejected by Meta${template.templateRejectionReason ? `: ${template.templateRejectionReason}` : ''}.`}
            </span>
            {!template?.templateId && <Button variant="gold" size="sm" disabled={submitTemplate.isPending} onClick={() => submitTemplate.mutate()}>{submitTemplate.isPending ? 'Submitting…' : 'Submit for approval'}</Button>}
            {template?.templateId && template.templateStatus !== 'APPROVED' && <Button variant="outline" size="sm" className="text-navy" disabled={syncTemplate.isPending} onClick={() => syncTemplate.mutate()}>{syncTemplate.isPending ? 'Checking…' : 'Check status'}</Button>}
          </div>
        </PermissionGuard>
      </section>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <label className="min-w-[13rem] flex-1 space-y-1"><span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Search</span>
          <Input placeholder="Quote number, customer, mobile or destination…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <label className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Show</span>
          <select className={filterSelect} value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'open' | 'approved')}><option value="all">All quotations ({rows.length})</option><option value="open">Not approved yet ({rows.length - approvedCount})</option><option value="approved">Approved — now invoices ({approvedCount})</option></select></label>
        <DateRangeFilter title="Select created date" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <label className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Category</span>
          <select className={filterSelect} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{QUOTATION_ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</select></label>
        <label className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Destination</span>
          <select className={filterSelect} value={destination} onChange={(e) => setDestination(e.target.value)}><option value="">All destinations</option>{destinations.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
        {filtered && <Button variant="outline" onClick={() => { setSearch(''); setFrom(''); setTo(''); setCategory(''); setDestination(''); setScope('all'); }}>Clear</Button>}
        <PermissionGuard permission={PERMISSIONS.QUOTATIONS_CREATE}>
          <Link href="/quotations/new" className="ml-auto"><Button variant="gold">+ New Quotation</Button></Link>
        </PermissionGuard>
      </div>
      {filtered && <p className="text-xs text-slate-500">{shownRows.length} quotation{shownRows.length === 1 ? '' : 's'} match these filters.</p>}
      {isError && <p className="text-sm text-red-500">Failed to load quotations: {(error as Error)?.message ?? 'unknown error'}</p>}

      <DataTable columns={columns} data={shownRows} isLoading={isLoading} stickyLastColumn
        onRowClick={(row) => router.push(`/quotations/${row.id}/edit`)}
        emptyMessage={filtered ? 'No quotations match these filters.' : 'No quotations yet. Create your first quotation to get started.'} />

      {remindFor && remindFor.invoice_id && <ReminderDialog invoiceId={remindFor.invoice_id} invoiceNumber={remindFor.invoice_number || ''} customerName={remindFor.customer_name ?? remindFor.lead_customer_name} total={Number(remindFor.final_amount || 0)} paid={Number(remindFor.paid_amount || 0)} onClose={() => setRemindFor(null)} />}

      {sendFor && (
        <SendWhatsAppDialog
          quotationId={sendFor.id}
          phone={String(sendFor.customer_phone || sendFor.lead_phone || '')}
          customerName={sendFor.customer_name ?? sendFor.lead_customer_name}
          defaultText={quotationMessage({ customerName: sendFor.customer_name ?? sendFor.lead_customer_name, quotationNumber: sendFor.quotation_number, destination: sendFor.destination, travelFrom: sendFor.travel_from, travelTo: sendFor.travel_to, adults: sendFor.adults, children: sendFor.children, infants: sendFor.infants, total: Number(sendFor.final_amount || 0), token: sendFor.public_share_token })}
          onClose={() => setSendFor(null)}
          onSent={() => qc.invalidateQueries({ queryKey: ['quotations'] })}
        />
      )}

      {payFor && (
        <RecordPaymentDialog
          title="Record payment"
          subtitle={`${payFor.quotation_number} · ${payFor.customer_name ?? payFor.lead_customer_name ?? 'Customer'}${payFor.invoice_id ? '' : ' — an invoice will be created'}`}
          total={Number(payFor.final_amount || 0)} paid={Number(payFor.paid_amount || 0)}
          onClose={() => setPayFor(null)}
          onSubmit={async (dto) => {
            const r = await api.post<PaymentResult>(`/finance/quotations/${payFor.id}/payments`, dto);
            qc.invalidateQueries({ queryKey: ['quotations'] }); qc.invalidateQueries({ queryKey: ['finance'] });
            return r;
          }}
        />
      )}
    </div>
  );
}
