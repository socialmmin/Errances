'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, CalendarClock, ChevronLeft, ChevronRight, Clock, LayoutList, MessageCircle, Phone, Search, CalendarDays, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { useMyAccess } from '@/hooks/use-access';
import { FollowUp, useAllFollowUps, useFollowUpStats, useUpdateFollowUp } from '@/hooks/use-follow-ups';
import { CompleteFollowUpModal } from '@/components/follow-ups/complete-follow-up-modal';
import { ScheduleFollowUpModal } from '@/components/follow-ups/schedule-follow-up-modal';

const TYPE_LABEL: Record<string, string> = { call: 'Call', whatsapp: 'WhatsApp', site_visit: 'Site Visit', package: 'Package', payment: 'Payment', documents: 'Documents', general: 'General' };
const TYPE_CLS: Record<string, string> = { call: 'bg-sky-100 text-sky-700', whatsapp: 'bg-emerald-100 text-emerald-700', site_visit: 'bg-violet-100 text-violet-700', package: 'bg-amber-100 text-amber-700', payment: 'bg-rose-100 text-rose-700', documents: 'bg-slate-200 text-slate-700', general: 'bg-slate-100 text-slate-600' };
const PRIORITY_CLS: Record<string, string> = { high: 'bg-red-100 text-red-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-emerald-100 text-emerald-700' };
const PRIORITY_BORDER: Record<string, string> = { high: 'border-l-red-500', medium: 'border-l-amber-500', low: 'border-l-emerald-500' };

