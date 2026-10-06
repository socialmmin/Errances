'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { WorkBoard } from './work-board';

// ---------------------------------------------------------------------------------------------
// One employee's report: Performance (numbers for a period), Work (every section of the sidebar,
// sorted into pending / overdue / completed) and Activity (what they did, with before -> after).
// All three share the period picked in the bar at the top.
// ---------------------------------------------------------------------------------------------

export type ReportView = 'performance' | 'work';
type Tag = 'pending' | 'overdue' | 'completed' | string;

interface WorkData {
  performance: Record<string, number>;
  followUpsByDueDay: { due_day: string; n: number; done: number }[];
  leads: any[]; followUps: any[]; callbacks: any[]; itineraries: any[]; quotations: any[]; invoices: any[]; inbox: any[];
}
interface ActivityItem { at: string; kind: string; detail: string | null; lead_id: string | null; customer_name: string | null; due_at: string | null; state: string | null; before_value: string | null; after_value: string | null }
interface ActivityData { summary: Record<string, number>; leadsContacted: number; total: number; data: ActivityItem[] }

interface Row { key: string; href?: string; tags: Tag[]; doneAt?: string | null; cells: React.ReactNode[] }
interface Section { key: string; label: string; head: string[]; filters: { key: string; label: string; tone?: string }[]; rows: Row[]; note?: string }

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const inr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n) || 0);
const words = (s?: string | null) => (s || '').replace(/_/g, ' ');

const PRESETS: { key: string; label: string; range: () => { from?: string; to?: string } }[] = [
  { key: 'today', label: 'Today', range: () => ({ from: ymd(new Date()), to: ymd(new Date()) }) },
  { key: 'yesterday', label: 'Yesterday', range: () => ({ from: ymd(addDays(new Date(), -1)), to: ymd(addDays(new Date(), -1)) }) },
  { key: '7', label: 'Last 7 days', range: () => ({ from: ymd(addDays(new Date(), -6)), to: ymd(new Date()) }) },
  { key: 'month', label: 'This month', range: () => ({ from: ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: ymd(new Date()) }) },
  { key: 'all', label: 'Overall', range: () => ({}) },
];

// A lead ends in one of two answers -- interested or not interested (and, beyond interested,
// converted). Everything else is work still open: not contacted yet, or contacted and in progress.
const CONVERTED = ['won', 'booking_confirmed', 'advance_paid'];
const INTERESTED = ['interested', 'qualified', 'quotation_sent', 'negotiation'];
const NOT_INTERESTED = ['not_interested', 'lost', 'invalid_number', 'wrong_number', 'duplicate', 'just_checking'];
function leadGroup(status: string): 'converted' | 'interested' | 'not_interested' | 'not_contacted' | 'in_progress' {
  if (CONVERTED.includes(status)) return 'converted';
  if (INTERESTED.includes(status)) return 'interested';
  if (NOT_INTERESTED.includes(status)) return 'not_interested';
  return status === 'new' ? 'not_contacted' : 'in_progress';
}

