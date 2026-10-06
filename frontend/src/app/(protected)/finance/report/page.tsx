'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { Download, FileJson, FileText, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/shared/data-table';
import { DateRangeFilter } from '@/components/shared/date-range-filter';
import { api } from '@/lib/api-client';
import { VENDOR_TABS, rupees, dateOnly } from '@/components/vendors/vendor-book';

interface VendorLine { vendor: string; vendor_phone: string | null; category: string | null; description: string | null; agreed: number; paid: number; paid_from_credit: number; outstanding: number; credit: number; status: string }
interface Trip {
  invoice_id: string; invoice_number: string; invoice_date: string; invoice_status: string; cancelled: boolean; cancel_reason: string | null;
  taxable: number; gst: number; total: number; received: number; refunded: number; kept: number; balance: number; gstInReceived: number;
  quotation_id: string; quotation_number: string; requirement_no: number; destination: string | null; travel_from: string | null; travel_to: string | null;
  customer_name: string | null; customer_phone: string | null; handled_by: string | null;
  vendors: Record<string, { agreed: number; paid: number }>; vendorAgreed: number; vendorPaid: number; vendorCreditUsed: number; vendorOutstanding: number; vendorCredit: number;
  margin: number; cashInHand: number; vendorLines: VendorLine[];
}
interface Report { period: { from: string | null; to: string | null }; company: Record<string, string | null> | null; data: Trip[] }