function dateKey(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
// Monday-start week containing `d`.
const mondayOf = (d: Date) => { const day = d.getDay(); return addDays(startOfDay(d), day === 0 ? -6 : 1 - day); };
// Six Monday-start weeks covering the month of `d` (a fixed-height month grid).
function monthGrid(d: Date): Date[] {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const start = mondayOf(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function dueLabel(f: FollowUp) {
  const due = new Date(f.due_at);
  const time = due.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  if (f.status !== 'pending') return due.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const days = Math.round((startOfDay(due).getTime() - startOfDay(new Date()).getTime()) / 86400000);
  if (due.getTime() < Date.now()) return days === 0 ? `Overdue · today ${time}` : `Overdue · ${-days}d ago`;
  if (days === 0) return `Today · ${time}`;
  if (days === 1) return `Tomorrow · ${time}`;
  return due.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

type Filter = 'all' | 'today' | 'overdue' | 'upcoming' | 'done' | 'cancelled';

// Every follow-up created from any lead's own page shows up here too -- one place to see what's
// due across the team (a salesperson only sees their own leads'). Inbound callback requests live
// on their own page.
export default function FollowUpsPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [calMode, setCalMode] = useState<'week' | 'month'>('week');
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [selectedDate, setSelectedDate] = useState<string>(dateKey(new Date()));
  const [type, setType] = useState('');
  const [priority, setPriority] = useState('');
  const [exec, setExec] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { isSuperAdmin } = useMyAccess();
  const { data, isLoading } = useAllFollowUps({ status: filter === 'all' ? undefined : filter, search: search || undefined });
  const { data: stats } = useFollowUpStats();
  const update = useUpdateFollowUp();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<FollowUp | null>(null);
  const [scheduling, setScheduling] = useState(false);

  const fetched = data?.data ?? [];
  const executives = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of fetched) if (f.assigned_to) map.set(f.assigned_to, f.assigned_to_name || 'Unknown');
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [fetched]);

  // Type / priority / executive apply to both views; the date range only to the list.
  const filtered = useMemo(() => fetched.filter((f) =>
    (!type || f.follow_up_type === type)
    && (!priority || f.priority === priority)
    && (!exec || (exec === 'unassigned' ? !f.assigned_to : f.assigned_to === exec))), [fetched, type, priority, exec]);
  const listItems = useMemo(() => filtered.filter((f) => {
    const k = dateKey(new Date(f.due_at));
    return (!from || k >= from) && (!to || k <= to);
  }), [filtered, from, to]);

  const dayStats = useMemo(() => {
    const map: Record<string, { overdue: number; pending: number; done: number }> = {};
    const now = Date.now();
    for (const f of filtered) {
      const k = dateKey(new Date(f.due_at));
      const s = (map[k] ??= { overdue: 0, pending: 0, done: 0 });
      if (f.status === 'done') s.done++;
      else if (f.status === 'pending') (new Date(f.due_at).getTime() < now ? s.overdue++ : s.pending++);
    }
    return map;
  }, [filtered]);
  const dayItems = filtered.filter((f) => dateKey(new Date(f.due_at)) === selectedDate);
  const items = view === 'calendar' ? dayItems : listItems;

  const days = calMode === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(mondayOf(anchor), i)) : monthGrid(anchor);
  const step = (dir: 1 | -1) => setAnchor((a) => calMode === 'week' ? addDays(a, 7 * dir) : new Date(a.getFullYear(), a.getMonth() + dir, 1));
  const goToday = () => { const t = startOfDay(new Date()); setAnchor(t); setSelectedDate(dateKey(t)); };
  const periodTitle = calMode === 'week'
    ? `${days[0].toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : anchor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  async function complete(item: FollowUp, outcome: string, nextFollowUpAt?: string) {
    try {
      await update.mutateAsync({ id: item.id, status: 'done', outcome, nextFollowUpAt });
      setOutcomeFor(null);
      toast(nextFollowUpAt ? 'Marked complete — next follow-up scheduled' : 'Marked complete', 'success');
    } catch (error: any) { toast(error.message || 'Could not update', 'error'); }
  }
  async function cancel(item: FollowUp) {
    try { await update.mutateAsync({ id: item.id, status: 'cancelled' }); toast('Cancelled', 'success'); }
    catch (error: any) { toast(error.message || 'Could not cancel', 'error'); }
  }
  async function reschedule(item: FollowUp, input: { dueAt: string; note?: string; followUpType: string; priority: string }) {
    setScheduling(true);
    try {
      await api.post(`/leads/${item.lead_id}/follow-ups`, input);
      qc.invalidateQueries({ queryKey: ['follow-ups'] });
      setScheduleFor(null);
      toast('Follow-up scheduled', 'success');
    } catch (error: any) { toast(error.message || 'Could not schedule', 'error'); }
    finally { setScheduling(false); }
  }

  const CHIPS: { value: Filter; label: string; count?: number; hero: string }[] = [
    { value: 'all', label: 'All', count: stats?.total, hero: 'text-white' },
    { value: 'today', label: 'Due today', count: stats?.today, hero: 'text-sky-300' },
    { value: 'overdue', label: 'Overdue', count: stats?.overdue, hero: 'text-rose-300' },
    { value: 'upcoming', label: 'Upcoming', count: stats?.upcoming, hero: 'text-amber-300' },
    { value: 'done', label: 'Completed', count: stats?.done, hero: 'text-emerald-300' },
    { value: 'cancelled', label: 'Cancelled', count: stats?.cancelled, hero: 'text-slate-300' },
  ];
  const selectCls = 'h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-gold';
  const anyFilter = type || priority || exec || from || to;

  return (
    <div className="space-y-5 pb-8">
      {/* Hero board: the counts, each one also a filter. */}
      <section className="rounded-2xl bg-gradient-to-br from-navy to-slate-900 p-5 text-white shadow-xl">
        <p className="text-xs font-bold uppercase tracking-widest text-gold">Stay on top of every lead</p>
        <h1 className="mt-1 text-2xl font-bold">Follow-ups</h1>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {CHIPS.map((c) => (
            <button key={c.value} type="button" onClick={() => setFilter(c.value)}
              className={`rounded-xl p-3 text-left transition ${filter === c.value ? 'bg-gold/25 ring-1 ring-gold' : 'bg-white/5 hover:bg-white/10'}`}>
              <p className={`text-xl font-bold tabular-nums ${c.hero}`}>{c.count ?? '…'}</p>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{c.label}</p>
            </button>
          ))}
        </div>
        <p className="mt-3 border-t border-white/10 pt-3 text-xs text-slate-300">Created from any lead's own page — the same data, seen all together. Each lead has one open follow-up at a time. When a follow-up's time arrives, a pop-up tells you who to call.</p>
      </section>

      {/* View + filters */}
      <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
        <div className="flex overflow-hidden rounded-xl border border-border">
          <button type="button" onClick={() => setView('list')} className={`flex items-center gap-1.5 px-3 py-2 text-sm font-semibold ${view === 'list' ? 'bg-navy text-white' : 'bg-card text-foreground hover:bg-muted'}`}><LayoutList className="h-4 w-4" />List</button>
          <button type="button" onClick={() => setView('calendar')} className={`flex items-center gap-1.5 px-3 py-2 text-sm font-semibold ${view === 'calendar' ? 'bg-navy text-white' : 'bg-card text-foreground hover:bg-muted'}`}><CalendarDays className="h-4 w-4" />Calendar</button>
        </div>
        <select aria-label="Status" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className={`${selectCls} font-semibold`}>
          {CHIPS.map((c) => <option key={c.value} value={c.value}>{c.value === 'all' ? 'All statuses' : c.label}{c.count != null ? ` (${c.count})` : ''}</option>)}
        </select>
        <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className={selectCls}>
          <option value="">All types</option>
          {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={selectCls}>
          <option value="">All priorities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        {isSuperAdmin && (
          <select aria-label="Executive" value={exec} onChange={(e) => setExec(e.target.value)} className={selectCls}>
            <option value="">All executives</option><option value="unassigned">Unassigned</option>
            {executives.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
        {view === 'list' && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={selectCls} />
            To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={selectCls} />
          </span>
        )}
        {anyFilter && <button type="button" onClick={() => { setType(''); setPriority(''); setExec(''); setFrom(''); setTo(''); }} className="text-xs font-semibold text-gold hover:underline">Clear filters</button>}
        <div className="relative ml-auto min-w-[14rem]"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer or phone…" className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-gold" /></div>
      </section>

      {view === 'calendar' && (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => step(-1)} className="grid h-9 w-9 place-items-center rounded-lg border border-border hover:bg-muted" aria-label="Previous"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => step(1)} className="grid h-9 w-9 place-items-center rounded-lg border border-border hover:bg-muted" aria-label="Next"><ChevronRight className="h-4 w-4" /></button>
            <button type="button" onClick={goToday} className="h-9 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted">Today</button>
            <h2 className="ml-1 text-base font-bold text-navy dark:text-white">{periodTitle}</h2>
            <div className="ml-auto flex overflow-hidden rounded-lg border border-border text-xs font-semibold">
              {(['week', 'month'] as const).map((m) => <button key={m} type="button" onClick={() => setCalMode(m)} className={`px-3 py-2 capitalize ${calMode === m ? 'bg-navy text-white' : 'hover:bg-muted'}`}>{m}</button>)}
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {days.map((d) => {
              const key = dateKey(d);
              const s = dayStats[key];
              const isToday = key === dateKey(new Date());
              const isSelected = key === selectedDate;
              const outside = calMode === 'month' && d.getMonth() !== anchor.getMonth();
              return (
                <button key={key} type="button" onClick={() => setSelectedDate(key)}
                  className={`flex flex-col items-center rounded-xl border p-2 transition ${calMode === 'week' ? 'min-h-[5.5rem]' : 'min-h-[4.5rem]'} ${isSelected ? 'border-navy bg-navy text-white shadow-md' : isToday ? 'border-gold bg-gold/10 text-navy' : 'border-border bg-card hover:border-gold'} ${outside && !isSelected ? 'opacity-40' : ''}`}>
                  <span className="text-lg font-bold leading-tight">{d.getDate()}</span>
                  <span className="mt-1 flex flex-wrap justify-center gap-1">
                    {s?.overdue ? <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white" title="Overdue">{s.overdue}</span> : null}
                    {s?.pending ? <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-navy" title="Pending">{s.pending}</span> : null}
                    {s?.done ? <span className="rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-white" title="Completed">{s.done}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-red-500" />Overdue</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" />Pending</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Completed</span>
          </p>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-bold text-navy dark:text-white">
            {view === 'calendar' ? new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) : CHIPS.find((c) => c.value === filter)?.label}
          </h2>
          <span className="text-xs text-muted-foreground">{items.length} follow-up{items.length === 1 ? '' : 's'}</span>
        </div>
        {isLoading && <p className="p-6 text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && !items.length && <p className="p-10 text-center text-sm text-muted-foreground">Nothing here.</p>}
        {items.map((item) => {
          const overdue = item.status === 'pending' && new Date(item.due_at).getTime() < Date.now();
          const phone = item.phone || item.whatsapp_number;
          return (
            <div key={item.id} className={`flex flex-wrap items-center gap-3 border-b border-l-4 border-border px-5 py-4 last:border-b-0 hover:bg-gold/5 ${PRIORITY_BORDER[item.priority ?? ''] || 'border-l-transparent'}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/leads/${item.lead_id}?tab=followup`} className="font-semibold text-navy hover:underline dark:text-white">{item.customer_name || 'Lead'}</Link>
                  {item.follow_up_type && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${TYPE_CLS[item.follow_up_type] || 'bg-slate-100 text-slate-600'}`}>{TYPE_LABEL[item.follow_up_type] || item.follow_up_type}</span>}
                  {item.priority && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${PRIORITY_CLS[item.priority] || ''}`}>{item.priority}</span>}
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {item.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{item.phone}</span>}
                  {item.destination && <span>{item.destination}</span>}
                  <span>{item.assigned_to_name ? `Assigned: ${item.assigned_to_name}` : 'Unassigned'}</span>
                </p>
                {item.note && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{item.note}</p>}
                {item.outcome && <p className="mt-1 text-xs font-medium text-emerald-700">Outcome: {item.outcome}</p>}
              </div>
              <div className={`flex items-center gap-1.5 text-sm font-semibold ${overdue ? 'text-red-600' : 'text-navy dark:text-white'}`}><Clock className="h-4 w-4" />{dueLabel(item)}</div>
              <div className="flex flex-wrap items-center gap-1.5">
                {phone && <a href={`tel:${phone}`} className="grid h-8 w-8 place-items-center rounded-lg border border-input text-sky-600 hover:bg-sky-50" title={`Call ${phone}`} aria-label="Call"><Phone className="h-3.5 w-3.5" /></a>}
                <Link href={`/whatsapp?lead=${item.lead_id}`} className="grid h-8 w-8 place-items-center rounded-lg border border-input text-emerald-600 hover:bg-emerald-50" title="Open WhatsApp chat" aria-label="WhatsApp"><MessageCircle className="h-3.5 w-3.5" /></Link>
                {item.status === 'pending' ? (
                  <>
                    <button type="button" onClick={() => setOutcomeFor(item.id)} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"><Check className="h-3.5 w-3.5" />Complete</button>
                    <button type="button" onClick={() => setScheduleFor(item)} className="flex items-center gap-1 rounded-lg border border-input px-2.5 py-1.5 text-xs font-semibold text-navy hover:bg-muted dark:text-white"><CalendarClock className="h-3.5 w-3.5" />Reschedule</button>
                    <button type="button" onClick={() => cancel(item)} className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"><X className="h-3.5 w-3.5" />Cancel</button>
                  </>
                ) : <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.status === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{item.status === 'done' ? 'Completed' : 'Cancelled'}</span>}
              </div>
            </div>
          );
        })}
      </section>

      {outcomeFor && (() => {
        const item = fetched.find((f) => f.id === outcomeFor);
        if (!item) return null;
        return (
          <CompleteFollowUpModal
            leadId={item.lead_id}
            customerName={item.customer_name || 'Lead'}
            saving={update.isPending}
            onClose={() => setOutcomeFor(null)}
            onSave={(outcome, nextFollowUpAt) => complete(item, outcome, nextFollowUpAt)}
          />
        );
      })()}

      {scheduleFor && (
        <ScheduleFollowUpModal
          customerName={scheduleFor.customer_name || 'Lead'}
          saving={scheduling}
          onClose={() => setScheduleFor(null)}
          onSave={(input) => reschedule(scheduleFor, input)}
        />
      )}
    </div>
  );
}
