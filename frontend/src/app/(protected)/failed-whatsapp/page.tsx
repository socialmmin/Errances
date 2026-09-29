'use client';

import { formatPhone } from '@/lib/utils';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Copy, ExternalLink, PhoneOff, Search, ShieldAlert, Undo2 } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { FailedItinerary, useFailedItineraries, useMarkManualSent } from '@/hooks/use-whatsapp';
import { tr, locale } from '@/i18n';

type View = 'todo' | 'done' | 'all';

const REASON: Record<string, { label: string; chip: string }> = {
  meta: { label: 'Meta blocked', chip: 'bg-amber-100 text-amber-800' },
  customer: { label: 'Not on WhatsApp', chip: 'bg-red-100 text-red-700' },
  us: { label: 'Our side', chip: 'bg-blue-100 text-blue-700' },
  unknown: { label: 'Unclear', chip: 'bg-slate-100 text-slate-600' },
};

function Stat({ label, value, hint, tone, onClick, active }: { label: string; value: number; hint: string; tone: string; onClick?: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-xl border p-4 text-left transition ${active ? 'border-gold bg-white/15' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
      <p className={`text-3xl font-bold ${tone}`}>{value}</p>
      <p className="mt-1 text-sm font-semibold text-white">{tr(label)}</p>
      <p className="text-xs text-slate-300">{tr(hint)}</p>
    </button>
  );
}

export default function FailedWhatsAppPage() {
  const { data, isLoading } = useFailedItineraries();
  const mark = useMarkManualSent();
  const { toast } = useToast();
  const [view, setView] = useState<View>('all');
  const [search, setSearch] = useState('');
  const [destination, setDestination] = useState('all');
  const [reason, setReason] = useState('all');
  // Rows just marked done keep a visible Undo for a few seconds; after that the row is settled as Sent
  // and Undo only appears when you hover it (so a done list is not full of Undo buttons).
  const [recent, setRecent] = useState<Record<string, true>>({});
  const keyOf = (i: { packageId: string; leadId: string }) => i.packageId + i.leadId;
  function markDone(item: FailedItinerary) {
    mark.mutate({ leadId: item.leadId, packageId: item.packageId }, { onSuccess: () => {
      const k = keyOf(item);
      setRecent((r) => ({ ...r, [k]: true }));
      setTimeout(() => setRecent((r) => { const n = { ...r }; delete n[k]; return n; }), 8000);
      toast(tr("{customerName} marked as sent", { customerName: item.customerName }), 'success');
    } });
  }

  // "Not sent yet" leads send by themselves, so they are not manual work.
  const all = useMemo(() => (data?.data ?? []).filter((i) => (i.fault as string) !== 'queued'), [data]);
  const todo = all.filter((i) => !i.manualAt);
  const done = all.filter((i) => i.manualAt);
  const notOnWa = todo.filter((i) => i.fault === 'customer').length;
  const metaBlocked = todo.filter((i) => i.fault === 'meta').length;
  const pct = all.length ? Math.round((done.length / all.length) * 100) : 0;
  const destinations = useMemo(() => Array.from(new Set(all.map((i) => i.destination || 'Unknown'))).sort(), [all]);

  const rows = all
    .filter((i) => (view === 'todo' ? !i.manualAt : view === 'done' ? !!i.manualAt : true))
    .filter((i) => destination === 'all' || (i.destination || 'Unknown') === destination)
    .filter((i) => reason === 'all' || i.fault === reason)
    .filter((i) => {
      const q = search.trim().toLowerCase();
      return !q || i.customerName.toLowerCase().includes(q) || (i.phone || '').includes(q);
    })
    .sort((a, b) => (a.destination || '').localeCompare(b.destination || '') || +new Date(b.failedAt) - +new Date(a.failedAt));

  async function copyLink(item: FailedItinerary) {
    try {
      const { url } = await api.get<{ url: string }>(`/integrations/whatsapp/packages/${item.packageId}/document-url`);
      await navigator.clipboard.writeText(url);
      toast(tr("Itinerary link copied — paste it in WhatsApp Web"), 'success');
    } catch { toast(tr("Could not get the itinerary link"), 'error'); }
  }

  const selectClass = 'h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-gold';

  return (
    <div className="space-y-5 pb-8">
      {/* Hero: the whole job at a glance */}
      <section className="overflow-hidden rounded-2xl bg-gradient-to-r from-navy via-navy-900 to-navy-800 p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.2em] text-gold">{tr("Send by hand, tick off here")}</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">{tr("Failed WhatsApp")}</h1>
            <p className="mt-1 max-w-xl text-sm text-slate-300">{tr("These customers did not get their itinerary automatically. Open WhatsApp Web, share the destination’s itinerary, then mark it done.")}</p>
          </div>
          <div className="text-right"><p className="text-4xl font-bold text-gold">{pct}%</p><p className="text-xs text-slate-300">{tr("done manually")}</p></div>
        </div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} /></div>
        <p className="mt-1.5 text-xs text-slate-300">{done.length}{' '}{tr("of")}{' '}{all.length}{' '}{tr("handled ·")}{' '}{todo.length}{' '}{tr("still to do")}</p>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={tr("Still to send")} value={todo.length} hint={tr("Waiting for you")} tone="text-amber-300" active={view === 'todo'} onClick={() => { setView('todo'); setReason('all'); }} />
          <Stat label={tr("Sent manually")} value={done.length} hint={tr("Marked done")} tone="text-emerald-400" active={view === 'done'} onClick={() => { setView('done'); setReason('all'); }} />
          <Stat label={tr("Not on WhatsApp")} value={notOnWa} hint={tr("Call these instead")} tone="text-red-300" onClick={() => { setView('todo'); setReason('customer'); }} />
          <Stat label={tr("Meta blocked")} value={metaBlocked} hint={tr("Safe to send by hand")} tone="text-sky-300" onClick={() => { setView('todo'); setReason('meta'); }} />
        </div>
      </section>

      {/* Filters */}
      <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
        <div className="flex overflow-hidden rounded-lg border border-border text-sm font-semibold">
          {([['all', tr("All ({count})", { count: all.length })], ['todo', tr("To do ({count})", { count: todo.length })], ['done', tr("Done ({count})", { count: done.length })]] as [View, string][]).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setView(v)} className={`px-3.5 py-2 ${view === v ? 'bg-navy text-white' : 'text-muted-foreground hover:bg-muted'}`}>{tr(label)}</button>
          ))}
        </div>
        <select value={destination} onChange={(e) => setDestination(e.target.value)} className={selectClass}>
          <option value="all">{tr("All destinations")}</option>
          {destinations.map((d) => <option key={d} value={d}>{tr(d)} ({all.filter((i) => (i.destination || 'Unknown') === d && (view === 'all' || (view === 'done') === !!i.manualAt)).length})</option>)}
        </select>
        <select value={reason} onChange={(e) => setReason(e.target.value)} className={selectClass}>
          <option value="all">{tr("All reasons")}</option>
          {Object.entries(REASON).map(([k, v]) => <option key={k} value={k}>{tr(v.label)}</option>)}
        </select>
        <div className="relative ml-auto min-w-[13rem] flex-1 sm:max-w-xs"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr("Search name or number…")} className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-gold" /></div>
      </section>

      {/* List */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-gold text-xs uppercase tracking-wide text-white">
              <tr><th className="w-12 px-4 py-3">#</th><th className="px-4 py-3">{tr("Customer")}</th><th className="px-4 py-3">{tr("Send this")}</th><th className="px-4 py-3">{tr("Why it failed")}</th><th className="sticky right-0 bg-navy px-4 py-3 text-right shadow-[-8px_0_8px_-6px_rgba(0,0,0,.35)]">{tr("Action")}</th></tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={5} className="p-10 text-center text-muted-foreground">{tr("Loading…")}</td></tr>}
              {!isLoading && !rows.length && <tr><td colSpan={5} className="p-12 text-center text-muted-foreground"><CheckCircle2 className="mx-auto mb-2 h-9 w-9 text-emerald-500" />{view === 'todo' ? tr("Nothing left to send. All caught up.") : tr("Nothing matches these filters.")}</td></tr>}
              {rows.map((item, index) => {
                const r = REASON[item.fault] || REASON.unknown;
                const digits = (item.phone || '').replace(/\D/g, '');
                return (
                  <tr key={item.packageId + item.leadId} className={`group border-b border-border last:border-0 hover:bg-gold/5 ${item.manualAt ? 'bg-emerald-50/40' : ''}`}>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{index + 1}</td>
                    <td className="px-4 py-3"><Link href={`/leads/${item.leadId}`} className="font-semibold text-navy hover:underline dark:text-white">{item.customerName}</Link><p className="text-xs text-muted-foreground">{formatPhone(item.phone) || tr("No phone")}</p></td>
                    <td className="px-4 py-3"><span className="inline-block rounded-md bg-gold px-2.5 py-1 text-xs font-bold text-navy">{item.destination || tr("Unknown")}</span><p className="mt-1 max-w-[14rem] truncate text-xs text-muted-foreground" title={item.packageName}>{item.packageName}</p></td>
                    <td className="px-4 py-3"><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${r.chip}`}>{item.fault === 'customer' ? <PhoneOff className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}{tr(r.label)}</span><p className="mt-1 line-clamp-2 max-w-[22rem] text-xs text-muted-foreground" title={tr(item.reason)}>{tr(item.reason)}</p></td>
                    <td className="sticky right-0 bg-card px-4 py-3 shadow-[-8px_0_8px_-6px_rgba(0,0,0,.12)]">
                      {item.manualAt ? (
                        <div className="flex items-center justify-end gap-3"><span className="text-right text-xs font-semibold text-emerald-700"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />{tr("Sent")}{item.manualBy ? ` by ${item.manualBy}` : ''}<br /><span className="font-normal text-muted-foreground">{new Date(item.manualAt).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></span><button type="button" title={tr("Marked by mistake? Put it back in To do")} onClick={() => mark.mutate({ leadId: item.leadId, packageId: item.packageId, undo: true }, { onSuccess: () => { setRecent((r) => { const n = { ...r }; delete n[keyOf(item)]; return n; }); toast(tr("{customerName} moved back to To do", { customerName: item.customerName }), 'success'); } })} className={`inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 px-2.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 ${recent[keyOf(item)] ? '' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100'}`}><Undo2 className="h-3.5 w-3.5" />{tr("Undo")}</button></div>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          {digits && <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" title={tr("Open WhatsApp Web")} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"><ExternalLink className="h-3.5 w-3.5" />{tr("WhatsApp Web")}</a>}
                          <button type="button" title={tr("Copy the itinerary PDF link to paste in WhatsApp Web")} onClick={() => copyLink(item)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-slate-700 hover:bg-muted"><Copy className="h-3.5 w-3.5" />{tr("Itinerary link")}</button>
                          <button type="button" disabled={mark.isPending} onClick={() => markDone(item)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-navy px-3 text-xs font-semibold text-white hover:bg-navy/90"><CheckCircle2 className="h-3.5 w-3.5" />{tr("Mark done")}</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border bg-muted/30 px-5 py-2.5 text-xs text-muted-foreground">{tr("Showing")}{' '}{rows.length}{' '}{tr("of")}{' '}{all.length}</div>
      </section>
    </div>
  );
}