const stateOf = (t: Trip) => (t.cancelled ? 'cancelled' : t.balance <= 0 ? 'paid' : t.received > 0 ? 'part' : 'unpaid');
const STATE: Record<string, { text: string; cls: string }> = { paid: { text: 'Paid in full', cls: 'bg-emerald-100 text-emerald-700' }, part: { text: 'Part paid', cls: 'bg-amber-100 text-amber-800' }, unpaid: { text: 'Not paid', cls: 'bg-red-100 text-red-700' }, cancelled: { text: 'Cancelled', cls: 'bg-slate-200 text-slate-700' } };
// The calendar date in India (an invoice raised at 1 am on the 1st belongs to that month, not the one before).
const indiaDate = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
function save(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Finance: every confirmed trip from the customer's payment to the margin that is left --
// what was billed and received, what went to the hotel, transport and other vendors, and what
// remains. The same figures can be downloaded as JSON (for accounts / GST) or as a spreadsheet.
export default function FinanceReportPage() {
  const router = useRouter();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [destination, setDestination] = useState('');
  const [state, setState] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Trip | null>(null);
  // Two views of the same invoices: trips and their margin, or the GST on them for filing.
  const [view, setView] = useState<'trips' | 'gst'>('trips');
  const qs = `${from ? `from=${from}` : ''}${to ? `&to=${to}` : ''}`;
  const { data, isLoading, isError } = useQuery({ queryKey: ['vendor-book', 'finance', qs], queryFn: () => api.get<Report>(`/vendor-book/finance?${qs}`) });
  const all = data?.data ?? [];
  const destinations = useMemo(() => Array.from(new Set(all.map((t) => String(t.destination ?? '').trim()).filter(Boolean))).sort(), [all]);
  const rows = all.filter((t) => (!destination || String(t.destination ?? '').trim() === destination) && (!state || stateOf(t) === state)
    && (!search || `${t.customer_name ?? ''} ${t.customer_phone ?? ''} ${t.invoice_number} ${t.quotation_number} ${t.destination ?? ''} ${t.handled_by ?? ''}`.toLowerCase().includes(search.toLowerCase())));
  const sum = (f: (t: Trip) => number) => rows.reduce((n, t) => n + f(t), 0);
  const totals = { billed: sum((t) => (t.cancelled ? 0 : t.taxable)), gst: sum((t) => (t.cancelled ? 0 : t.gst)), received: sum((t) => t.received), refunded: sum((t) => t.refunded), balance: sum((t) => t.balance),
    vendorAgreed: sum((t) => t.vendorAgreed), vendorPaid: sum((t) => t.vendorPaid), vendorOutstanding: sum((t) => t.vendorOutstanding), vendorCredit: sum((t) => t.vendorCredit), margin: sum((t) => t.margin), cash: sum((t) => t.cashInHand) };
  const filtered = !!(from || to || destination || state || search);
  const periodText = from || to ? `${from || 'start'} to ${to || 'today'}` : 'all dates';

  // ---- GST: one line per invoice. Sales to customers without a GSTIN are B2C; the tax is split
  // half CGST and half SGST (a sale within the company's own state).
  const gstin = String(data?.company?.gstin ?? '').trim().toUpperCase();
  const stateCode = /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : '33';
  const gstRows = rows.map((t) => {
    const rate = t.taxable > 0 ? Math.round((t.gst / t.taxable) * 1000) / 10 : 0;
    const half = Math.round((t.gst / 2) * 100) / 100;
    return { invoice_number: t.invoice_number, invoice_date: indiaDate(t.invoice_date), customer_name: t.customer_name ?? '', customer_mobile: t.customer_phone ?? '', customer_gstin: '', supply_type: 'B2C', place_of_supply: stateCode,
      description: `Tour package${t.destination ? ` - ${t.destination}` : ''}`, taxable_value: t.taxable, gst_rate: rate, cgst: half, sgst: Math.round((t.gst - half) * 100) / 100, igst: 0, total_gst: t.gst, invoice_value: t.total,
      status: t.cancelled ? 'cancelled' : 'valid', cancel_reason: t.cancel_reason ?? '', refunded: t.refunded, amount_received: t.received };
  });
  const valid = gstRows.filter((r) => r.status === 'valid');
  const gstTotals = { invoices: valid.length, cancelled: gstRows.length - valid.length, taxable_value: valid.reduce((n, r) => n + r.taxable_value, 0), cgst: valid.reduce((n, r) => n + r.cgst, 0), sgst: valid.reduce((n, r) => n + r.sgst, 0), igst: 0, total_gst: valid.reduce((n, r) => n + r.total_gst, 0), invoice_value: valid.reduce((n, r) => n + r.invoice_value, 0) };
  const byRate = Array.from(valid.reduce((m, r) => { const k = r.gst_rate; const c = m.get(k) ?? { rate: k, invoices: 0, taxable_value: 0, cgst: 0, sgst: 0, total_gst: 0 }; c.invoices++; c.taxable_value += r.taxable_value; c.cgst += r.cgst; c.sgst += r.sgst; c.total_gst += r.total_gst; m.set(k, c); return m; }, new Map<number, { rate: number; invoices: number; taxable_value: number; cgst: number; sgst: number; total_gst: number }>()).values()).sort((a, b) => a.rate - b.rate);
  const filingPeriod = from && to && from.slice(0, 7) === to.slice(0, 7) ? `${from.slice(5, 7)}${from.slice(0, 4)}` : null;
  function thisMonth(offset: number) {
    const d = new Date(); const first = new Date(d.getFullYear(), d.getMonth() + offset, 1); const last = new Date(d.getFullYear(), d.getMonth() + offset + 1, 0);
    const f = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    setFrom(f(first)); setTo(f(last));
  }
  function downloadGstJson() {
    save(`gst-${from || 'all'}-${to || 'all'}.json`, JSON.stringify({
      generatedAt: new Date().toISOString(), company: data?.company ?? null, gstin: gstin || null, period: { from: from || null, to: to || null, filing_period_mmyyyy: filingPeriod }, currency: 'INR',
      summary: gstTotals, rate_wise: byRate,
      // the same sales in the shape of GSTR-1's B2C (small) table: one entry per tax rate
      gstr1_b2cs: byRate.map((r) => ({ sply_ty: 'INTRA', typ: 'OE', pos: stateCode, rt: r.rate, txval: Math.round(r.taxable_value * 100) / 100, camt: Math.round(r.cgst * 100) / 100, samt: Math.round(r.sgst * 100) / 100, csamt: 0 })),
      documents_issued: { from: valid.length ? valid[valid.length - 1].invoice_number : null, to: valid.length ? valid[0].invoice_number : null, total: gstRows.length, cancelled: gstTotals.cancelled, net_issued: valid.length },
      invoices: gstRows,
    }, null, 2), 'application/json');
  }
  function downloadGstCsv() {
    const head = ['Invoice number', 'Invoice date', 'Customer name', 'Customer mobile', 'Customer GSTIN', 'Supply type', 'Place of supply (state code)', 'Description', 'Taxable value', 'GST rate %', 'CGST', 'SGST', 'IGST', 'Total GST', 'Invoice value', 'Status', 'Cancel reason', 'Amount received', 'Refunded'];
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const body = gstRows.map((r) => [r.invoice_number, r.invoice_date, r.customer_name, r.customer_mobile, r.customer_gstin, r.supply_type, r.place_of_supply, r.description, r.taxable_value, r.gst_rate, r.cgst, r.sgst, r.igst, r.total_gst, r.invoice_value, r.status, r.cancel_reason, r.amount_received, r.refunded].map(cell).join(','));
    const total = ['TOTAL (valid invoices)', '', '', '', '', '', '', '', gstTotals.taxable_value, '', gstTotals.cgst, gstTotals.sgst, 0, gstTotals.total_gst, gstTotals.invoice_value, '', '', '', ''].map(cell).join(',');
    save(`gst-${from || 'all'}-${to || 'all'}.csv`, '\uFEFF' + [head.map(cell).join(','), ...body, total].join('\r\n'), 'text/csv');
  }
  const gstColumns: ColumnDef<(typeof gstRows)[number]>[] = [
    { id: 'sn', header: 'S.No', cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.index + 1}</span> },
    { id: 'no', header: 'Invoice no.', cell: ({ row }) => <span className="whitespace-nowrap font-semibold text-navy">{row.original.invoice_number}</span> },
    { id: 'date', header: 'Invoice date', cell: ({ row }) => <span className="whitespace-nowrap text-xs">{dateOnly(row.original.invoice_date)}</span> },
    { id: 'customer', header: 'Customer', cell: ({ row }) => <div><p className="font-medium text-navy">{row.original.customer_name || '—'}</p><p className="text-[11px] text-muted-foreground">{row.original.supply_type} · no GSTIN</p></div> },
    { id: 'pos', header: 'Place of supply', cell: ({ row }) => <span className="tabular-nums">{row.original.place_of_supply}</span> },
    { id: 'tx', header: 'Taxable value', cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{rupees(row.original.taxable_value)}</span> },
    { id: 'rt', header: 'Rate', cell: ({ row }) => <span className="tabular-nums">{row.original.gst_rate}%</span> },
    { id: 'c', header: 'CGST', cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{rupees(row.original.cgst)}</span> },
    { id: 's', header: 'SGST', cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{rupees(row.original.sgst)}</span> },
    { id: 'g', header: 'Total GST', cell: ({ row }) => <span className="whitespace-nowrap font-bold tabular-nums text-navy">{rupees(row.original.total_gst)}</span> },
    { id: 'v', header: 'Invoice value', cell: ({ row }) => <span className="whitespace-nowrap font-semibold tabular-nums">{rupees(row.original.invoice_value)}</span> },
    { id: 'st', header: 'Status', cell: ({ row }) => <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${row.original.status === 'valid' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'}`}>{row.original.status === 'valid' ? 'Valid' : 'Cancelled'}</span> },
  ];

  function downloadJson() {
    save(`finance-${from || 'all'}-${to || 'all'}.json`, JSON.stringify({ generatedAt: new Date().toISOString(), period: { from: from || null, to: to || null }, filters: { destination: destination || null, status: state || null, search: search || null }, company: data?.company ?? null, currency: 'INR', totals, trips: rows }, null, 2), 'application/json');
  }
  function downloadCsv() {
    const head = ['Invoice', 'Invoice date', 'Quotation', 'Customer', 'Mobile', 'Destination', 'Travel from', 'Travel to', 'Handled by', 'Status', 'Taxable', 'GST', 'Invoice total', 'Received', 'Refunded', 'Balance', ...VENDOR_TABS.map((v) => `${v.label} cost`), 'Vendor cost total', 'Paid to vendors', 'Still to pay vendors', 'Credit with vendors', 'Margin', 'Cash in hand'];
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((t) => [t.invoice_number, indiaDate(t.invoice_date), t.quotation_number, t.customer_name, t.customer_phone, t.destination, t.travel_from?.slice(0, 10), t.travel_to?.slice(0, 10), t.handled_by, STATE[stateOf(t)].text, t.taxable, t.gst, t.total, t.received, t.refunded, t.balance, ...VENDOR_TABS.map((v) => t.vendors?.[v.key]?.agreed ?? 0), t.vendorAgreed, t.vendorPaid, t.vendorOutstanding, t.vendorCredit, t.margin, t.cashInHand].map(cell).join(','));
    save(`finance-${from || 'all'}-${to || 'all'}.csv`, '﻿' + [head.map(cell).join(','), ...lines].join('\r\n'), 'text/csv');
  }

  const money = (n: number, cls = '') => <span className={`whitespace-nowrap tabular-nums ${cls}`}>{rupees(n)}</span>;
  const columns: ColumnDef<Trip>[] = [
    { id: 'sn', header: 'S.No', cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.index + 1}</span> },
    { id: 'invoice', header: 'Invoice', cell: ({ row }) => <div className="whitespace-nowrap"><p className="font-semibold text-navy">{row.original.invoice_number}</p><p className="text-[11px] text-muted-foreground">{dateOnly(row.original.invoice_date)}</p></div> },
    { id: 'customer', header: 'Customer (lead)', cell: ({ row }) => <div><p className="font-semibold text-navy">{row.original.customer_name || '—'}</p><p className="text-[11px] text-muted-foreground">{row.original.destination || ''}{row.original.handled_by ? ` · ${row.original.handled_by}` : ''}</p></div> },
    { id: 'billed', header: 'Billed', cell: ({ row }) => <div>{money(row.original.total, 'font-semibold')}<p className="whitespace-nowrap text-[11px] text-muted-foreground">{rupees(row.original.taxable)} + GST {rupees(row.original.gst)}</p></div> },
    { id: 'received', header: 'Received', cell: ({ row }) => <div>{money(row.original.received, 'text-emerald-700')}{row.original.refunded > 0 && <p className="whitespace-nowrap text-[11px] text-amber-700">− {rupees(row.original.refunded)} refunded</p>}</div> },
    ...VENDOR_TABS.map((v): ColumnDef<Trip> => ({ id: v.key, header: v.key === 'travel' ? 'Tickets' : v.label, cell: ({ row }) => { const a = row.original.vendors?.[v.key]?.agreed ?? 0; return a ? money(a) : <span className="text-xs text-muted-foreground">—</span>; } })),
    { id: 'vendorTotal', header: 'Vendors total', cell: ({ row }) => <div>{money(row.original.vendorAgreed, 'font-semibold')}{row.original.vendorOutstanding > 0 && <p className="whitespace-nowrap text-[11px] text-red-600">{rupees(row.original.vendorOutstanding)} still to pay</p>}</div> },
    { id: 'margin', header: 'Margin', cell: ({ row }) => money(row.original.margin, `font-bold ${row.original.margin >= 0 ? 'text-emerald-700' : 'text-red-600'}`) },
    { id: 'status', header: 'Status', cell: ({ row }) => <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE[stateOf(row.original)].cls}`}>{STATE[stateOf(row.original)].text}</span> },
    { id: 'actions', header: () => <span className="block text-right">Open</span>, cell: ({ row }) => (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="grid h-8 w-8 place-items-center rounded-lg bg-gold text-navy hover:brightness-95" title="See the breakdown" aria-label="See the breakdown" onClick={() => setOpen(row.original)}><FileText className="h-4 w-4" /></button>
      </div>
    ) },
  ];
  const gstTiles: [string, string, string][] = [
    ['Invoices (valid)', String(gstTotals.invoices), 'text-white'], ['Taxable value', rupees(gstTotals.taxable_value), 'text-white'], ['CGST', rupees(gstTotals.cgst), 'text-sky-300'], ['SGST', rupees(gstTotals.sgst), 'text-sky-300'],
    ['IGST', rupees(0), 'text-slate-300'], ['Total GST to pay', rupees(gstTotals.total_gst), 'text-gold'], ['Invoice value', rupees(gstTotals.invoice_value), 'text-white'], ['Cancelled invoices', String(gstTotals.cancelled), gstTotals.cancelled ? 'text-rose-300' : 'text-slate-300'],
  ];
  const tiles: [string, string, string][] = [
    ['Billed before tax', rupees(totals.billed), 'text-white'], ['GST billed', rupees(totals.gst), 'text-slate-300'], ['Received from customers', rupees(totals.received - totals.refunded), 'text-emerald-300'], ['Still to collect', rupees(totals.balance), totals.balance ? 'text-rose-300' : 'text-slate-300'],
    ['Vendor cost', rupees(totals.vendorAgreed), 'text-white'], ['Paid to vendors', rupees(totals.vendorPaid), 'text-sky-300'], ['Still to pay vendors', rupees(totals.vendorOutstanding), totals.vendorOutstanding ? 'text-rose-300' : 'text-slate-300'], ['Margin', rupees(totals.margin), totals.margin >= 0 ? 'text-gold' : 'text-rose-300'],
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-gradient-to-br from-navy to-slate-900 p-5 text-white shadow-xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs font-bold uppercase tracking-widest text-gold">Accounts</p><h1 className="mt-1 text-2xl font-bold">Finance</h1><p className="mt-0.5 text-xs text-slate-300">{rows.length} confirmed trip{rows.length === 1 ? '' : 's'} · {periodText}</p></div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(view === 'gst' ? gstTiles : tiles).map(([label, value, cls]) => <div key={label} className="rounded-xl bg-white/5 p-3"><p className={`truncate text-lg font-bold tabular-nums ${cls}`}>{value}</p><p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-400">{label}</p></div>)}
        </div>
        {view === 'gst' && <p className="mt-3 border-t border-white/10 pt-3 text-xs text-slate-300">GST on the invoices raised in this period (outward supplies). {gstin ? <>Your GSTIN: <b className="text-white">{gstin}</b>.</> : <b className="text-amber-300">Your GSTIN is not filled in Settings → Company.</b>} All customers are treated as B2C within your state, so the tax is split half CGST and half SGST. Cancelled invoices are listed but left out of the totals.</p>}
        <p className={`mt-3 border-t border-white/10 pt-3 text-xs text-slate-300 ${view === 'gst' ? 'hidden' : ''}`}>Margin = billed before tax − vendor cost. In hand today: <b className={totals.cash >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{rupees(totals.cash)}</b> (received, less GST and refunds, less what has already been paid to vendors).{totals.vendorCredit > 0 && <> Credit lying with vendors from cancelled trips: <b className="text-amber-300">{rupees(totals.vendorCredit)}</b>.</>}</p>
      </section>

      <div className="grid grid-cols-2 gap-2 sm:max-w-xl">
        {([['trips', 'Trips & margin', 'What each trip earned'], ['gst', 'GST for filing', 'Tax on the invoices raised']] as const).map(([k, label, hint]) => (
          <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} className={`rounded-xl border-2 p-3 text-left transition ${view === k ? 'border-navy bg-navy text-white shadow-lg' : 'border-slate-200 bg-white text-navy hover:border-gold'}`}><span className="block text-sm font-bold">{label}</span><span className={`block text-[11px] ${view === k ? 'text-slate-300' : 'text-slate-500'}`}>{hint}</span></button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Download {view === 'gst' ? 'the GST figures' : 'the trips and margin'}</span>
        <button type="button" onClick={view === 'gst' ? downloadGstJson : downloadJson} disabled={!rows.length} className="flex items-center gap-1.5 rounded-lg bg-gold px-3 py-2 text-xs font-bold text-navy hover:brightness-95 disabled:opacity-50"><FileJson className="h-4 w-4" />{view === 'gst' ? 'Download GST JSON' : 'Download JSON'}</button>
        <button type="button" onClick={view === 'gst' ? downloadGstCsv : downloadCsv} disabled={!rows.length} className="flex items-center gap-1.5 rounded-lg bg-navy px-3 py-2 text-xs font-bold text-white hover:brightness-125 disabled:opacity-50"><Download className="h-4 w-4" />{view === 'gst' ? 'Download GST CSV' : 'Download Excel (CSV)'}</button>
        <span className="text-xs text-slate-500">{rows.length} invoice{rows.length === 1 ? '' : 's'} · {periodText}</span>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <label className="min-w-[14rem] flex-1 space-y-1"><span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Search</span><Input placeholder="Customer, mobile, invoice, quotation, destination…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <div className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Invoice date</span><DateRangeFilter title="Select invoice date" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} /></div>
        <label className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Destination</span>
          <select value={destination} onChange={(e) => setDestination(e.target.value)} className="h-10 w-48 rounded-md border border-input bg-background px-3 text-sm"><option value="">All destinations</option>{destinations.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
        <label className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Customer payment</span>
          <select value={state} onChange={(e) => setState(e.target.value)} className="h-10 w-44 rounded-md border border-input bg-background px-3 text-sm"><option value="">All</option>{Object.entries(STATE).map(([k, s]) => <option key={k} value={k}>{s.text}</option>)}</select></label>
        {view === 'gst' && <div className="flex gap-1.5"><Button variant="outline" onClick={() => thisMonth(0)}>This month</Button><Button variant="outline" onClick={() => thisMonth(-1)}>Last month</Button></div>}
        {filtered && <Button variant="outline" onClick={() => { setFrom(''); setTo(''); setDestination(''); setState(''); setSearch(''); }}>Clear</Button>}
      </div>
      {view === 'gst' && byRate.length > 0 && (
        <div className="flex flex-wrap gap-2">{byRate.map((r) => <span key={r.rate} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"><b className="text-navy">{r.rate}% GST</b> · {r.invoices} invoice{r.invoices === 1 ? '' : 's'} · taxable {rupees(r.taxable_value)} · CGST {rupees(r.cgst)} · SGST {rupees(r.sgst)}</span>)}</div>
      )}
      {isError && <p className="text-sm text-red-500">Could not load the finance report.</p>}

      {view === 'gst'
        ? <DataTable columns={gstColumns} data={gstRows} isLoading={isLoading} emptyMessage="No invoice in this period." />
        : <DataTable columns={columns} data={rows} isLoading={isLoading} stickyLastColumn
            emptyMessage={all.length ? 'No trip matches these filters.' : 'No confirmed trip yet. A trip appears here once its quotation is approved or a payment is recorded.'}
            onRowClick={(row) => setOpen(row)} />}

      {open && (() => { const t = open; const net = t.kept - t.gstInReceived; return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(null)}>
          <div className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 rounded-t-2xl bg-gradient-to-br from-navy to-slate-900 px-5 py-4 text-white">
              <div><p className="text-xs font-bold uppercase tracking-widest text-gold">Trip breakdown</p><h3 className="text-lg font-bold">{t.customer_name || 'Customer'} · {t.destination || '—'}</h3><p className="text-xs text-slate-300">{t.invoice_number} · {dateOnly(t.invoice_date)} · {t.quotation_number}{t.travel_from ? ` · travel ${dateOnly(t.travel_from)}` : ''}</p></div>
              <button type="button" onClick={() => setOpen(null)} aria-label="Close" className="rounded-lg p-1 text-slate-300 hover:bg-white/10"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 p-5 text-sm">
              {t.cancelled && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">This trip was cancelled{t.cancel_reason ? ` — ${t.cancel_reason}` : ''}.</p>}
              <table className="w-full border-collapse">
                <tbody>
                  <tr className="bg-slate-50"><td className="rounded-l-lg px-3 py-2 font-bold text-navy" colSpan={2}>Customer</td><td className="rounded-r-lg px-3 py-2 text-right font-bold tabular-nums text-navy">Amount</td></tr>
                  <tr><td className="px-3 py-1.5" colSpan={2}>Invoice total <span className="text-xs text-slate-500">({rupees(t.taxable)} + GST {rupees(t.gst)})</span></td><td className="px-3 py-1.5 text-right tabular-nums">{rupees(t.total)}</td></tr>
                  <tr><td className="px-3 py-1.5" colSpan={2}>Received from the customer</td><td className="px-3 py-1.5 text-right font-semibold tabular-nums text-emerald-700">{rupees(t.received)}</td></tr>
                  {t.refunded > 0 && <tr><td className="px-3 py-1.5" colSpan={2}>Refunded to the customer</td><td className="px-3 py-1.5 text-right tabular-nums text-amber-700">− {rupees(t.refunded)}</td></tr>}
                  <tr><td className="px-3 py-1.5" colSpan={2}>GST in what was received <span className="text-xs text-slate-500">(payable to the government)</span></td><td className="px-3 py-1.5 text-right tabular-nums text-slate-600">− {rupees(t.gstInReceived)}</td></tr>
                  {!t.cancelled && t.balance > 0 && <tr><td className="px-3 py-1.5 text-red-600" colSpan={2}>Still to collect from the customer</td><td className="px-3 py-1.5 text-right tabular-nums text-red-600">{rupees(t.balance)}</td></tr>}
                  <tr className="border-t border-slate-200"><td className="px-3 py-2 font-semibold" colSpan={2}>Our money from this trip so far</td><td className="px-3 py-2 text-right font-bold tabular-nums">{rupees(net)}</td></tr>

                  <tr className="bg-slate-50"><td className="rounded-l-lg px-3 py-2 font-bold text-navy">Vendors</td><td className="px-3 py-2 text-right text-xs font-bold text-slate-500">Agreed</td><td className="rounded-r-lg px-3 py-2 text-right text-xs font-bold text-slate-500">Paid</td></tr>
                  {t.vendorLines.length ? t.vendorLines.map((l, i) => (
                    <tr key={i}><td className="px-3 py-1.5"><span className="font-medium text-navy">{l.vendor}</span> <span className="text-xs text-slate-500">· {VENDOR_TABS.find((v) => v.key === l.category)?.label ?? 'Other'}{l.description ? ` · ${l.description}` : ''}</span>{l.outstanding > 0 && <span className="ml-1 text-xs text-red-600">({rupees(l.outstanding)} still to pay)</span>}{l.credit > 0 && <span className="ml-1 text-xs text-indigo-700">({rupees(l.credit)} held as credit)</span>}</td><td className="px-3 py-1.5 text-right tabular-nums">{rupees(l.agreed)}</td><td className="px-3 py-1.5 text-right tabular-nums text-sky-700">{rupees(l.paid)}</td></tr>
                  )) : <tr><td className="px-3 py-2 text-slate-500" colSpan={3}>No vendor marked for this trip yet. Add them on the quotation or the invoice.</td></tr>}
                  <tr className="border-t border-slate-200"><td className="px-3 py-2 font-semibold">Vendor cost in all</td><td className="px-3 py-2 text-right font-bold tabular-nums">{rupees(t.vendorAgreed)}</td><td className="px-3 py-2 text-right font-bold tabular-nums text-sky-700">{rupees(t.vendorPaid + t.vendorCreditUsed)}</td></tr>
                </tbody>
              </table>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-navy p-4 text-white"><p className="text-[11px] font-bold uppercase tracking-wider text-slate-300">{t.cancelled ? 'Left after cancellation' : 'Margin on this trip'}</p><p className={`mt-1 text-2xl font-extrabold tabular-nums ${t.margin >= 0 ? 'text-gold' : 'text-rose-300'}`}>{rupees(t.margin)}</p><p className="mt-1 text-[11px] text-slate-300">{t.cancelled ? 'Kept from the customer, less GST, less what vendors keep.' : `${rupees(t.taxable)} billed before tax − ${rupees(t.vendorAgreed)} vendor cost`}</p></div>
                <div className="rounded-xl border border-slate-200 p-4"><p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">In hand today</p><p className={`mt-1 text-2xl font-extrabold tabular-nums ${t.cashInHand >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{rupees(t.cashInHand)}</p><p className="mt-1 text-[11px] text-slate-500">{rupees(net)} received (after GST) − {rupees(t.vendorPaid)} paid to vendors</p></div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => router.push(`/finance/invoices/${t.invoice_id}`)}>Open invoice</Button>
                <Button variant="outline" onClick={() => router.push(`/quotations/${t.quotation_id}/edit`)}>Open quotation</Button>
                <Button variant="gold" onClick={() => setOpen(null)}>Close</Button>
              </div>
            </div>
          </div>
        </div>
      ); })()}
    </div>
  );
}
