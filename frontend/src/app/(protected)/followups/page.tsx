'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, Clock, Phone, Search, X } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { FollowUp, useAllFollowUps, useUpdateFollowUp } from '@/hooks/use-follow-ups';
import { tr, locale } from '@/i18n';

const PRESETS = ['Positive — customer interested', 'Busy / driving — will call back', 'Not interested'];

// Default "next follow-up" time: 3 days from now, at 11am — a starting point the person can adjust.
function defaultNextFollowUp() {
  const d = new Date(); d.setDate(d.getDate() + 3); d.setHours(11, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// What was said (saved to the lead's Notes) and whether another meeting/call needs scheduling —
// each lead only ever has one open follow-up, so scheduling here replaces it.
function OutcomeForm({ onSave, saving, placeholder }: { onSave: (note: string, nextFollowUpAt?: string) => void; saving: boolean; placeholder: string }) {
  const [note, setNote] = useState('');
  const [schedule, setSchedule] = useState(false);
  const [when, setWhen] = useState(defaultNextFollowUp);

  return (
    <div className="w-full space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-white/5">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => <button key={p} type="button" onClick={() => setNote(p)} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${note === p ? 'bg-navy text-white' : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-navy-800 dark:text-slate-300'}`}>{p}</button>)}
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholder} rows={2} className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
      <label className="flex items-center gap-2 text-xs font-medium text-foreground"><input type="checkbox" checked={schedule} onChange={(e) => setSchedule(e.target.checked)} className="h-3.5 w-3.5 accent-gold" />{tr("Schedule another follow-up")}</label>
      {schedule && <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="h-9 w-full max-w-64 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-gold" />}
      <button type="button" disabled={saving} onClick={() => onSave(note.trim(), schedule ? when : undefined)} className="rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? tr("Saving…") : tr("Save")}</button>
    </div>
  );
}

type Filter = 'overdue' | 'today' | 'upcoming' | 'done' | 'cancelled' | 'all';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

// Every follow-up created from any lead's own page shows up here too -- one place to see what's
// due across the whole team. Inbound callback requests live on their own page now, separate from
// this outbound schedule.
export default function FollowUpsPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const { data, isLoading } = useAllFollowUps({ status: filter === 'all' ? undefined : filter, search: search || undefined });
  const update = useUpdateFollowUp();
  const { toast } = useToast();
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);

  const items = data?.data ?? [];
  const counts = useMemo(() => {
    const now = Date.now();
    return {
      overdue: items.filter((f) => f.status === 'pending' && new Date(f.due_at).getTime() < now).length,
      today: items.filter((f) => f.status === 'pending' && new Date(f.due_at).toDateString() === new Date().toDateString()).length,
    };
  }, [items]);

  async function complete(item: FollowUp, outcome: string, nextFollowUpAt?: string) {
    try {
      await update.mutateAsync({ id: item.id, status: 'done', outcome, nextFollowUpAt });
      setOutcomeFor(null);
      toast(nextFollowUpAt ? tr("Marked complete — next follow-up scheduled") : tr("Marked complete"), 'success');
    } catch (error: any) { toast(error.message || tr("Could not update"), 'error'); }
  }
  async function cancel(item: FollowUp) {
    try { await update.mutateAsync({ id: item.id, status: 'cancelled' }); toast(tr("Cancelled"), 'success'); }
    catch (error: any) { toast(error.message || tr("Could not cancel"), 'error'); }
  }

  return (
    <div className="space-y-5 pb-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[.2em] text-gold">{tr("Stay on top of every lead")}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-navy dark:text-white">{tr("Follow-ups")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{tr("Created from any lead's own page — this list is the same data, just seen all together. Each lead has one open follow-up at a time.")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f.value} onClick={() => setFilter(f.value)} className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${filter === f.value ? 'border-navy bg-navy text-white' : 'border-border bg-card text-foreground hover:border-gold'}`}>
            {tr(f.label)}{f.value === 'overdue' && counts.overdue > 0 ? ` (${counts.overdue})` : ''}{f.value === 'today' && counts.today > 0 ? ` (${counts.today})` : ''}
          </button>
        ))}
        <div className="relative ml-auto min-w-[14rem]"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr("Search customer or phone…")} className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-gold" /></div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {isLoading && <p className="p-6 text-sm text-muted-foreground">{tr("Loading…")}</p>}
        {!isLoading && !items.length && <p className="p-10 text-center text-sm text-muted-foreground">{tr("Nothing here.")}</p>}
        {items.map((item) => {
          const overdue = item.status === 'pending' && new Date(item.due_at).getTime() < Date.now();
          return (
            <div key={item.id} className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4 last:border-0 hover:bg-gold/5">
              <div className="min-w-0 flex-1">
                <Link href={`/leads/${item.lead_id}?tab=followup`} className="font-semibold text-navy hover:underline dark:text-white">{item.customer_name || tr("Lead")}</Link>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {item.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{item.phone}</span>}
                  {item.destination && <span>{item.destination}</span>}
                  {item.assigned_to_name && <span>{tr("Assigned:")}{' '}{item.assigned_to_name}</span>}
                </p>
                {item.note && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{item.note}</p>}
                {item.outcome && <p className="mt-1 text-xs font-medium text-emerald-700">{tr(item.outcome)}</p>}
              </div>
              <div className={`flex items-center gap-1.5 text-sm font-semibold ${overdue ? 'text-red-600' : 'text-navy dark:text-white'}`}><Clock className="h-4 w-4" />{new Date(item.due_at).toLocaleString(locale())}</div>
              {item.status === 'pending' && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" onClick={() => setOutcomeFor(outcomeFor === item.id ? null : item.id)} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"><Check className="h-3.5 w-3.5" />{tr("Complete")}</button>
                  <button type="button" onClick={() => cancel(item)} className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"><X className="h-3.5 w-3.5" />{tr("Cancel")}</button>
                </div>
              )}
              {item.status !== 'pending' && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.status === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{tr(item.status)}</span>}
              {outcomeFor === item.id && (
                <OutcomeForm saving={update.isPending} placeholder={tr("What did they say? (saved to the lead's Notes)")} onSave={(note, nextFollowUpAt) => complete(item, note || 'Follow-up completed', nextFollowUpAt)} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
