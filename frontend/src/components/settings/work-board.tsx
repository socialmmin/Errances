'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BellRing, CalendarClock, CheckCircle2, Clock, FileText, MessageCircle, PhoneCall, ReceiptText, Users } from 'lucide-react';
import { api } from '@/lib/api-client';

// ---------------------------------------------------------------------------------------------
// The work board. Every section of the sidebar as the same three numbers:
//   To clear  -- pending / overdue work, the number that should come down to zero
//   Upcoming  -- work that is lined up but not due yet
//   Done      -- what was finished in the chosen period
// WorkBoard shows one employee (their Performance tab); TeamBoard shows everyone side by side.
// ---------------------------------------------------------------------------------------------

export interface BoardUser {
  id: string; full_name: string; phone: string | null; role_name: string; lead_stages: Record<string, number>;
  callbacks_pending: number; callbacks_done: number; failed_pending: number; failed_done: number; inbox_pending: number; inbox_done: number;
  followups_overdue: number; followups_upcoming: number; followups_today: number; followups_tomorrow: number; followups_done: number;
  quotations_awaiting: number; quotations_draft: number; quotations_done: number; invoices_unpaid: number; invoices_done: number;
  reminders_none: number; reminders_scheduled: number; reminders_done: number; leads_converted: number; leads_first_contact: number; leads_closed_lost: number;
}
interface BoardData { asOf: string; data: BoardUser[] }

const CONVERTED = ['won', 'booking_confirmed', 'advance_paid'];
const LOST = ['not_interested', 'lost', 'invalid_number', 'wrong_number', 'duplicate'];
const STAGE_ORDER = ['new', 'contacted', 'message_sent', 'itinerary_sent', 'follow_up', 'interested', 'qualified', 'quotation_sent', 'negotiation', 'no_response', 'just_checking', 'advance_paid', 'booking_confirmed', 'won', 'not_interested', 'invalid_number', 'lost'];
const words = (s: string) => s.replace(/_/g, ' ');
const sum = (o: Record<string, number>, keys?: string[]) => Object.entries(o || {}).reduce((n, [k, v]) => n + (!keys || keys.includes(k) ? Number(v) || 0 : 0), 0);

export interface BoardRow { key: string; label: string; icon: React.ElementType; clear: number; clearLabel: string; upcoming: number | null; upcomingLabel: string; done: number; doneLabel: string; jump: [string, string] }

export function boardRows(u: BoardUser): BoardRow[] {
  const total = sum(u.lead_stages);
  const fresh = Number(u.lead_stages?.new) || 0;
  const closed = sum(u.lead_stages, [...CONVERTED, ...LOST]);
  return [
    { key: 'leads', label: 'Leads', icon: Users, clear: fresh, clearLabel: 'new, not spoken to yet', upcoming: total - fresh - closed, upcomingLabel: 'being worked on', done: u.leads_first_contact, doneLabel: `spoken to first time · ${u.leads_converted} converted · ${u.leads_closed_lost} not interested`, jump: ['leads', 'not_contacted'] },
    { key: 'callbacks', label: 'Callback requests', icon: PhoneCall, clear: u.callbacks_pending, clearLabel: 'waiting for a call', upcoming: null, upcomingLabel: '', done: u.callbacks_done, doneLabel: 'called back', jump: ['callbacks', 'pending'] },
    { key: 'failed', label: 'Failed WhatsApp', icon: AlertTriangle, clear: u.failed_pending, clearLabel: 'itinerary not delivered', upcoming: null, upcomingLabel: '', done: u.failed_done, doneLabel: 'sent again / by hand', jump: ['failed', 'pending'] },
    { key: 'inbox', label: 'WhatsApp Inbox', icon: MessageCircle, clear: u.inbox_pending, clearLabel: 'reply pending', upcoming: null, upcomingLabel: '', done: u.inbox_done, doneLabel: 'customers replied to', jump: ['inbox', 'pending'] },
    { key: 'followups', label: 'Follow-ups', icon: CalendarClock, clear: u.followups_overdue, clearLabel: 'overdue', upcoming: u.followups_upcoming, upcomingLabel: `${u.followups_today} today · ${u.followups_tomorrow} tomorrow`, done: u.followups_done, doneLabel: 'completed', jump: ['followups', 'overdue'] },
    { key: 'quotations', label: 'Quotations', icon: FileText, clear: u.quotations_awaiting, clearLabel: 'sent, not approved', upcoming: u.quotations_draft, upcomingLabel: 'drafts to send', done: u.quotations_done, doneLabel: 'approved', jump: ['quotations', 'pending'] },
    { key: 'invoices', label: 'Invoices', icon: ReceiptText, clear: u.invoices_unpaid, clearLabel: 'not fully paid', upcoming: null, upcomingLabel: '', done: u.invoices_done, doneLabel: 'paid in full', jump: ['invoices', 'pending'] },
    { key: 'reminders', label: 'Payment reminders', icon: BellRing, clear: u.reminders_none, clearLabel: 'unpaid, no reminder set', upcoming: u.reminders_scheduled, upcomingLabel: 'scheduled', done: u.reminders_done, doneLabel: 'sent', jump: ['invoices', 'pending'] },
  ];
}

