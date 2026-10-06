'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ColumnDef } from '@tanstack/react-table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, HandCoins, IndianRupee, Pencil, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { DataTable } from '@/components/shared/data-table';
import { DateRangeFilter } from '@/components/shared/date-range-filter';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { PERMISSIONS } from '@/lib/permissions';
import { api } from '@/lib/api-client';
import { Vendor, TripLine, LINE_STATUS, VendorDialog, VendorMoneyDialog, categoryLabel, rupees, dateTime, dateOnly } from '@/components/vendors/vendor-book';

interface MatchingTrip { quotation_id: string; quotation_number: string; requirement_no: number; destination: string | null; travel_from: string | null; travel_to: string | null; adults: number | null; children: number | null; customer_name: string | null; customer_phone: string | null; invoice_id: string; invoice_number: string; invoice_total: number; invoice_date: string; same_kind_vendors: string | null }
interface VendorAccount {
  vendor: Vendor; trips: TripLine[]; matching?: MatchingTrip[];
  payments: { id: string; cost_id: string; kind: string; amount: number; method: string | null; reference: string | null; note: string | null; paid_at: string; by_name: string | null; quotation_number: string; customer_name: string | null; destination: string | null; source_customer: string | null; source_quotation: string | null }[];
}
const ymd = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// One vendor's account: every customer trip given to them, what was agreed, the advance and other
// payments, what is still to pay, and any credit they hold from cancelled trips.
export default function VendorAccountPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['vendor-book', 'vendor', id], queryFn: () => api.get<VendorAccount>(`/vendor-book/vendors/${id}`) });
  const [view, setView] = useState<'trips' | 'matching' | 'payments'>('trips');
  const [giving, setGiving] = useState<MatchingTrip | null>(null);
  const [opened, setOpened] = useState(false);
  const [status, setStatus] = useState('');
  const [destination, setDestination] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [editing, setEditing] = useState(false);
  const [money, setMoney] = useState<null | { line: TripLine; mode: 'payment' | 'vendor_refund' | 'credit' }>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['vendor-book'] });

  const trips = data?.trips ?? [];
  const matching = data?.matching ?? [];
  // Nothing given yet but customers are travelling where this vendor works: open on those trips.
  useEffect(() => { if (data && !opened) { setOpened(true); if (!data.trips.length && (data.matching ?? []).length) setView('matching'); } }, [data, opened]);
  const credits = trips.filter((t) => t.credit > 0);
  const totals = useMemo(() => trips.reduce((t, l) => ({ agreed: t.agreed + (l.cancelled ? 0 : l.agreed), paid: t.paid + l.paid - l.paid_from_credit - l.vendor_refunded, outstanding: t.outstanding + l.outstanding, credit: t.credit + l.credit }), { agreed: 0, paid: 0, outstanding: 0, credit: 0 }), [trips]);
  const destinations = useMemo(() => Array.from(new Set([...trips, ...matching].map((t) => String(t.destination ?? '').trim()).filter(Boolean))).sort(), [trips, matching]);
  const inDates = (iso?: string | null) => { if (!from && !to) return true; if (!iso) return false; const d = ymd(iso); return (!from || d >= from) && (!to || d <= to); };
  const filtered = !!(status || destination || search || from || to);
  const shownTrips = trips.filter((t) => (!status || t.status === status) && (!destination || String(t.destination ?? '').trim() === destination) && inDates(t.travel_from || t.created_at)
    && (!search || `${t.customer_name ?? ''} ${t.customer_phone ?? ''} ${t.quotation_number} ${t.destination ?? ''} ${t.description ?? ''}`.toLowerCase().includes(search.toLowerCase())));
  const shownMatching = matching.filter((t) => (!destination || String(t.destination ?? '').trim() === destination) && inDates(t.travel_from || t.invoice_date)
    && (!search || `${t.customer_name ?? ''} ${t.customer_phone ?? ''} ${t.quotation_number} ${t.invoice_number} ${t.destination ?? ''}`.toLowerCase().includes(search.toLowerCase())));
  const shownPayments = (data?.payments ?? []).filter((p) => inDates(p.paid_at) && (!destination || String(p.destination ?? '').trim() === destination)
    && (!search || `${p.customer_name ?? ''} ${p.quotation_number} ${p.reference ?? ''} ${p.note ?? ''}`.toLowerCase().includes(search.toLowerCase())));

  if (isLoading) return <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>;
  if (isError || !data) return <div className="p-8 text-center text-sm text-red-600">This vendor could not be loaded.</div>;
  const v = data.vendor;
  const icon = 'grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white hover:border-gold disabled:opacity-40';

  const tripColumns: ColumnDef<TripLine>[] = [
    { id: 'sn', header: 'S.No', cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.index + 1}</span> },
    { id: 'customer', header: 'Customer (lead)', cell: ({ row }) => <div><p className="font-semibold text-navy">{row.original.customer_name || '—'}</p><p className="text-[11px] tabular-nums text-muted-foreground">{row.original.customer_phone || ''}</p></div> },
    { id: 'trip', header: 'Trip', cell: ({ row }) => <div><p className="font-medium">{row.original.destination || '—'}</p><p className="whitespace-nowrap text-[11px] text-muted-foreground">{row.original.travel_from ? `${dateOnly(row.original.travel_from)}${row.original.travel_to ? ` → ${dateOnly(row.original.travel_to)}` : ''}` : 'Dates not set'}</p></div> },
    { id: 'quote', header: 'Quotation', cell: ({ row }) => <div className="whitespace-nowrap"><p className="text-xs font-semibold text-navy">{row.original.quotation_number}</p><p className="text-[11px] text-muted-foreground">R{row.original.requirement_no}{row.original.invoice_number ? ` · ${row.original.invoice_number}` : ''}</p></div> },
    { id: 'for', header: 'For', cell: ({ row }) => <span className="text-xs text-slate-600">{row.original.description || '—'}</span> },
    { id: 'agreed', header: 'Agreed', cell: ({ row }) => <span className="font-semibold tabular-nums">{rupees(row.original.agreed)}</span> },
    { id: 'paid', header: 'Paid', cell: ({ row }) => <div><span className="tabular-nums text-emerald-700">{rupees(row.original.paid)}</span>{row.original.last_paid_at && <p className="whitespace-nowrap text-[11px] text-muted-foreground">last {dateOnly(row.original.last_paid_at)}</p>}{row.original.paid_from_credit > 0 && <p className="whitespace-nowrap text-[11px] text-indigo-700">{rupees(row.original.paid_from_credit)} from credit</p>}</div> },
    { id: 'out', header: 'Still to pay', cell: ({ row }) => <span className={`tabular-nums ${row.original.outstanding > 0 ? 'font-bold text-red-600' : 'text-slate-500'}`}>{row.original.cancelled ? '—' : rupees(row.original.outstanding)}</span> },
    { id: 'status', header: 'Status', cell: ({ row }) => <div><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${LINE_STATUS[row.original.status]?.cls}`}>{LINE_STATUS[row.original.status]?.text}</span>{row.original.credit > 0 && <p className="mt-0.5 whitespace-nowrap text-[11px] font-semibold text-indigo-700">{rupees(row.original.credit)} credit left</p>}{row.original.credit_used > 0 && <p className="whitespace-nowrap text-[11px] text-muted-foreground">{rupees(row.original.credit_used)} used on other trips</p>}</div> },
    { id: 'actions', header: () => <span className="block text-right">Actions</span>, cell: ({ row }) => { const l = row.original; const usable = credits.filter((c) => c.id !== l.id); return (
      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <PermissionGuard permission={PERMISSIONS.VENDORS_EDIT}>
          {!l.cancelled && <button type="button" className="grid h-8 w-8 place-items-center rounded-lg bg-gold text-navy hover:brightness-95 disabled:opacity-40" title="Pay the vendor (advance or the rest)" aria-label="Pay the vendor" disabled={l.outstanding <= 0} onClick={() => setMoney({ line: l, mode: 'payment' })}><IndianRupee className="h-4 w-4" /></button>}
          {!l.cancelled && usable.length > 0 && l.outstanding > 0 && <button type="button" className={`${icon} text-indigo-700`} title="Use credit from a cancelled trip" aria-label="Use vendor credit" onClick={() => setMoney({ line: l, mode: 'credit' })}><HandCoins className="h-4 w-4" /></button>}
          {l.cancelled && l.credit > 0 && <button type="button" className={`${icon} text-emerald-700`} title="The vendor returned this money to us" aria-label="Vendor returned money" onClick={() => setMoney({ line: l, mode: 'vendor_refund' })}><Undo2 className="h-4 w-4" /></button>}
        </PermissionGuard>
        <button type="button" className={`${icon} text-navy`} title="Open the quotation" aria-label="Open quotation" onClick={() => router.push(`/quotations/${l.quotation_id}/edit`)}><FileText className="h-4 w-4" /></button>
      </div>
    ); } },
  ];
  const matchingColumns: ColumnDef<MatchingTrip>[] = [
    { id: 'sn', header: 'S.No', cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.index + 1}</span> },
    { id: 'customer', header: 'Customer (lead)', cell: ({ row }) => <div><p className="font-semibold text-navy">{row.original.customer_name || '—'}</p><p className="text-[11px] tabular-nums text-muted-foreground">{row.original.customer_phone || ''}</p></div> },
    { id: 'trip', header: 'Trip', cell: ({ row }) => <div><p className="font-medium">{row.original.destination || '—'}</p><p className="whitespace-nowrap text-[11px] text-muted-foreground">{row.original.travel_from ? `${dateOnly(row.original.travel_from)}${row.original.travel_to ? ` → ${dateOnly(row.original.travel_to)}` : ''}` : 'Dates not set'}</p></div> },
    { id: 'pax', header: 'Travellers', cell: ({ row }) => <span className="whitespace-nowrap text-xs">{Number(row.original.adults) || 0} adult{Number(row.original.adults) === 1 ? '' : 's'}{Number(row.original.children) ? `, ${row.original.children} child${Number(row.original.children) === 1 ? '' : 'ren'}` : ''}</span> },
    { id: 'inv', header: 'Invoice', cell: ({ row }) => <div className="whitespace-nowrap"><p className="text-xs font-semibold text-navy">{row.original.invoice_number}</p><p className="text-[11px] text-muted-foreground">{row.original.quotation_number} · R{row.original.requirement_no}</p></div> },
    { id: 'total', header: 'Customer pays', cell: ({ row }) => <span className="font-semibold tabular-nums">{rupees(row.original.invoice_total)}</span> },
    { id: 'other', header: `${categoryLabel(v.category)} on this trip`, cell: ({ row }) => row.original.same_kind_vendors ? <span className="text-xs text-amber-700">Already with {row.original.same_kind_vendors}</span> : <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">None yet</span> },
    { id: 'actions', header: () => <span className="block text-right">Actions</span>, cell: ({ row }) => (
      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <PermissionGuard permission={PERMISSIONS.VENDORS_EDIT}><button type="button" className="grid h-8 w-8 place-items-center rounded-lg bg-gold text-navy hover:brightness-95" title="Record a payment to this vendor for this trip" aria-label="Pay the vendor for this trip" onClick={() => setGiving(row.original)}><IndianRupee className="h-4 w-4" /></button></PermissionGuard>
        <button type="button" className={`${icon} text-navy`} title="Open the invoice" aria-label="Open invoice" onClick={() => router.push(`/finance/invoices/${row.original.invoice_id}`)}><FileText className="h-4 w-4" /></button>
      </div>
    ) },
  ];
  const paymentColumns: ColumnDef<VendorAccount['payments'][number]>[] = [
    { id: 'sn', header: 'S.No', cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.index + 1}</span> },
    { id: 'when', header: 'Date & time', cell: ({ row }) => <span className="whitespace-nowrap text-xs">{dateTime(row.original.paid_at)}</span> },
    { id: 'what', header: 'Entry', cell: ({ row }) => <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${row.original.kind === 'payment' ? 'bg-emerald-100 text-emerald-700' : row.original.kind === 'credit_applied' ? 'bg-indigo-100 text-indigo-800' : 'bg-amber-100 text-amber-800'}`}>{row.original.kind === 'payment' ? 'Paid to vendor' : row.original.kind === 'credit_applied' ? 'Credit used' : 'Returned by vendor'}</span> },
    { id: 'customer', header: 'For customer', cell: ({ row }) => <div><p className="font-semibold text-navy">{row.original.customer_name || '—'}</p><p className="text-[11px] text-muted-foreground">{row.original.destination || ''} · {row.original.quotation_number}</p></div> },
    { id: 'amount', header: 'Amount', cell: ({ row }) => <span className="font-semibold tabular-nums">{rupees(row.original.amount)}</span> },
    { id: 'how', header: 'Method', cell: ({ row }) => <span className="text-xs capitalize">{row.original.kind === 'credit_applied' ? `Credit from ${row.original.source_customer || 'a cancelled trip'}${row.original.source_quotation ? ` (${row.original.source_quotation})` : ''}` : (row.original.method || '—').replace(/_/g, ' ')}</span> },
    { id: 'ref', header: 'Reference / note', cell: ({ row }) => <span className="text-xs text-slate-600">{[row.original.reference, row.original.kind === 'credit_applied' ? null : row.original.note].filter(Boolean).join(' · ') || '—'}</span> },
    { id: 'by', header: 'Recorded by', cell: ({ row }) => <span className="text-xs">{row.original.by_name || '—'}</span> },
  ];
  const tiles: [string, string, string][] = [['Trips given', String(trips.length), 'text-white'], ['Agreed', rupees(totals.agreed), 'text-white'], ['Paid', rupees(totals.paid), 'text-emerald-300'], ['Still to pay', rupees(totals.outstanding), totals.outstanding ? 'text-rose-300' : 'text-slate-300'], ['Credit they hold', rupees(totals.credit), totals.credit ? 'text-amber-300' : 'text-slate-300']];

  return (
    <div className="space-y-4">
      <button type="button" onClick={() => router.push('/vendors')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-navy"><ArrowLeft className="h-4 w-4" /> Back to Vendors</button>

      <section className="rounded-2xl bg-gradient-to-br from-navy to-slate-900 p-5 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gold">{categoryLabel(v.category)}</p>
            <h1 className="mt-1 text-2xl font-bold">{v.name}</h1>
            <p className="mt-0.5 text-sm text-slate-300">{[v.phone, v.contact_person, v.email].filter(Boolean).join(' · ') || 'No contact details'}</p>
            <p className="mt-1 text-xs text-slate-400">{(v.destinations ?? []).length ? `Serves: ${v.destinations.join(', ')}` : 'Serves all destinations'}{v.category === 'transport' && (v.seaters ?? []).length ? ` · ${v.seaters.join(', ')} seater` : ''}{v.category === 'travel' && (v.travel_modes ?? []).length ? ` · ${v.travel_modes.join(', ')}` : ''}{v.bank_details ? ` · Pay to: ${v.bank_details}` : ''}</p>
          </div>
          <PermissionGuard permission={PERMISSIONS.VENDORS_EDIT}><button type="button" onClick={() => setEditing(true)} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20"><Pencil className="h-3.5 w-3.5" />Edit vendor</button></PermissionGuard>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {tiles.map(([label, value, cls]) => <div key={label} className="rounded-xl bg-white/5 p-3"><p className={`truncate text-lg font-bold tabular-nums ${cls}`}>{value}</p><p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-400">{label}</p></div>)}
        </div>
        {totals.credit > 0 && <p className="mt-3 rounded-xl bg-amber-400/15 px-3 py-2 text-sm text-amber-100">This vendor holds <b>{rupees(totals.credit)}</b> of your money from {credits.length} cancelled trip{credits.length === 1 ? '' : 's'} ({credits.map((c) => c.customer_name || c.quotation_number).join(', ')}). Use it on their next trip with the credit button, or record it when they return it.</p>}
      </section>

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {([['trips', `Trips given (${shownTrips.length})`], ['matching', `Customers going there (${shownMatching.length})`], ['payments', `Payment history (${shownPayments.length})`]] as const).map(([k, label]) => <button key={k} type="button" onClick={() => setView(k)} className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold ${view === k ? 'border-gold text-navy dark:text-white' : 'border-transparent text-muted-foreground hover:text-navy'}`}>{label}</button>)}
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <label className="min-w-[14rem] flex-1 space-y-1"><span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Search</span><Input placeholder="Customer, mobile, quotation, destination…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        {view === 'trips' && <label className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Payment</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-56 rounded-md border border-input bg-background px-3 text-sm"><option value="">All trips</option>{Object.entries(LINE_STATUS).map(([k, s]) => <option key={k} value={k}>{s.text}</option>)}</select></label>}
        <label className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Destination</span>
          <select value={destination} onChange={(e) => setDestination(e.target.value)} className="h-10 w-48 rounded-md border border-input bg-background px-3 text-sm"><option value="">All destinations</option>{destinations.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
        <div className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{view === 'payments' ? 'Payment date' : 'Travel date'}</span><DateRangeFilter title={view === 'payments' ? 'Select payment date' : 'Select travel date'} from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} /></div>
        {filtered && <Button variant="outline" onClick={() => { setStatus(''); setDestination(''); setSearch(''); setFrom(''); setTo(''); }}>Clear</Button>}
      </div>

      {view === 'matching' && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Confirmed bookings (invoice made, not cancelled) going to {(v.destinations ?? []).length ? v.destinations.join(', ') : 'any destination'} that are not with this vendor yet. Press the <b>₹</b> button to record what you paid {v.name} for that customer{v.category === 'hotel' ? ', with the number of nights' : ''}.</p>}
      {view === 'matching'
        ? <DataTable columns={matchingColumns} data={shownMatching} stickyLastColumn emptyMessage={matching.length ? 'No trip matches these filters.' : 'No confirmed booking is going to this vendor’s destinations right now.'} />
        : view === 'trips'
        ? <DataTable columns={tripColumns} data={shownTrips} stickyLastColumn emptyMessage={trips.length ? 'No trip matches these filters.' : matching.length ? `No trip has been given to this vendor yet. ${matching.length} confirmed booking${matching.length === 1 ? ' is' : 's are'} going there — see “Customers going there”.` : 'No trip has been given to this vendor yet. Open a quotation and add them under “Vendors & trip account”.'} onRowClick={(row) => router.push(`/quotations/${row.quotation_id}/edit`)} />
        : <DataTable columns={paymentColumns} data={shownPayments} emptyMessage={data.payments.length ? 'No payment matches these filters.' : 'No payment recorded for this vendor yet.'} />}

      {giving && <GiveTripDialog vendor={v} trip={giving} onClose={() => setGiving(null)} onSaved={() => { setGiving(null); setView('trips'); refresh(); }} />}
      {editing && <VendorDialog vendor={v} category={v.category} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} />}
      {money && <VendorMoneyDialog line={money.line} mode={money.mode} credits={credits.filter((c) => c.id !== money.line.id)} onClose={() => setMoney(null)} onSaved={() => { setMoney(null); refresh(); }} />}
    </div>
  );
}

// Record a payment to this vendor for a confirmed trip. Doing so also puts the trip on the vendor's
// account ("Trips given"), so there is no separate step to give the trip first.
function GiveTripDialog({ vendor, trip, onClose, onSaved }: { vendor: Vendor; trip: MatchingTrip; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const hotel = vendor.category === 'hotel';
  const tripNights = trip.travel_from && trip.travel_to ? Math.max(Math.round((new Date(trip.travel_to).getTime() - new Date(trip.travel_from).getTime()) / 86400000), 0) : 0;
  const [nights, setNights] = useState(tripNights ? String(tripNights) : '');
  const [payNow, setPayNow] = useState('');
  const [total, setTotal] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  const [paidAt, setPaidAt] = useState(now.getFullYear() + '-' + two(now.getMonth() + 1) + '-' + two(now.getDate()) + 'T' + two(now.getHours()) + ':' + two(now.getMinutes()));
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const pay = Number(payNow) || 0;
  const agreed = Number(total) || pay;
  const badPay = pay <= 0;
  const badNights = hotel && !(Number(nights) > 0);
  const badTotal = total !== '' && Number(total) < pay;
  async function save() {
    setTried(true);
    if (badPay) { toast('Enter the amount paid to the vendor', 'error'); return; }
    if (badNights) { toast('Enter the number of nights', 'error'); return; }
    if (badTotal) { toast('The total for the trip cannot be less than the payment', 'error'); return; }
    const n = Number(nights) || 0;
    const description = [hotel && n ? n + (n === 1 ? ' night' : ' nights') : '', note.trim()].filter(Boolean).join(' · ');
    setSaving(true);
    try {
      await api.post('/vendor-book/trips/' + trip.quotation_id + '/costs', { vendorId: vendor.id, description, agreedAmount: agreed, payNow: pay, method, reference, paidAt: new Date(paidAt).toISOString() });
      toast('Payment to the vendor recorded', 'success'); onSaved();
    } catch (e: any) { toast(e.message || 'Could not save', 'error'); }
    finally { setSaving(false); }
  }
  const red = (bad: boolean) => (tried && bad ? 'border-red-500' : '');
  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-navy">Pay {vendor.name}</h3>
        <p className="text-xs text-slate-500">{trip.customer_name || 'Customer'} · {trip.destination || ''} · {trip.invoice_number}{trip.travel_from ? ' · ' + dateOnly(trip.travel_from) + (trip.travel_to ? ' → ' + dateOnly(trip.travel_to) : '') : ''}</p>
        {trip.same_kind_vendors && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">This trip already has {trip.same_kind_vendors} for the same kind of service. Pay {vendor.name} only if both are used.</p>}
        <div className="mt-3 grid grid-cols-2 gap-3">
          {hotel && <div className="space-y-1"><Label htmlFor="g-nights">Nights <span className="text-red-600">*</span></Label>
            <Input id="g-nights" type="number" min={1} inputMode="numeric" value={nights} onChange={(e) => setNights(e.target.value)} className={red(badNights)} /></div>}
          <div className={hotel ? 'space-y-1' : 'col-span-2 space-y-1'}><Label htmlFor="g-pay">Amount paid now (₹) <span className="text-red-600">*</span></Label>
            <Input id="g-pay" type="number" min={1} inputMode="numeric" autoFocus value={payNow} onChange={(e) => setPayNow(e.target.value)} className={red(badPay)} /></div>
          <div className="col-span-2 space-y-1"><Label htmlFor="g-total">Total for this trip (₹) — only if more is to be paid later</Label>
            <Input id="g-total" type="number" min={1} inputMode="numeric" placeholder={pay ? 'Same as the payment: ' + rupees(pay) : 'Leave empty if this payment is the full amount'} value={total} onChange={(e) => setTotal(e.target.value)} className={red(badTotal)} /></div>
          <div className="space-y-1"><Label htmlFor="g-method">Paid by</Label>
            <select id="g-method" value={method} onChange={(e) => setMethod(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="card">Card</option>
            </select></div>
          <div className="space-y-1"><Label htmlFor="g-when">Date & time</Label>
            <Input id="g-when" type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="g-ref">Reference (optional)</Label>
            <Input id="g-ref" placeholder="UTR / cheque no." value={reference} onChange={(e) => setReference(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="g-for">Note (optional)</Label>
            <Input id="g-for" placeholder="e.g. 2 rooms with breakfast" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        {pay > 0 && !badTotal && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">Total {rupees(agreed)} · paid now {rupees(pay)} · still to pay <b className={agreed - pay > 0 ? 'text-red-600' : 'text-emerald-700'}>{rupees(agreed - pay)}</b></p>}
        <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="gold" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Record payment'}</Button></div>
      </div>
    </div>
  );
}