const TONE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800', overdue: 'bg-red-100 text-red-700', completed: 'bg-emerald-100 text-emerald-800',
  not_contacted: 'bg-slate-200 text-slate-700', in_progress: 'bg-sky-100 text-sky-800', followup_missing: 'bg-red-100 text-red-700',
  interested: 'bg-emerald-100 text-emerald-800', not_interested: 'bg-rose-100 text-rose-700', converted: 'bg-indigo-100 text-indigo-800',
};
const Pill = ({ tone, children }: { tone: string; children: React.ReactNode }) => <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${TONE[tone] ?? 'bg-slate-100 text-slate-700'}`}>{children}</span>;
const Who = ({ name, sub }: { name?: string | null; sub?: string | null }) => <div><p className="font-medium text-navy dark:text-white">{name || '—'}</p>{sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}</div>;
const STD = [{ key: 'pending', label: 'Pending' }, { key: 'overdue', label: 'Overdue' }, { key: 'completed', label: 'Completed' }];

function buildSections(d: WorkData): Section[] {
  const now = Date.now();
  const hoursAgo = (iso?: string | null) => (iso ? (now - new Date(iso).getTime()) / 3600000 : 0);

  const leads: Row[] = d.leads.map((l) => {
    const g = leadGroup(l.status);
    const missing = g === 'in_progress' && !l.next_follow_up;
    const tags = [g, ...(missing ? ['followup_missing'] : [])];
    return { key: l.id, href: `/leads/${l.id}`, tags, cells: [
      <Who key="c" name={l.customer_name} sub={l.whatsapp_number || l.phone} />, l.destination || '—',
      <Pill key="o" tone={g}>{g === 'not_contacted' ? 'Not contacted' : g === 'in_progress' ? 'In progress' : words(g)}</Pill>,
      <span key="s" className="text-xs capitalize text-slate-600">{words(l.status)}</span>,
      l.next_follow_up ? <span key="f" className="text-xs font-semibold text-amber-700">{dt(l.next_follow_up)}</span> : missing ? <Pill key="f" tone="followup_missing">Follow-up not created</Pill> : <span key="f" className="text-xs text-muted-foreground">None</span>,
      <span key="m" className="text-xs text-muted-foreground">{dt(l.last_message_at)}</span>, <span key="a" className="text-xs text-muted-foreground">{day(l.created_at)}</span>,
    ] };
  });

  const followUps: Row[] = d.followUps.map((f) => {
    const tag = f.status === 'done' ? 'completed' : new Date(f.due_at).getTime() < now ? 'overdue' : 'pending';
    return { key: f.id, href: `/leads/${f.lead_id}`, tags: [tag], doneAt: f.completed_at, cells: [
      <Who key="c" name={f.customer_name} sub={f.phone} />, f.destination || '—', <span key="d" className="whitespace-nowrap text-xs font-semibold">{dt(f.due_at)}</span>,
      <Pill key="s" tone={tag}>{tag}</Pill>, <p key="n" className="line-clamp-2 max-w-xs text-xs text-slate-600">{f.status === 'done' ? f.outcome || f.note || '—' : f.note || '—'}</p>,
      <span key="cr" className="text-xs text-muted-foreground">{dt(f.created_at)}{f.created_by_name ? ` · ${f.created_by_name}` : ''}</span>,
      <span key="dn" className="text-xs text-muted-foreground">{f.completed_at ? `${dt(f.completed_at)}${f.completed_by_name ? ` · ${f.completed_by_name}` : ''}` : '—'}</span>,
    ] };
  });

  const callbacks: Row[] = d.callbacks.map((c) => {
    const tag = c.called_at ? 'completed' : hoursAgo(c.requested_at) > 24 ? 'overdue' : 'pending';
    return { key: c.id, href: c.lead_id ? `/leads/${c.lead_id}` : undefined, tags: [tag], doneAt: c.called_at, cells: [
      <Who key="c" name={c.customer_name} sub={c.phone} />, c.destination || '—', <span key="r" className="whitespace-nowrap text-xs">{dt(c.requested_at)}</span>, <Pill key="s" tone={tag}>{tag === 'completed' ? 'Called' : tag}</Pill>,
      <span key="o" className="text-xs capitalize text-slate-600">{words(c.outcome) || '—'}</span>, <p key="n" className="line-clamp-2 max-w-xs text-xs text-slate-600">{c.note || '—'}</p>,
      <span key="d" className="text-xs text-muted-foreground">{c.called_at ? `${dt(c.called_at)}${c.called_by_name ? ` · ${c.called_by_name}` : ''}` : '—'}</span>,
    ] };
  });

  const delivered = d.itineraries.filter((w) => w.status !== 'failed');
  const failed = d.itineraries.filter((w) => w.status === 'failed');
  const itineraries: Row[] = delivered.map((w) => {
    const tag = ['delivered', 'read'].includes(w.status) ? 'completed' : hoursAgo(w.at) > 24 ? 'overdue' : 'pending';
    return { key: w.id, href: `/leads/${w.lead_id}`, tags: [tag], doneAt: w.at, cells: [
      <Who key="c" name={w.customer_name} sub={w.phone} />, w.package_name || '—', <span key="a" className="whitespace-nowrap text-xs">{dt(w.at)}</span>,
      <Pill key="s" tone={tag}>{w.status === 'read' ? 'Read' : w.status === 'delivered' ? 'Delivered' : tag === 'overdue' ? 'Not confirmed' : 'Waiting'}</Pill>,
    ] };
  });
  const failedRows: Row[] = failed.map((w) => {
    const tag = w.manual_at ? 'completed' : hoursAgo(w.at) > 24 ? 'overdue' : 'pending';
    return { key: w.id, href: `/leads/${w.lead_id}`, tags: [tag], doneAt: w.manual_at, cells: [
      <Who key="c" name={w.customer_name} sub={w.phone} />, w.package_name || '—', <span key="a" className="whitespace-nowrap text-xs">{dt(w.at)}</span>,
      <Pill key="s" tone={tag}>{w.manual_at ? 'Sent by hand' : tag === 'overdue' ? 'Not handled' : 'To be sent'}</Pill>,
      <p key="e" className="line-clamp-2 max-w-sm text-xs text-slate-600">{w.error_message || '—'}</p>, <span key="m" className="text-xs text-muted-foreground">{dt(w.manual_at)}</span>,
    ] };
  });

  const quotations: Row[] = d.quotations.map((q) => {
    const done = ['accepted', 'converted'].includes(q.status) || !!q.invoice_number;
    const late = !done && q.status === 'sent' && ((q.valid_until && new Date(q.valid_until).getTime() < now) || hoursAgo(q.created_at) > 72);
    const tag = done ? 'completed' : late ? 'overdue' : 'pending';
    return { key: q.id, href: `/quotations/${q.id}/edit`, tags: [tag], doneAt: q.updated_at, cells: [
      <span key="n" className="font-semibold text-navy dark:text-white">{q.quotation_number}</span>, <Who key="c" name={q.customer_name} sub={q.destination} />, <span key="t" className="font-semibold tabular-nums">{inr(q.final_amount)}</span>,
      <Pill key="s" tone={tag}>{done ? 'Approved' : q.status === 'draft' ? 'Draft' : late ? 'No reply' : 'Sent'}</Pill>, <span key="cr" className="text-xs text-muted-foreground">{day(q.created_at)}</span>,
      <span key="i" className="text-xs text-emerald-700">{q.invoice_number || '—'}</span>,
    ] };
  });

  const invoices: Row[] = d.invoices.map((i) => {
    const balance = Math.max(Number(i.total_amount) - Number(i.paid_amount), 0);
    const tag = balance <= 0 ? 'completed' : (i.due_date ? new Date(i.due_date).getTime() < now : hoursAgo(i.created_at) > 168) ? 'overdue' : 'pending';
    return { key: i.id, href: `/finance/invoices/${i.id}`, tags: [tag], doneAt: i.created_at, cells: [
      <span key="n" className="font-semibold text-navy dark:text-white">{i.invoice_number}</span>, <Who key="c" name={i.customer_name} sub={i.destination} />, <span key="t" className="font-semibold tabular-nums">{inr(i.total_amount)}</span>,
      <span key="p" className="tabular-nums text-emerald-700">{inr(i.paid_amount)}</span>, <span key="b" className={`tabular-nums ${balance > 0 ? 'font-semibold text-red-600' : 'text-emerald-600'}`}>{inr(balance)}</span>,
      <Pill key="s" tone={tag}>{tag === 'completed' ? 'Paid' : tag === 'overdue' ? 'Overdue' : 'Unpaid'}</Pill>, <span key="d" className="text-xs text-muted-foreground">{day(i.created_at)}</span>,
    ] };
  });

  const inbox: Row[] = d.inbox.map((c) => {
    const waiting = c.unread > 0 || c.last_direction === 'in';
    const tag = c.chat_status === 'done' || !waiting ? 'completed' : hoursAgo(c.last_at) > 1 ? 'overdue' : 'pending';
    return { key: c.lead_id, href: `/whatsapp?lead=${c.lead_id}`, tags: [tag], doneAt: c.last_at, cells: [
      <Who key="c" name={c.customer_name} sub={c.phone} />, c.destination || '—', <p key="b" className="line-clamp-2 max-w-sm text-xs text-slate-600">{c.last_direction === 'out' ? 'You: ' : ''}{c.last_body || '—'}</p>,
      <span key="a" className="whitespace-nowrap text-xs text-muted-foreground">{dt(c.last_at)}</span>, <Pill key="s" tone={tag}>{tag === 'completed' ? 'Replied' : tag === 'overdue' ? 'Waiting over 1 hour' : 'Waiting for reply'}</Pill>,
      c.unread > 0 ? <span key="u" className="rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-bold text-white">{c.unread}</span> : <span key="u" className="text-xs text-muted-foreground">0</span>,
    ] };
  });

  return [
    { key: 'leads', label: 'Leads', head: ['Customer', 'Destination', 'Outcome', 'Stage', 'Next follow-up', 'Last WhatsApp', 'Added'], rows: leads,
      filters: [{ key: 'not_contacted', label: 'Not contacted' }, { key: 'in_progress', label: 'In progress' }, { key: 'followup_missing', label: 'Follow-up not created' }, { key: 'interested', label: 'Interested' }, { key: 'not_interested', label: 'Not interested' }, { key: 'converted', label: 'Converted' }],
      note: 'A lead ends as Interested or Not interested. A lead that was contacted but has no follow-up scheduled is listed under “Follow-up not created”.' },
    { key: 'followups', label: 'Follow-ups', head: ['Customer', 'Destination', 'Due', 'Status', 'Note / outcome', 'Created', 'Completed'], rows: followUps, filters: STD },
    { key: 'callbacks', label: 'Callback requests', head: ['Customer', 'Destination', 'Requested', 'Status', 'Outcome', 'Note', 'Called'], rows: callbacks, filters: STD },
    { key: 'failed', label: 'Failed WhatsApp', head: ['Customer', 'Itinerary', 'Failed on', 'Status', 'Why it failed', 'Sent by hand'], rows: failedRows, filters: STD },
    { key: 'itineraries', label: 'Itineraries sent', head: ['Customer', 'Itinerary', 'Sent', 'Status'], rows: itineraries, filters: [{ key: 'pending', label: 'Waiting' }, { key: 'overdue', label: 'Not confirmed' }, { key: 'completed', label: 'Delivered' }] },
    { key: 'quotations', label: 'Quotations', head: ['Quote #', 'Customer', 'Total', 'Status', 'Created', 'Invoice'], rows: quotations, filters: [{ key: 'pending', label: 'Awaiting approval' }, { key: 'overdue', label: 'No reply' }, { key: 'completed', label: 'Approved' }] },
    { key: 'invoices', label: 'Invoices', head: ['Invoice #', 'Customer', 'Total', 'Paid', 'Balance', 'Status', 'Raised'], rows: invoices, filters: [{ key: 'pending', label: 'Unpaid' }, { key: 'overdue', label: 'Overdue' }, { key: 'completed', label: 'Paid' }] },
    { key: 'inbox', label: 'WhatsApp Inbox', head: ['Customer', 'Destination', 'Last message', 'When', 'Status', 'Unread'], rows: inbox, filters: [{ key: 'pending', label: 'Waiting for reply' }, { key: 'overdue', label: 'Waiting over 1 hour' }, { key: 'completed', label: 'Replied' }] },
  ];
}

const ACTIVITY_KINDS: { key: string; label: string; tile: string; cls: string }[] = [
  { key: 'followup_created', label: 'Follow-up scheduled', tile: 'Follow-ups scheduled', cls: 'bg-amber-100 text-amber-800' },
  { key: 'followup_done', label: 'Follow-up completed', tile: 'Follow-ups completed', cls: 'bg-emerald-100 text-emerald-800' },
  { key: 'stage_changed', label: 'Stage changed', tile: 'Stage changes', cls: 'bg-sky-100 text-sky-800' },
  { key: 'lead_assigned', label: 'Lead re-assigned', tile: 'Re-assignments', cls: 'bg-slate-200 text-slate-700' },
  { key: 'callback', label: 'Callback handled', tile: 'Callbacks handled', cls: 'bg-cyan-100 text-cyan-800' },
  { key: 'whatsapp', label: 'WhatsApp message', tile: 'WhatsApp messages', cls: 'bg-green-100 text-green-800' },
  { key: 'itinerary', label: 'Itinerary sent', tile: 'Itineraries sent', cls: 'bg-indigo-100 text-indigo-800' },
  { key: 'itinerary_manual', label: 'Itinerary sent by hand', tile: 'Sent by hand', cls: 'bg-indigo-50 text-indigo-700' },
  { key: 'note', label: 'Note added', tile: 'Notes', cls: 'bg-slate-100 text-slate-700' },
  { key: 'quotation', label: 'Quotation created', tile: 'Quotations', cls: 'bg-purple-100 text-purple-800' },
  { key: 'payment', label: 'Payment recorded', tile: 'Payments', cls: 'bg-teal-100 text-teal-800' },
  { key: 'login', label: 'Logged in', tile: 'Logins', cls: 'bg-slate-100 text-slate-500' },
];

const thCls = 'whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider';
function ThemedTable({ head, children, empty }: { head: string[]; children: React.ReactNode; empty?: React.ReactNode }) {
  return (
    <div className="theme-scroll max-h-[min(36rem,calc(100vh-13rem))] overflow-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-navy text-white"><tr>{head.map((h) => <th key={h} className={thCls}>{h}</th>)}</tr></thead>
        <tbody>{children}{empty}</tbody>
      </table>
    </div>
  );
}

export function EmployeeReport({ userId, view, onView }: { userId: string; view: ReportView; onView: (v: ReportView) => void }) {
  const router = useRouter();
  const [preset, setPreset] = useState('today');
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const range = useMemo(() => (preset === 'custom' ? { from: custom.from || undefined, to: custom.to || custom.from || undefined } : PRESETS.find((p) => p.key === preset)!.range()), [preset, custom]);
  const qs = `${range.from ? `from=${range.from}` : ''}${range.to ? `&to=${range.to}` : ''}`;
  const periodLabel = preset === 'custom' ? (range.from ? `${day(range.from)}${range.to && range.to !== range.from ? ` to ${day(range.to)}` : ''}` : 'Pick dates') : PRESETS.find((p) => p.key === preset)!.label;

  const work = useQuery({ queryKey: ['user-work', userId, qs], queryFn: () => api.get<WorkData>(`/users/${userId}/work?${qs}`) });
  const activity = useQuery({ queryKey: ['user-activity', userId, qs], queryFn: () => api.get<ActivityData>(`/users/${userId}/activity?${qs}`) });

  const sections = useMemo(() => (work.data ? buildSections(work.data) : []), [work.data]);
  // 'worked' and 'timeline' are the two activity views; the rest are the sidebar's sections.
  const [sectionKey, setSectionKey] = useState('worked');
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const section = sections.find((s) => s.key === sectionKey) ?? sections[0];
  const jump = (sec: string, f: string) => { setSectionKey(sec); setFilter(f); setSearch(''); onView('work'); };

  // Completed work is limited to the chosen period; work that is still open always shows.
  const fromMs = range.from ? new Date(`${range.from}T00:00:00`).getTime() : -Infinity;
  const toMs = range.to ? new Date(`${range.to}T23:59:59`).getTime() : Infinity;
  const inPeriod = (r: Row) => !r.tags.includes('completed') || !r.doneAt || (new Date(r.doneAt).getTime() >= fromMs && new Date(r.doneAt).getTime() <= toMs);
  const count = (sec: string, tag: string) => (sections.find((s) => s.key === sec)?.rows ?? []).filter((r) => r.tags.includes(tag)).length;

  const bar = (
    <section className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3 shadow-sm">
      <span className="px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Period</span>
      {PRESETS.map((p) => <button key={p.key} type="button" onClick={() => setPreset(p.key)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${preset === p.key ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{p.label}</button>)}
      <span className="ml-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <input type="date" value={custom.from} max={custom.to || undefined} onChange={(e) => { setCustom((c) => ({ ...c, from: e.target.value })); setPreset('custom'); }} className={`h-8 rounded-lg border px-2 text-xs ${preset === 'custom' ? 'border-gold' : 'border-input'} bg-background`} />
        to
        <input type="date" value={custom.to} min={custom.from || undefined} onChange={(e) => { setCustom((c) => ({ ...c, to: e.target.value })); setPreset('custom'); }} className={`h-8 rounded-lg border px-2 text-xs ${preset === 'custom' ? 'border-gold' : 'border-input'} bg-background`} />
      </span>
      <span className="ml-auto text-xs font-semibold text-navy dark:text-white">Showing: {periodLabel}</span>
    </section>
  );

  if (work.isLoading) return <div className="space-y-4">{bar}<p className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">Loading…</p></div>;
  if (work.isError || !work.data) return <div className="space-y-4">{bar}<p className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">Could not load this employee’s work. Press Refresh and try again.</p></div>;

  const p = work.data.performance;
  const totalLeads = work.data.leads.length;
  const groups = { not_contacted: count('leads', 'not_contacted'), in_progress: count('leads', 'in_progress'), interested: count('leads', 'interested'), not_interested: count('leads', 'not_interested'), converted: count('leads', 'converted') };
  const tomorrow = ymd(addDays(new Date(), 1)), today = ymd(new Date());
  const openCount = (s: Section) => s.key === 'leads' ? s.rows.filter((r) => r.tags.includes('not_contacted') || r.tags.includes('followup_missing')).length : s.rows.filter((r) => r.tags.includes('pending') || r.tags.includes('overdue')).length;
  // One drop-down for everything on this tab: what they did, then each section of their work.
  const picker = (
    <section className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm">
      <label htmlFor="work-view" className="px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Show</label>
      <select id="work-view" value={sectionKey} onChange={(e) => { setSectionKey(e.target.value); setFilter(''); setSearch(''); setKind(''); }} className="h-10 min-w-[19rem] flex-1 rounded-xl border border-navy/30 bg-background px-3 text-sm font-semibold text-navy outline-none focus:border-gold dark:text-white sm:flex-none">
        <optgroup label="What they did">
          <option value="worked">Leads worked on — before, work done, upcoming</option>
          <option value="timeline">Every action, in time order</option>
        </optgroup>
        <optgroup label="Their work, section by section">
          {sections.map((s) => <option key={s.key} value={s.key}>{s.label} — {s.rows.length} in all, {openCount(s)} open</option>)}
        </optgroup>
      </select>
      <span className="text-xs text-muted-foreground">Pick what to see. The period above applies to all of them.</span>
    </section>
  );
  const dueOn = (d: string) => work.data!.followUps.filter((f) => f.status === 'pending' && ymd(new Date(f.due_at)) === d).length;

  // ------------------------------------------ Performance ------------------------------------------
  if (view === 'performance') {
    const done: [string, string | number, string?][] = [
      ['Leads contacted', activity.data?.leadsContacted ?? '…', 'text-gold'], ['Follow-ups created', p.followups_created ?? 0], ['Follow-ups completed', p.followups_completed ?? 0], ['Callbacks handled', p.callbacks_handled ?? 0],
      ['WhatsApp messages sent', p.messages_sent ?? 0], ['Itineraries sent', p.itineraries_sent ?? 0], ['Quotations created', p.quotations_created ?? 0], ['Quotations approved', p.quotations_approved ?? 0, 'text-emerald-300'],
      ['Leads converted', p.leads_converted ?? 0, 'text-emerald-300'], ['Marked interested', p.marked_interested ?? 0], ['Marked not interested', p.marked_not_interested ?? 0], ['Amount collected', inr(p.amount_collected ?? 0), 'text-emerald-300'],
      ['New leads received', p.new_leads ?? 0], ['Notes added', p.notes_added ?? 0],
    ];
    const notDone: [string, number, string, string, string][] = [
      ['Leads not contacted yet', groups.not_contacted, 'leads', 'not_contacted', 'Call or message them'],
      ['Contacted, but no follow-up created', count('leads', 'followup_missing'), 'leads', 'followup_missing', 'Schedule a follow-up for each'],
      ['Follow-ups overdue', count('followups', 'overdue'), 'followups', 'overdue', 'The due time has passed'],
      ['Callback requests waiting', count('callbacks', 'pending') + count('callbacks', 'overdue'), 'callbacks', count('callbacks', 'overdue') ? 'overdue' : 'pending', 'Customer asked for a call'],
      ['Failed itineraries not handled', count('failed', 'pending') + count('failed', 'overdue'), 'failed', count('failed', 'overdue') ? 'overdue' : 'pending', 'Send by hand or retry'],
      ['WhatsApp chats waiting for a reply', count('inbox', 'pending') + count('inbox', 'overdue'), 'inbox', count('inbox', 'overdue') ? 'overdue' : 'pending', 'Customer wrote last'],
      ['Quotations awaiting approval', count('quotations', 'pending') + count('quotations', 'overdue'), 'quotations', count('quotations', 'overdue') ? 'overdue' : 'pending', 'Follow up to close'],
      ['Invoices not fully paid', count('invoices', 'pending') + count('invoices', 'overdue'), 'invoices', count('invoices', 'overdue') ? 'overdue' : 'pending', 'Collect the balance'],
    ];
    const seg: [string, number, string, string][] = [['Not contacted', groups.not_contacted, 'bg-slate-400', 'not_contacted'], ['In progress', groups.in_progress, 'bg-sky-500', 'in_progress'], ['Interested', groups.interested, 'bg-emerald-500', 'interested'], ['Not interested', groups.not_interested, 'bg-rose-500', 'not_interested'], ['Converted', groups.converted, 'bg-indigo-500', 'converted']];
    return (
      <div className="space-y-4">
        {bar}
        <WorkBoard userId={userId} qs={qs} periodLabel={periodLabel} onJump={jump} />
        <section className="rounded-2xl bg-gradient-to-br from-navy to-slate-900 p-5 text-white shadow-xl">
          <p className="text-xs font-bold uppercase tracking-widest text-gold">Work done · {periodLabel}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {done.map(([label, value, cls]) => <div key={label} className="rounded-xl bg-white/5 p-3"><p className={`truncate text-xl font-bold tabular-nums ${cls ?? ''}`}>{value}</p><p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-400">{label}</p></div>)}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="border-b px-5 py-3"><p className="font-bold text-navy dark:text-white">Not done — needs attention now</p><p className="text-xs text-muted-foreground">Open work as of this moment, whatever the period. Click a row to see the list.</p></div>
            <ThemedTable head={['Work', 'Count', 'What to do']}>
              {notDone.map(([label, n, sec, f, hint]) => (
                <tr key={label} onClick={() => jump(sec, f)} className="cursor-pointer border-t border-border/60 hover:bg-gold/5">
                  <td className="px-4 py-2.5 font-medium text-navy dark:text-white">{label}</td>
                  <td className="px-4 py-2.5"><span className={`rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${n ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{n}</span></td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{n ? hint : 'All clear'}</td>
                </tr>
              ))}
            </ThemedTable>
          </section>

          <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="border-b px-5 py-3"><p className="font-bold text-navy dark:text-white">Follow-ups created · {periodLabel}</p><p className="text-xs text-muted-foreground">How many were created in this period, and for which date they are due.</p></div>
            <ThemedTable head={['Due date', 'Follow-ups created', 'Completed', 'Still open']} empty={!work.data.followUpsByDueDay.length ? <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">No follow-ups were created in this period.</td></tr> : null}>
              {work.data.followUpsByDueDay.map((r) => (
                <tr key={r.due_day} onClick={() => jump('followups', '')} className="cursor-pointer border-t border-border/60 hover:bg-gold/5">
                  <td className="px-4 py-2.5 font-medium text-navy dark:text-white">{day(`${r.due_day}T00:00:00`)}{r.due_day === today ? ' · today' : r.due_day === tomorrow ? ' · tomorrow' : ''}</td>
                  <td className="px-4 py-2.5 font-bold tabular-nums">{r.n}</td><td className="px-4 py-2.5 tabular-nums text-emerald-700">{r.done}</td><td className="px-4 py-2.5 tabular-nums text-amber-700">{r.n - r.done}</td>
                </tr>
              ))}
            </ThemedTable>
            <div className="flex flex-wrap gap-2 border-t bg-muted/30 px-5 py-3 text-xs">
              <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800">Due today: {dueOn(today)}</span>
              <span className="rounded-full bg-sky-100 px-2.5 py-1 font-semibold text-sky-800">Due tomorrow: {dueOn(tomorrow)}</span>
              <span className="rounded-full bg-red-100 px-2.5 py-1 font-semibold text-red-700">Overdue: {count('followups', 'overdue')}</span>
            </div>
          </section>
        </div>

        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="font-bold text-navy dark:text-white">Lead outcomes — all {totalLeads} assigned leads</p><p className="text-xs text-muted-foreground">Every lead ends as Interested or Not interested; the rest is still open work.</p></div>
            <p className="text-sm font-semibold text-navy dark:text-white">Conversion: {totalLeads ? ((groups.converted / totalLeads) * 100).toFixed(1) : '0.0'}% · Interested: {totalLeads ? (((groups.interested + groups.converted) / totalLeads) * 100).toFixed(1) : '0.0'}%</p></div>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100">{seg.map(([label, n, cls]) => n > 0 && <div key={label} title={`${label}: ${n}`} className={cls} style={{ width: `${(n / Math.max(totalLeads, 1)) * 100}%` }} />)}</div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {seg.map(([label, n, cls, f]) => <button key={label} type="button" onClick={() => jump('leads', f)} className="rounded-xl border p-3 text-left hover:border-gold"><p className="flex items-center gap-2 text-xl font-bold tabular-nums text-navy dark:text-white"><span className={`h-2.5 w-2.5 rounded-full ${cls}`} />{n}</p><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p></button>)}
          </div>
        </section>
      </div>
    );
  }


  // ------------------------------------------ Leads worked on ------------------------------------------
  // One row per lead this person touched in the period: what it was before, what they did (with
  // the time), what it is now, and what is scheduled next.
  if (sectionKey === 'worked') {
    const leadNow = new Map<string, any>(work.data.leads.map((l) => [l.id, l]));
    const byLead = new Map<string, ActivityItem[]>();
    for (const a of activity.data?.data ?? []) { if (!a.lead_id || a.kind === 'lead_assigned') continue; byLead.set(a.lead_id, [...(byLead.get(a.lead_id) ?? []), a]); }
    const kindLabel = (k: string) => ACTIVITY_KINDS.find((x) => x.key === k)?.label ?? words(k);
    const rows = Array.from(byLead.entries()).map(([leadId, items]) => {
      const acts = [...items].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      const cur = leadNow.get(leadId);
      const firstStage = acts.find((a) => a.kind === 'stage_changed');
      const lastStage = [...acts].reverse().find((a) => a.kind === 'stage_changed');
      const firstFollow = acts.find((a) => a.kind === 'followup_created');
      const stageNow = cur?.status ?? lastStage?.after_value ?? null;
      const stageBefore = firstStage?.before_value ?? stageNow;
      const scheduled = acts.filter((a) => a.kind === 'followup_created' && a.due_at && a.state === 'pending').map((a) => a.due_at as string).sort()[0];
      const next: string | null = cur?.next_follow_up ?? scheduled ?? null;
      const closed = stageNow ? ['converted', 'not_interested'].includes(leadGroup(stageNow)) : false;
      return { leadId, name: acts[0].customer_name || cur?.customer_name || '—', phone: cur?.whatsapp_number || cur?.phone || '', acts, stageBefore, stageNow, stageChanged: !!firstStage && stageBefore !== stageNow,
        followBefore: firstFollow ? firstFollow.before_value || 'None' : null, next, closed, last: acts[acts.length - 1].at,
        tags: [next ? 'upcoming' : closed ? 'closed' : 'nothing', ...(firstStage && stageBefore !== stageNow ? ['stage'] : []), ...(firstFollow ? ['followup'] : [])] };
    }).sort((a, b) => new Date(b.last).getTime() - new Date(a.last).getTime());
    const chips = [{ key: 'upcoming', label: 'Next work scheduled' }, { key: 'nothing', label: 'Nothing scheduled' }, { key: 'stage', label: 'Stage changed' }, { key: 'followup', label: 'Follow-up created' }, { key: 'closed', label: 'Closed' }];
    const shownRows = rows.filter((r) => (!filter || r.tags.includes(filter)) && (!search || `${r.name} ${r.phone}`.toLowerCase().includes(search.toLowerCase())));
    return (
      <div className="space-y-4">
        {bar}{picker}
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
            <button type="button" onClick={() => setFilter('')} className={`rounded-full px-3 py-1 text-xs font-semibold ${!filter ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600'}`}>All {rows.length}</button>
            {chips.map((c) => <button key={c.key} type="button" onClick={() => setFilter(c.key)} className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === c.key ? 'bg-navy text-white' : c.key === 'nothing' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{c.label} {rows.filter((r) => r.tags.includes(c.key)).length}</button>)}
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or mobile…" className="ml-auto h-8 w-56 rounded-lg border border-input bg-background px-3 text-xs outline-none focus:border-gold" />
          </div>
          <p className="border-b bg-muted/30 px-5 py-2 text-xs text-muted-foreground">Leads this person worked on · {periodLabel}. “Before” is how the lead stood before their first action in this period; “Upcoming” is what is scheduled next.</p>
          <ThemedTable head={['Lead', 'Before', 'Work done', 'Now', 'Upcoming work']} empty={!shownRows.length ? <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">{activity.isLoading ? 'Loading…' : 'No leads were worked on in this period.'}</td></tr> : null}>
            {shownRows.map((r, i) => (
              <tr key={r.leadId} onClick={() => router.push(`/leads/${r.leadId}`)} className={`cursor-pointer border-t border-border/60 hover:bg-gold/5 ${i % 2 ? 'bg-slate-50/60 dark:bg-white/[0.02]' : ''}`}>
                <td className="px-4 py-3 align-top"><Who name={r.name} sub={r.phone} /></td>
                <td className="px-4 py-3 align-top text-xs">
                  <p><span className="text-muted-foreground">Stage:</span> <span className="font-semibold capitalize text-slate-700">{words(r.stageBefore) || '—'}</span></p>
                  <p className="mt-0.5"><span className="text-muted-foreground">Follow-up:</span> <span className="font-semibold text-slate-700">{r.followBefore ?? '—'}</span></p>
                </td>
                <td className="px-4 py-3 align-top text-xs">
                  <ul className="space-y-1">
                    {r.acts.slice(0, 5).map((a, j) => <li key={j} className="flex gap-2"><span className="w-28 shrink-0 whitespace-nowrap text-muted-foreground">{dt(a.at)}</span><span><b className="text-navy dark:text-white">{kindLabel(a.kind)}</b>{a.kind === 'stage_changed' ? <span className="capitalize"> — {words(a.before_value)} → {words(a.after_value)}</span> : a.kind === 'followup_created' ? <span> — for {dt(a.due_at)}</span> : a.detail ? <span className="text-slate-600"> — {a.detail.slice(0, 70)}{a.detail.length > 70 ? '…' : ''}</span> : null}</span></li>)}
                    {r.acts.length > 5 && <li className="text-muted-foreground">+ {r.acts.length - 5} more</li>}
                  </ul>
                </td>
                <td className="px-4 py-3 align-top">{r.stageNow ? <><Pill tone={leadGroup(r.stageNow)}>{leadGroup(r.stageNow) === 'not_contacted' ? 'Not contacted' : leadGroup(r.stageNow) === 'in_progress' ? 'In progress' : words(leadGroup(r.stageNow))}</Pill><p className="mt-1 text-xs capitalize text-slate-600">{words(r.stageNow)}{r.stageChanged ? ' (changed)' : ''}</p></> : <span className="text-xs text-muted-foreground">—</span>}</td>
                <td className="px-4 py-3 align-top text-xs">{r.next ? <><p className="font-bold text-amber-700">Follow-up</p><p className="font-semibold text-navy dark:text-white">{dt(r.next)}</p><p className="text-muted-foreground">{ymd(new Date(r.next)) === today ? 'today' : ymd(new Date(r.next)) === tomorrow ? 'tomorrow' : new Date(r.next).getTime() < Date.now() ? 'overdue' : ''}</p></> : r.closed ? <span className="text-muted-foreground">Closed — nothing needed</span> : <Pill tone="followup_missing">Nothing scheduled</Pill>}</td>
              </tr>
            ))}
          </ThemedTable>
        </section>
      </div>
    );
  }

  // ------------------------------------------ Activity ------------------------------------------
  if (sectionKey === 'timeline') {
    const kindOf = (k: string) => ACTIVITY_KINDS.find((x) => x.key === k) ?? { key: k, label: words(k), tile: words(k), cls: 'bg-slate-100 text-slate-700' };
    const rows = (activity.data?.data ?? []).filter((r) => !kind || r.kind === kind);
    return (
      <div className="space-y-4">
        {bar}{picker}
        <section className="rounded-2xl bg-gradient-to-br from-navy to-slate-900 p-5 text-white shadow-xl">
          <p className="text-xs font-bold uppercase tracking-widest text-gold">Activity · {periodLabel}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{activity.data?.total ?? 0} <span className="text-sm font-semibold text-slate-300">actions · {activity.data?.leadsContacted ?? 0} leads worked on</span></p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {ACTIVITY_KINDS.map((k) => <button key={k.key} type="button" onClick={() => setKind(kind === k.key ? '' : k.key)} className={`rounded-xl p-3 text-left transition ${kind === k.key ? 'bg-gold/25 ring-1 ring-gold' : 'bg-white/5 hover:bg-white/10'}`}><p className="text-lg font-bold tabular-nums">{activity.data?.summary?.[k.key] ?? 0}</p><p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-400">{k.tile}</p></button>)}
          </div>
        </section>
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-3 text-sm"><p className="font-bold text-navy dark:text-white">{kind ? kindOf(kind).tile : 'Everything'} <span className="font-normal text-muted-foreground">· {rows.length} shown</span></p>{kind && <button type="button" onClick={() => setKind('')} className="text-xs font-semibold text-sky-700 hover:underline">Show everything</button>}</div>
          <ThemedTable head={['When', 'What', 'Lead', 'Before', 'After', 'Details']} empty={!rows.length ? <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">{activity.isLoading ? 'Loading…' : activity.isError ? 'Could not load the activity.' : 'Nothing recorded in this period.'}</td></tr> : null}>
            {rows.map((r, i) => (
              <tr key={i} onClick={() => r.lead_id && router.push(`/leads/${r.lead_id}`)} className={`border-t border-border/60 ${i % 2 ? 'bg-slate-50/60 dark:bg-white/[0.02]' : ''} ${r.lead_id ? 'cursor-pointer hover:bg-gold/5' : ''}`}>
                <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">{dt(r.at)}</td>
                <td className="px-4 py-2.5"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${kindOf(r.kind).cls}`}>{kindOf(r.kind).label}</span></td>
                <td className="px-4 py-2.5 font-medium text-navy dark:text-white">{r.customer_name || '—'}</td>
                <td className="px-4 py-2.5 text-xs capitalize text-slate-500">{r.kind === 'followup_created' ? r.before_value || 'None' : words(r.before_value) || '—'}</td>
                <td className="px-4 py-2.5 text-xs font-semibold capitalize text-navy dark:text-white">{words(r.after_value) || '—'}</td>
                <td className="px-4 py-2.5 text-xs text-slate-600"><p className="line-clamp-2 max-w-sm whitespace-pre-line">{r.detail || '—'}</p>{r.state && r.kind !== 'followup_created' && r.kind !== 'followup_done' && <p className="mt-0.5 text-[11px] capitalize text-muted-foreground">{words(r.state)}</p>}</td>
              </tr>
            ))}
          </ThemedTable>
        </section>
      </div>
    );
  }

  // ------------------------------------------ Work ------------------------------------------
  const visible = section.rows.filter(inPeriod);
  const shown = visible.filter((r) => (!filter || r.tags.includes(filter)) && (!search || JSON.stringify(r.cells.map((c: any) => (typeof c === 'string' ? c : c?.props))).toLowerCase().includes(search.toLowerCase())));
  return (
    <div className="space-y-4">
      {bar}{picker}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
          <button type="button" onClick={() => setFilter('')} className={`rounded-full px-3 py-1 text-xs font-semibold ${!filter ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600'}`}>All {visible.length}</button>
          {section.filters.map((f) => <button key={f.key} type="button" onClick={() => setFilter(f.key)} className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === f.key ? 'bg-navy text-white' : TONE[f.key] ?? 'bg-slate-100 text-slate-600'}`}>{f.label} {visible.filter((r) => r.tags.includes(f.key)).length}</button>)}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search in this list…" className="ml-auto h-8 w-56 rounded-lg border border-input bg-background px-3 text-xs outline-none focus:border-gold" />
        </div>
        {(section.note || section.key !== 'leads') && <p className="border-b bg-muted/30 px-5 py-2 text-xs text-muted-foreground">{section.note ?? `Open work always shows. Completed work shows for the chosen period (${periodLabel}).`}</p>}
        <ThemedTable head={section.head} empty={!shown.length ? <tr><td colSpan={section.head.length} className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing here{filter || search ? ' for this filter' : ''}.</td></tr> : null}>
          {shown.slice(0, 1500).map((r, i) => (
            <tr key={r.key} onClick={() => r.href && router.push(r.href)} className={`border-t border-border/60 ${i % 2 ? 'bg-slate-50/60 dark:bg-white/[0.02]' : ''} ${r.href ? 'cursor-pointer hover:bg-gold/5' : ''}`}>
              {r.cells.map((c, j) => <td key={j} className="px-4 py-2.5 align-top">{c}</td>)}
            </tr>
          ))}
        </ThemedTable>
      </section>
    </div>
  );
}
