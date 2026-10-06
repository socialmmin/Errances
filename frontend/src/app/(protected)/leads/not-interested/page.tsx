'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ColumnDef } from '@tanstack/react-table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, MessageCircle, PencilLine, RefreshCw } from 'lucide-react';
import { ReasonDialog } from '@/components/leads/reason-dialog';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/shared/data-table';
import { DateRangeFilter } from '@/components/shared/date-range-filter';
import { api } from '@/lib/api-client';
import { leadStatusLabel } from '@/lib/lead-statuses';

interface ClosedLead { id: string; customer_name: string | null; phone: string | null; destination: string | null; status: string; lost_reason: string | null; campaign_name: string | null; assigned_name: string | null; closed_at: string | null; closed_by: string | null }
const ymd = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const split = (r?: string | null) => { const s = String(r ?? '').trim(); if (!s) return { main: 'Not specified', detail: '' }; const i = s.indexOf(' — '); return i > 0 ? { main: s.slice(0, i), detail: s.slice(i + 3) } : { main: s, detail: '' }; };

// Every lead closed as Not Interested or Lost, with the reason the employee typed -- so the
// reasons are collected in one place and the common ones stand out.
export default function NotInterestedPage() {
  const router = useRouter();
  const { data, isLoading, refetch, isFetching } = useQuery({ queryKey: ['leads', 'closed'], queryFn: () => api.get<{ data: ClosedLead[] }>('/leads/closed') });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [adding, setAdding] = useState<ClosedLead | null>(null);
  const [saving, setSaving] = useState(false);
  async function saveReason(lostReason: string) {
    if (!adding) return;
    setSaving(true);
    try { await api.patch(`/leads/${adding.id}`, { status: adding.status, lostReason }); toast('Reason saved', 'success'); setAdding(null); qc.invalidateQueries({ queryKey: ['leads'] }); }
    catch (e: any) { toast(e.message || 'Could not save the reason', 'error'); }
    finally { setSaving(false); }
  }
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('');
  const [employee, setEmployee] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const rows = data?.data ?? [];
  const reasons = useMemo(() => { const m = new Map<string, number>(); for (const r of rows) { const k = split(r.lost_reason).main; m.set(k, (m.get(k) ?? 0) + 1); } return Array.from(m.entries()).sort((a, b) => b[1] - a[1]); }, [rows]);
  const employees = useMemo(() => Array.from(new Set(rows.map((r) => r.assigned_name).filter(Boolean) as string[])).sort(), [rows]);
  const shown = rows.filter((r) => (!reason || split(r.lost_reason).main === reason) && (!status || r.status === status) && (!employee || r.assigned_name === employee)
    && (!from && !to ? true : !!r.closed_at && (!from || ymd(r.closed_at) >= from) && (!to || ymd(r.closed_at) <= to))
    && (!search || `${r.customer_name ?? ''} ${r.phone ?? ''} ${r.destination ?? ''} ${r.lost_reason ?? ''}`.toLowerCase().includes(search.toLowerCase())));
  const filtered = !!(search || reason || status || employee || from || to);
  const missing = rows.filter((r) => !String(r.lost_reason ?? '').trim()).length;
  const icon = 'grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white hover:border-gold';

  const columns: ColumnDef<ClosedLead>[] = [
    { id: 'sn', header: 'S.No', cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.index + 1}</span> },
    { id: 'when', header: 'Closed on', cell: ({ row }) => <span className="whitespace-nowrap text-xs">{when(row.original.closed_at)}</span> },
    { id: 'customer', header: 'Customer', cell: ({ row }) => <div><p className="font-semibold text-navy">{row.original.customer_name || '—'}</p><p className="text-[11px] tabular-nums text-muted-foreground">{row.original.phone || ''}</p></div> },
    { id: 'dest', header: 'Destination', cell: ({ row }) => <span className="text-sm">{row.original.destination || '—'}</span> },
    { id: 'status', header: 'Marked as', cell: ({ row }) => <span className="whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">{leadStatusLabel(row.original.status)}</span> },
    { id: 'main', header: 'Main reason', cell: ({ row }) => { const s = split(row.original.lost_reason); return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${s.main === 'Not specified' ? 'bg-slate-100 text-slate-500' : 'bg-amber-100 text-amber-800'}`}>{s.main}</span>; } },
    { id: 'detail', header: 'What the customer said', cell: ({ row }) => <p className="min-w-[16rem] max-w-md text-xs leading-snug text-slate-700">{split(row.original.lost_reason).detail || '—'}</p> },
    { id: 'emp', header: 'Employee', cell: ({ row }) => <div className="whitespace-nowrap text-xs"><p className="font-medium text-navy">{row.original.assigned_name || 'Unassigned'}</p>{row.original.closed_by && row.original.closed_by !== row.original.assigned_name && <p className="text-[11px] text-muted-foreground">marked by {row.original.closed_by}</p>}</div> },
    { id: 'actions', header: () => <span className="block text-right">Actions</span>, cell: ({ row }) => (
      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {!String(row.original.lost_reason ?? '').trim() && <button type="button" className="grid h-8 w-8 place-items-center rounded-lg bg-gold text-navy hover:brightness-95" title="Add the missing reason" aria-label="Add the missing reason" onClick={() => setAdding(row.original)}><PencilLine className="h-4 w-4" /></button>}
        <button type="button" className={`${icon} text-emerald-700`} title="Open the WhatsApp chat" aria-label="Open WhatsApp chat" onClick={() => router.push(`/whatsapp?lead=${row.original.id}`)}><MessageCircle className="h-4 w-4" /></button>
        <button type="button" className={`${icon} text-navy`} title="Open the lead" aria-label="Open lead" onClick={() => router.push(`/leads/${row.original.id}`)}><FileText className="h-4 w-4" /></button>
      </div>
    ) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => router.push('/leads')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-navy"><ArrowLeft className="h-4 w-4" /> Back to Leads</button>
        <button type="button" onClick={() => refetch()} className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-navy hover:border-gold"><RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />Refresh</button>
      </div>

      <section className="rounded-2xl bg-gradient-to-br from-navy to-slate-900 p-5 text-white shadow-xl">
        <p className="text-xs font-bold uppercase tracking-widest text-gold">Not interested</p>
        <h1 className="mt-1 text-2xl font-bold">{rows.length} leads closed — and why</h1>
        <p className="mt-0.5 text-sm text-slate-300">Every lead marked Not Interested or Lost, with the reason typed by the employee. Click a reason to see only those leads.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {reasons.map(([name, n]) => (
            <button key={name} type="button" aria-pressed={reason === name} onClick={() => setReason(reason === name ? '' : name)} className={`rounded-xl px-3 py-2 text-left transition ${reason === name ? 'bg-gold text-navy' : 'bg-white/5 hover:bg-white/10'}`}>
              <span className="block text-lg font-bold tabular-nums leading-none">{n}</span><span className={`text-[11px] font-semibold uppercase tracking-wide ${reason === name ? 'text-navy' : 'text-slate-400'}`}>{name}</span>
            </button>
          ))}
          {!rows.length && !isLoading && <span className="text-sm text-slate-300">No lead has been closed yet.</span>}
        </div>
        {missing > 0 && <p className="mt-3 rounded-xl bg-amber-400/15 px-3 py-2 text-xs text-amber-100">{missing} of these were closed before the reason became compulsory, so they show as “Not specified”. Use the gold pencil on a row to add its reason.</p>}
      </section>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <label className="min-w-[14rem] flex-1 space-y-1"><span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Search</span><Input placeholder="Customer, mobile, destination, reason…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <div className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Closed on</span><DateRangeFilter title="Select the closing date" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} /></div>
        <label className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Main reason</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="h-10 w-52 rounded-md border border-input bg-background px-3 text-sm"><option value="">All reasons</option>{reasons.map(([n]) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Marked as</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-44 rounded-md border border-input bg-background px-3 text-sm"><option value="">Both</option><option value="not_interested">Not Interested</option><option value="lost">Lost</option></select></label>
        {employees.length > 1 && <label className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Employee</span>
          <select value={employee} onChange={(e) => setEmployee(e.target.value)} className="h-10 w-48 rounded-md border border-input bg-background px-3 text-sm"><option value="">All employees</option>{employees.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
        {filtered && <Button variant="outline" onClick={() => { setSearch(''); setReason(''); setStatus(''); setEmployee(''); setFrom(''); setTo(''); }}>Clear</Button>}
      </div>

      {adding && <ReasonDialog adding leadName={adding.customer_name} status={adding.status} saving={saving} onCancel={() => setAdding(null)} onConfirm={saveReason} />}
      <DataTable columns={columns} data={shown} isLoading={isLoading} stickyLastColumn emptyMessage={rows.length ? 'No closed lead matches these filters.' : 'No lead has been marked Not Interested or Lost yet.'} onRowClick={(r) => router.push(`/leads/${r.id}`)} />
    </div>
  );
}