const clearCls = (n: number) => (n > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700');
const Num = ({ n, cls }: { n: number | null; cls: string }) => n === null ? <span className="text-slate-300">—</span> : <span className={`inline-block min-w-[2.5rem] rounded-full px-2.5 py-0.5 text-center text-sm font-bold tabular-nums ${cls}`}>{n}</span>;
const th = 'whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider';

// One employee's board, for the Performance tab. onJump opens the list behind a number.
export function WorkBoard({ userId, qs, periodLabel, onJump }: { userId: string; qs: string; periodLabel: string; onJump?: (section: string, filter: string) => void }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ['work-board', userId, qs], queryFn: () => api.get<BoardData>(`/users/work-board?userId=${userId}${qs ? `&${qs.replace(/^&/, '')}` : ''}`) });
  const u = data?.data?.[0];
  if (isLoading) return <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">Loading the work board…</p>;
  if (isError || !u) return <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">The work board could not be loaded. Press Refresh and try again.</p>;
  const rows = boardRows(u);
  const toClear = rows.reduce((n, r) => n + r.clear, 0);
  const stages = [...STAGE_ORDER.filter((s) => u.lead_stages?.[s]), ...Object.keys(u.lead_stages || {}).filter((s) => !STAGE_ORDER.includes(s))];
  const stageTone = (s: string) => s === 'new' ? 'border-red-200 bg-red-50 text-red-700' : CONVERTED.includes(s) ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : LOST.includes(s) ? 'border-slate-200 bg-slate-100 text-slate-600' : 'border-amber-200 bg-amber-50 text-amber-900';
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
        <div><p className="font-bold text-navy dark:text-white">Work board</p><p className="text-xs text-muted-foreground">“To clear” and “Upcoming” are as of now. “Done” is for {periodLabel.toLowerCase()}. Click a row to open the list.</p></div>
        <span className={`rounded-full px-3 py-1 text-sm font-bold ${clearCls(toClear)}`}>{toClear ? `${toClear} to clear` : 'All clear'}</span>
      </div>
      <div className="theme-scroll overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="bg-navy text-white"><tr>
            <th className={th}>Section</th>
            <th className={th}><span className="inline-flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-red-300" />To clear</span></th>
            <th className={th}><span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-amber-300" />Upcoming</span></th>
            <th className={th}><span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />Done · {periodLabel}</span></th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} onClick={() => onJump?.(r.jump[0], r.jump[1])} className={`border-t border-border/60 ${onJump ? 'cursor-pointer hover:bg-gold/5' : ''}`}>
                <td className="px-4 py-2.5"><span className="flex items-center gap-2 font-semibold text-navy dark:text-white"><r.icon className="h-4 w-4 text-gold" />{r.label}</span></td>
                <td className="px-4 py-2.5"><Num n={r.clear} cls={clearCls(r.clear)} /><span className="ml-2 text-xs text-muted-foreground">{r.clearLabel}</span></td>
                <td className="px-4 py-2.5"><Num n={r.upcoming} cls="bg-amber-100 text-amber-800" />{r.upcoming !== null && <span className="ml-2 text-xs text-muted-foreground">{r.upcomingLabel}</span>}</td>
                <td className="px-4 py-2.5"><Num n={r.done} cls="bg-emerald-100 text-emerald-800" /><span className="ml-2 text-xs text-muted-foreground">{r.doneLabel}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t bg-muted/30 px-5 py-3">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Leads by stage · {sum(u.lead_stages)} in all</p>
        <div className="flex flex-wrap gap-1.5">
          {stages.length ? stages.map((s) => <span key={s} className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${stageTone(s)}`}>{words(s)} <b className="tabular-nums">{u.lead_stages[s]}</b></span>) : <span className="text-xs text-muted-foreground">No leads assigned.</span>}
        </div>
      </div>
    </section>
  );
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const PRESETS: { key: string; label: string; range: () => { from?: string; to?: string } }[] = [
  { key: 'today', label: 'Today', range: () => ({ from: ymd(new Date()), to: ymd(new Date()) }) },
  { key: 'yesterday', label: 'Yesterday', range: () => ({ from: ymd(addDays(new Date(), -1)), to: ymd(addDays(new Date(), -1)) }) },
  { key: '7', label: 'Last 7 days', range: () => ({ from: ymd(addDays(new Date(), -6)), to: ymd(new Date()) }) },
  { key: 'month', label: 'This month', range: () => ({ from: ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: ymd(new Date()) }) },
];
const VIEWS = [
  { key: 'clear', label: 'To clear', hint: 'Pending and overdue — should be zero', icon: AlertTriangle },
  { key: 'upcoming', label: 'Upcoming', hint: 'Lined up, not due yet', icon: Clock },
  { key: 'done', label: 'Done', hint: 'Finished in the period', icon: CheckCircle2 },
] as const;

// Every employee side by side: one number per section, for the view chosen above the table.
export function TeamBoard() {
  const router = useRouter();
  const [preset, setPreset] = useState('today');
  const [view, setView] = useState<'clear' | 'upcoming' | 'done'>('clear');
  const range = useMemo(() => PRESETS.find((p) => p.key === preset)!.range(), [preset]);
  const qs = `${range.from ? `from=${range.from}` : ''}${range.to ? `&to=${range.to}` : ''}`;
  const { data, isLoading, isError, refetch, isFetching } = useQuery({ queryKey: ['work-board', 'team', qs], queryFn: () => api.get<BoardData>(`/users/work-board?${qs}`), refetchInterval: 60000 });
  const people = useMemo(() => (data?.data ?? []).map((u) => ({ u, rows: boardRows(u) })), [data]);
  const value = (r: BoardRow) => (view === 'clear' ? r.clear : view === 'upcoming' ? r.upcoming : r.done);
  const total = (rows: BoardRow[]) => rows.reduce((n, r) => n + (value(r) ?? 0), 0);
  const sorted = useMemo(() => [...people].sort((a, b) => total(b.rows) - total(a.rows)), [people, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const heads = people[0]?.rows ?? [];
  const grand = (i: number) => people.reduce((n, p) => n + (value(p.rows[i]) ?? 0), 0);
  const tone = (n: number | null) => n === null ? '' : view === 'clear' ? clearCls(n) : view === 'upcoming' ? (n ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500') : (n ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500');
  const periodLabel = PRESETS.find((p) => p.key === preset)!.label;
  const tiles: [string, number, string][] = [['To clear now', people.reduce((n, p) => n + p.rows.reduce((m, r) => m + r.clear, 0), 0), 'text-rose-300'], ['Upcoming', people.reduce((n, p) => n + p.rows.reduce((m, r) => m + (r.upcoming ?? 0), 0), 0), 'text-amber-300'], [`Done · ${periodLabel}`, people.reduce((n, p) => n + p.rows.reduce((m, r) => m + r.done, 0), 0), 'text-emerald-300'], ['Employees', people.length, 'text-white']];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-gradient-to-br from-navy to-slate-900 p-5 text-white shadow-xl">
        <p className="text-xs font-bold uppercase tracking-widest text-gold">Team work board</p>
        <h1 className="mt-1 text-2xl font-bold">Who has what pending</h1>
        <p className="mt-0.5 text-sm text-slate-300">Every employee, every section. “To clear” should come down to zero.</p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map(([label, n, cls]) => <div key={label} className="rounded-xl bg-white/5 p-3"><p className={`text-2xl font-bold tabular-nums ${cls}`}>{n}</p><p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-400">{label}</p></div>)}
        </div>
      </section>

      <div className="grid gap-2 sm:grid-cols-3">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => setView(v.key)} className={`flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition ${view === v.key ? 'border-gold bg-gold/10 shadow' : 'border-slate-200 bg-white hover:border-gold/60'}`}>
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${view === v.key ? 'bg-gold text-navy' : 'bg-slate-100 text-slate-600'}`}><v.icon className="h-5 w-5" /></span>
            <span><span className="block text-sm font-bold text-navy">{v.label}</span><span className="block text-xs text-slate-500">{v.hint}</span></span>
          </button>
        ))}
      </div>

      <section className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3 shadow-sm">
        <span className="px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Done in</span>
        {PRESETS.map((p) => <button key={p.key} type="button" onClick={() => setPreset(p.key)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${preset === p.key ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{p.label}</button>)}
        <span className="ml-auto text-xs text-muted-foreground">{view === 'done' ? `Showing work done: ${periodLabel.toLowerCase()}` : 'Showing the position right now'}</span>
        <button type="button" onClick={() => refetch()} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-navy hover:border-gold">{isFetching ? 'Refreshing…' : 'Refresh'}</button>
      </section>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="theme-scroll max-h-[calc(100vh-14rem)] overflow-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-navy text-white"><tr>
              <th className={th}>S.No</th><th className={th}>Employee</th>
              {heads.map((h) => <th key={h.key} className={`${th} text-center`}><span className="inline-flex items-center gap-1.5"><h.icon className="h-3.5 w-3.5 text-gold" />{h.label}</span></th>)}
              <th className={`${th} text-center`}>Total</th>
            </tr></thead>
            <tbody>
              {isLoading && <tr><td colSpan={12} className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</td></tr>}
              {isError && <tr><td colSpan={12} className="px-4 py-8 text-center text-sm text-red-600">The team board could not be loaded. Press Refresh.</td></tr>}
              {!isLoading && !isError && !sorted.length && <tr><td colSpan={12} className="px-4 py-8 text-center text-sm text-muted-foreground">No employees yet.</td></tr>}
              {sorted.map(({ u, rows }, i) => (
                <tr key={u.id} onClick={() => router.push(`/settings/users/${u.id}?tab=performance`)} className="cursor-pointer border-t border-border/60 hover:bg-gold/5">
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="px-4 py-2.5"><p className="font-semibold text-navy dark:text-white">{u.full_name}</p><p className="text-[11px] capitalize text-muted-foreground">{words(u.role_name)} · {sum(u.lead_stages)} leads</p></td>
                  {rows.map((r) => <td key={r.key} className="px-4 py-2.5 text-center" title={view === 'clear' ? r.clearLabel : view === 'upcoming' ? r.upcomingLabel : r.doneLabel}><Num n={value(r)} cls={tone(value(r))} /></td>)}
                  <td className="px-4 py-2.5 text-center"><span className={`inline-block min-w-[3rem] rounded-full px-3 py-1 text-sm font-extrabold tabular-nums ${view === 'clear' ? (total(rows) ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white') : 'bg-navy text-white'}`}>{total(rows)}</span></td>
                </tr>
              ))}
              {sorted.length > 1 && (
                <tr className="border-t-2 border-navy/20 bg-muted/40 font-bold">
                  <td className="px-4 py-2.5" /><td className="px-4 py-2.5 text-navy dark:text-white">Whole team</td>
                  {heads.map((h, i) => <td key={h.key} className="px-4 py-2.5 text-center tabular-nums">{view === 'upcoming' && h.upcoming === null ? '—' : grand(i)}</td>)}
                  <td className="px-4 py-2.5 text-center tabular-nums">{people.reduce((n, p) => n + total(p.rows), 0)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t bg-muted/30 px-5 py-2.5 text-xs text-muted-foreground">Click an employee to open their Performance page with the full lists. Only work recorded in the CRM is counted.</p>
      </section>
    </div>
  );
}
