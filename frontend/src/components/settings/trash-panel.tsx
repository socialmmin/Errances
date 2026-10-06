'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2 } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';

interface TrashItem { id: string; title: string | null; detail: string | null; deleted_at: string; days_left: number }
interface TrashData { keepDays: number; total: number; categories: { key: string; label: string; items: TrashItem[] }[] }

// Settings > Trash: everything deleted in the last 60 days, grouped by where it came from, with
// a Restore button on each row.
export function TrashPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, isError } = useQuery({ queryKey: ['trash'], queryFn: () => api.get<TrashData>('/settings/trash') });
  const [open, setOpen] = useState('');
  const [busy, setBusy] = useState('');
  const [search, setSearch] = useState('');
  const cats = data?.categories ?? [];
  const current = cats.find((c) => c.key === open) ?? cats.find((c) => c.items.length) ?? cats[0];
  const rows = (current?.items ?? []).filter((i) => !search || `${i.title ?? ''} ${i.detail ?? ''}`.toLowerCase().includes(search.toLowerCase()));

  async function restore(kind: string, item: TrashItem) {
    setBusy(item.id);
    try {
      await api.post(`/settings/trash/${kind}/${item.id}/restore`, {});
      toast(`${item.title || 'Item'} restored`, 'success');
      qc.invalidateQueries();
    } catch (e: any) { toast(e.message || 'Could not restore', 'error'); }
    finally { setBusy(''); }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-gradient-to-br from-navy to-slate-900 p-6 text-white shadow-xl">
        <div className="flex items-start gap-4">
          <span className="rounded-xl bg-white/10 p-3 text-gold"><Trash2 className="h-6 w-6" /></span>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gold">Trash</p>
            <h2 className="mt-1 text-2xl font-bold">{data?.total ?? 0} deleted item{data?.total === 1 ? '' : 's'}</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-300">Anything deleted in the CRM waits here for {data?.keepDays ?? 60} days. Press Restore to bring it back exactly where it was. After {data?.keepDays ?? 60} days it leaves the Trash for good.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {cats.map((c) => (
            <button key={c.key} type="button" onClick={() => { setOpen(c.key); setSearch(''); }} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${current?.key === c.key ? 'bg-gold text-navy' : 'bg-white/10 text-slate-200 hover:bg-white/20'}`}>
              {c.label}<span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${current?.key === c.key ? 'bg-navy/15' : c.items.length ? 'bg-red-500 text-white' : 'bg-white/10'}`}>{c.items.length}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
          <p className="font-bold text-navy">{current?.label ?? 'Trash'} <span className="font-normal text-slate-500">· {rows.length} shown</span></p>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search in this list…" className="h-8 w-56 rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-gold" />
        </div>
        <div className="theme-scroll max-h-[min(34rem,calc(100vh-13rem))] overflow-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead className="sticky top-0 bg-navy text-white"><tr>{['S.No', 'Item', 'Details', 'Deleted on', 'Time left', ''].map((h) => <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((i, n) => (
                <tr key={i.id} className={`border-t border-slate-100 ${n % 2 ? 'bg-slate-50/60' : ''}`}>
                  <td className="px-4 py-2.5 tabular-nums text-slate-500">{n + 1}</td>
                  <td className="px-4 py-2.5 font-semibold text-navy">{i.title || '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">{i.detail || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{new Date(i.deleted_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                  <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${i.days_left <= 7 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{i.days_left} day{i.days_left === 1 ? '' : 's'}</span></td>
                  <td className="px-4 py-2.5 text-right"><button type="button" disabled={busy === i.id} onClick={() => current && restore(current.key, i)} className="inline-flex items-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 text-xs font-bold text-navy hover:brightness-95 disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />{busy === i.id ? 'Restoring…' : 'Restore'}</button></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">{isLoading ? 'Loading…' : isError ? 'Could not load the Trash.' : 'Nothing here.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
