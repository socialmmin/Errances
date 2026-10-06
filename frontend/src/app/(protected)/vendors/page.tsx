'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ColumnDef } from '@tanstack/react-table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, CarFront, Pencil, Plane, Tent, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/shared/data-table';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { PERMISSIONS } from '@/lib/permissions';
import { api } from '@/lib/api-client';
import { ADD_NAME, VENDOR_TABS, Vendor, VendorDialog, rupees } from '@/components/vendors/vendor-book';

const TAB_ICON: Record<string, typeof Users> = { hotel: BedDouble, transport: CarFront, activity: Tent, travel: Plane, other: Users };

// The vendor book: hotels, transport, activities, flight/train/bus and others, each on its own
// tab. Every vendor row shows the trips given to them and where the money stands; a row opens
// that vendor's full account.
export default function VendorsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const { data, isLoading, isError } = useQuery({ queryKey: ['vendor-book', 'vendors', 'all'], queryFn: () => api.get<{ data: Vendor[] }>('/vendor-book/vendors') });
  const all = data?.data ?? [];
  const [tab, setTab] = useState('hotel');
  const [search, setSearch] = useState('');
  const [destination, setDestination] = useState('');
  const [money, setMoney] = useState('');
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [adding, setAdding] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['vendor-book'] });

  const destinations = useMemo(() => Array.from(new Set(all.flatMap((v) => v.destinations ?? []).map((d) => d.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [all]);
  const totals = useMemo(() => all.reduce((t, v) => ({ trips: t.trips + (v.trips ?? 0), agreed: t.agreed + (v.agreed ?? 0), paid: t.paid + (v.paid ?? 0), outstanding: t.outstanding + (v.outstanding ?? 0), credit: t.credit + (v.credit ?? 0) }), { trips: 0, agreed: 0, paid: 0, outstanding: 0, credit: 0 }), [all]);
  const rows = all.filter((v) => v.category === tab
    && (!search || `${v.name} ${v.phone ?? ''} ${v.contact_person ?? ''} ${(v.destinations ?? []).join(' ')}`.toLowerCase().includes(search.toLowerCase()))
    && (!destination || !(v.destinations ?? []).length || v.destinations.some((d) => d.toLowerCase() === destination.toLowerCase()))
    && (!money || (money === 'outstanding' ? (v.outstanding ?? 0) > 0 : money === 'credit' ? (v.credit ?? 0) > 0 : (v.trips ?? 0) === 0)));

  async function remove(v: Vendor) {
    const ok = await confirm({ title: `Delete ${v.name}?`, description: (v.trips ?? 0) > 0 ? `This vendor is marked on ${v.trips} trip(s). The history stays; the vendor moves to Settings → Trash for 60 days.` : 'The vendor moves to Settings → Trash and can be restored for 60 days.', confirmLabel: 'Delete', variant: 'destructive' });
    if (!ok) return;
    try { await api.delete(`/vendor-book/vendors/${v.id}`); toast('Vendor deleted', 'success'); refresh(); } catch (e: any) { toast(e.message || 'Could not delete', 'error'); }
  }

  const icon = 'grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white hover:border-gold';
  const columns: ColumnDef<Vendor>[] = [
    { id: 'sn', header: 'S.No', cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.index + 1}</span> },
    { id: 'name', header: 'Vendor', cell: ({ row }) => <div><p className="font-semibold text-navy">{row.original.name}</p>{row.original.contact_person && <p className="text-[11px] text-muted-foreground">{row.original.contact_person}</p>}</div> },
    { id: 'phone', header: 'Mobile', cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.phone || '—'}</span> },
    { id: 'dest', header: 'Destinations', cell: ({ row }) => (row.original.destinations ?? []).length ? <div className="flex max-w-[16rem] flex-wrap gap-1">{row.original.destinations.map((d) => <span key={d} className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">{d}</span>)}</div> : <span className="text-xs text-muted-foreground">All destinations</span> },
    ...(tab === 'transport' ? [{ id: 'seats', header: 'Vehicles', cell: ({ row }: any) => (row.original.seaters ?? []).length ? <span className="whitespace-nowrap text-xs font-semibold text-slate-700">{row.original.seaters.join(', ')} seater</span> : <span className="text-xs text-muted-foreground">—</span> } as ColumnDef<Vendor>] : []),
    ...(tab === 'travel' ? [{ id: 'modes', header: 'Tickets', cell: ({ row }: any) => (row.original.travel_modes ?? []).length ? <span className="text-xs font-semibold capitalize text-slate-700">{row.original.travel_modes.join(' · ')}</span> : <span className="text-xs text-muted-foreground">—</span> } as ColumnDef<Vendor>] : []),
    { id: 'trips', header: 'Trips', cell: ({ row }) => <span className="tabular-nums">{row.original.trips ?? 0}</span> },
    { id: 'agreed', header: 'Agreed', cell: ({ row }) => <span className="tabular-nums">{rupees(row.original.agreed ?? 0)}</span> },
    { id: 'paid', header: 'Paid', cell: ({ row }) => <span className="tabular-nums text-emerald-700">{rupees(row.original.paid ?? 0)}</span> },
    { id: 'out', header: 'Still to pay', cell: ({ row }) => <span className={`tabular-nums ${(row.original.outstanding ?? 0) > 0 ? 'font-bold text-red-600' : 'text-slate-500'}`}>{rupees(row.original.outstanding ?? 0)}</span> },
    { id: 'credit', header: 'Credit with vendor', cell: ({ row }) => (row.original.credit ?? 0) > 0 ? <span className="whitespace-nowrap rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold tabular-nums text-indigo-800">{rupees(row.original.credit ?? 0)}</span> : <span className="text-xs text-muted-foreground">—</span> },
    { id: 'actions', header: () => <span className="block text-right">Actions</span>, cell: ({ row }) => (
      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <PermissionGuard permission={PERMISSIONS.VENDORS_EDIT}>
          <button type="button" className={`${icon} text-navy`} title="Edit vendor" aria-label="Edit vendor" onClick={() => setEditing(row.original)}><Pencil className="h-4 w-4" /></button>
          <button type="button" className={`${icon} text-red-600`} title="Delete vendor" aria-label="Delete vendor" onClick={() => remove(row.original)}><Trash2 className="h-4 w-4" /></button>
        </PermissionGuard>
      </div>
    ) },
  ];
  const tiles: [string, string, string][] = [['Vendors', String(all.length), 'text-white'], ['Trips given', String(totals.trips), 'text-white'], ['Agreed with vendors', rupees(totals.agreed), 'text-white'], ['Paid to vendors', rupees(totals.paid), 'text-emerald-300'], ['Still to pay', rupees(totals.outstanding), totals.outstanding ? 'text-rose-300' : 'text-slate-300'], ['Credit with vendors', rupees(totals.credit), totals.credit ? 'text-amber-300' : 'text-slate-300']];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-gradient-to-br from-navy to-slate-900 p-5 text-white shadow-xl">
        <p className="text-xs font-bold uppercase tracking-widest text-gold">Suppliers</p>
        <h1 className="mt-1 text-2xl font-bold">Vendors</h1>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {tiles.map(([label, value, cls]) => <div key={label} className="rounded-xl bg-white/5 p-3"><p className={`truncate text-lg font-bold tabular-nums ${cls}`}>{value}</p><p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-400">{label}</p></div>)}
        </div>
        <p className="mt-3 border-t border-white/10 pt-3 text-xs text-slate-300">Mark a vendor on a quotation to give them a trip. Money paid to a vendor for a trip that is later cancelled stays as credit with that vendor and can be used on the next trip.</p>
      </section>

      {/* The five kinds of vendor, as large buttons: the chosen one is filled, the rest are outlined. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {VENDOR_TABS.map((t) => { const n = all.filter((v) => v.category === t.key).length; const Icon = TAB_ICON[t.key] ?? Users; const on = tab === t.key; return (
          <button key={t.key} type="button" aria-pressed={on} onClick={() => setTab(t.key)} className={`flex items-center gap-3 rounded-xl border-2 p-3 text-left transition ${on ? 'border-navy bg-navy text-white shadow-lg' : 'border-slate-200 bg-white text-navy hover:border-gold hover:bg-gold/5'}`}>
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${on ? 'bg-gold text-navy' : 'bg-slate-100 text-slate-600'}`}><Icon className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{t.label}</span><span className={`block truncate text-[11px] ${on ? 'text-slate-300' : 'text-slate-500'}`}>{t.hint}</span></span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${on ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600'}`}>{n}</span>
          </button>
        ); })}
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <label className="min-w-[14rem] flex-1 space-y-1"><span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Search</span><Input placeholder="Vendor name, mobile, contact person, destination…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <label className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Destination</span>
          <select value={destination} onChange={(e) => setDestination(e.target.value)} className="h-10 w-48 rounded-md border border-input bg-background px-3 text-sm"><option value="">All destinations</option>{destinations.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
        <label className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Show</span>
          <select value={money} onChange={(e) => setMoney(e.target.value)} className="h-10 w-52 rounded-md border border-input bg-background px-3 text-sm"><option value="">All vendors</option><option value="outstanding">Payment still to make</option><option value="credit">Holding our credit</option><option value="unused">No trip given yet</option></select></label>
        {(search || destination || money) && <Button variant="outline" onClick={() => { setSearch(''); setDestination(''); setMoney(''); }}>Clear</Button>}
        <PermissionGuard permission={PERMISSIONS.VENDORS_CREATE}><Button variant="gold" className="ml-auto" onClick={() => setAdding(true)}>+ Add {ADD_NAME[tab] ?? 'vendor'}</Button></PermissionGuard>
      </div>
      {isError && <p className="text-sm text-red-500">Could not load the vendors.</p>}

      <DataTable columns={columns} data={rows} isLoading={isLoading} stickyLastColumn
        emptyMessage={all.some((v) => v.category === tab) ? 'No vendor matches these filters.' : `No ${VENDOR_TABS.find((t) => t.key === tab)?.label.toLowerCase()} added yet. Press the Add button above.`}
        onRowClick={(row) => router.push(`/vendors/${row.id}`)} />

      {(adding || editing) && <VendorDialog vendor={editing} category={tab} onClose={() => { setAdding(false); setEditing(null); }} onSaved={() => { setAdding(false); setEditing(null); refresh(); }} />}
    </div>
  );
}
