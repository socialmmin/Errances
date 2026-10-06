'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Eye, RefreshCw, Send, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';

interface Tpl { which: 'md' | 'employee'; body: string; templateId: string | null; status: string | null; rejectionReason: string | null; message?: string }
interface Employee { id: string; name: string; role: string; enabled: boolean; hasNumber: boolean; number: string | null; pending: number; done: number; upcoming: number; tomorrow: number; message: string; lastStatus: string | null; lastAt: string | null; lastError: string | null }
interface TeamReports { md: Tpl; employee: Tpl; employees: Employee[] }

const STATUS: Record<string, { text: string; cls: string }> = {
  APPROVED: { text: 'Approved by Meta — being sent', cls: 'bg-emerald-100 text-emerald-700' },
  PENDING: { text: 'With Meta for review', cls: 'bg-amber-100 text-amber-800' },
  REJECTED: { text: 'Rejected by Meta', cls: 'bg-red-100 text-red-700' },
};
const SENT: Record<string, string> = { accepted: 'Sent', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed' };

// WhatsApp's own bold (*text*), so the preview reads the way the phone shows it.
function Bubble({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*)/g);
  return <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-900">{parts.map((p, i) => (/^\*[^*\n]+\*$/.test(p) ? <b key={i}>{p.slice(1, -1)}</b> : <span key={i}>{p}</span>))}</p>;
}
const Phone = ({ text, tall }: { text?: string; tall?: boolean }) => (
  <div className={`${tall ? 'max-h-[70vh]' : 'max-h-[26rem]'} overflow-y-auto rounded-xl bg-[#efe7dd] p-3`}>
    <div className="rounded-lg rounded-tl-none bg-white px-3 py-2 shadow-sm">{text ? <Bubble text={text} /> : <p className="text-sm text-slate-500">Loading…</p>}</div>
  </div>
);

// The daily work reports: every section of the sidebar as pending / done today / upcoming.
// One message for the MD (the whole team) and one for each employee (their own work), with each
// employee switched on or off here. Both are new WhatsApp templates, so they start going out once
// Meta approves them; the current report keeps sending until then.
export function DailyReportNewLayout() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState('');
  const [showing, setShowing] = useState<Employee | null>(null);
  const { data, isLoading, isError } = useQuery({ queryKey: ['daily-report', 'team'], queryFn: () => api.get<TeamReports>('/reporting/daily-report/team'), refetchInterval: 120000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['daily-report'] });

  async function run(key: string, call: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try { await call(); toast(ok, 'success'); refresh(); }
    catch (e: any) { toast(e.message || 'Could not do that', 'error'); }
    finally { setBusy(''); }
  }
  const statusRow = (t?: Tpl) => {
    if (!t) return null;
    const s = t.status ? STATUS[t.status] : null;
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${s?.cls ?? 'bg-slate-100 text-slate-600'}`}>{s?.text ?? 'Not submitted yet'}</span>
        {(!t.status || t.status === 'REJECTED') && <Button variant="gold" size="sm" className="gap-1.5" disabled={!!busy} onClick={() => run(`submit-${t.which}`, () => api.post(`/reporting/daily-report/team/${t.which}/submit`, {}), 'Submitted to Meta for review')}><Send className="h-3.5 w-3.5" />{busy === `submit-${t.which}` ? 'Submitting…' : 'Submit to Meta'}</Button>}
        {t.status === 'PENDING' && <Button variant="outline" size="sm" className="gap-1.5" disabled={!!busy} onClick={() => run(`sync-${t.which}`, () => api.post(`/reporting/daily-report/team/${t.which}/sync`, {}), 'Checked with Meta')}><RefreshCw className="h-3.5 w-3.5" />{busy === `sync-${t.which}` ? 'Checking…' : 'Check status'}</Button>}
        {t.status === 'REJECTED' && t.rejectionReason && <span className="text-xs text-red-700">Meta&apos;s reason: {t.rejectionReason}</span>}
      </div>
    );
  };
  const empApproved = data?.employee.status === 'APPROVED';
  const th = 'whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider';

  return (
    <section className="mb-5 space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-navy to-slate-900 p-5 text-white shadow-xl">
        <p className="text-xs font-bold uppercase tracking-widest text-gold">New daily work reports</p>
        <h2 className="mt-1 text-2xl font-bold">Every section: pending, done today, upcoming</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">Leads, Follow-ups, Callback requests, Failed WhatsApp, Packages &amp; Itinerary, Quotations, Invoices, Payment reminders, WhatsApp Inbox and Finance — one line each. The MD gets the whole team; each employee gets their own work and what is due tomorrow. They go out at the times set below.</p>
      </div>
      {isError && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">The work reports could not be loaded. Press Refresh and try again.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <p className="font-bold text-navy dark:text-white">1. Report to the MD — whole team</p>
          <p className="text-xs text-muted-foreground">Goes to the numbers set for the daily report, in place of the current layout once approved. Preview with today&apos;s real numbers:</p>
          {statusRow(data?.md)}
          <div className="mt-3"><Phone text={isLoading ? undefined : data?.md.message} /></div>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <p className="font-bold text-navy dark:text-white">2. Report to each employee — their own work</p>
          <p className="text-xs text-muted-foreground">Goes to each employee&apos;s own mobile number once a day, at the last time of the day you set. Example (first employee):</p>
          {statusRow(data?.employee)}
          <div className="mt-3"><Phone text={isLoading ? undefined : data?.employees[0]?.message ?? 'No employees yet.'} /></div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
          <div><p className="flex items-center gap-2 font-bold text-navy dark:text-white"><Users className="h-4 w-4 text-gold" />Employees who receive their report</p><p className="text-xs text-muted-foreground">Every employee is included automatically. Switch one off to stop their message; switch it on again any time.</p></div>
          <span className="text-xs font-semibold text-muted-foreground">{data ? `${data.employees.filter((e) => e.enabled && e.hasNumber).length} of ${data.employees.length} active` : ''}</span>
        </div>
        <div className="theme-scroll overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead className="bg-navy text-white"><tr>{['S.No', 'Employee', 'WhatsApp number', 'Pending', 'Done today', 'Upcoming', 'Last message', 'Active'].map((h) => <th key={h} className={th}>{h}</th>)}<th className={`${th} text-right`}>Actions</th></tr></thead>
            <tbody>
              {isLoading && <tr><td colSpan={9} className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</td></tr>}
              {data && !data.employees.length && <tr><td colSpan={9} className="px-4 py-6 text-center text-sm text-muted-foreground">No employees yet.</td></tr>}
              {data?.employees.map((e, i) => (
                <tr key={e.id} className="border-t border-border/60">
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="px-4 py-2.5"><p className="font-semibold text-navy dark:text-white">{e.name}</p><p className="text-[11px] capitalize text-muted-foreground">{e.role.replace(/_/g, ' ')}</p></td>
                  <td className="px-4 py-2.5 tabular-nums">{e.hasNumber ? e.number : <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">No mobile number in profile</span>}</td>
                  <td className="px-4 py-2.5"><span className={`rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${e.pending ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{e.pending}</span></td>
                  <td className="px-4 py-2.5 tabular-nums text-emerald-700">{e.done}</td>
                  <td className="px-4 py-2.5 tabular-nums text-amber-700">{e.upcoming}<span className="ml-1 text-[11px] text-muted-foreground">({e.tomorrow} tomorrow)</span></td>
                  <td className="px-4 py-2.5 text-xs">{e.lastStatus ? <span title={e.lastError ?? ''} className={e.lastStatus === 'failed' ? 'font-semibold text-red-600' : 'text-slate-600'}>{SENT[e.lastStatus] ?? e.lastStatus}{e.lastAt ? ` · ${new Date(e.lastAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}</span> : <span className="text-muted-foreground">Not sent yet</span>}</td>
                  <td className="px-4 py-2.5">
                    <button type="button" role="switch" aria-checked={e.enabled} aria-label={`${e.enabled ? 'Stop' : 'Start'} the report for ${e.name}`} disabled={!!busy}
                      onClick={() => run(`toggle-${e.id}`, () => api.post(`/reporting/daily-report/team/employees/${e.id}`, { enabled: !e.enabled }), e.enabled ? `Report switched off for ${e.name}` : `Report switched on for ${e.name}`)}
                      className={`relative h-6 w-11 rounded-full transition ${e.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${e.enabled ? 'left-[1.375rem]' : 'left-0.5'}`} /></button>
                    <span className={`ml-2 text-xs font-semibold ${e.enabled ? 'text-emerald-700' : 'text-slate-500'}`}>{e.enabled ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <button type="button" title="Preview this employee's message" aria-label={`Preview the message for ${e.name}`} onClick={() => setShowing(e)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-navy hover:border-gold"><Eye className="h-4 w-4" /></button>
                      <button type="button" title={empApproved ? 'Send this employee their report now' : 'Available once Meta approves the employee report'} aria-label={`Send the report to ${e.name} now`} disabled={!empApproved || !e.hasNumber || !!busy}
                        onClick={() => run(`send-${e.id}`, () => api.post(`/reporting/daily-report/team/employees/${e.id}/send`, {}), `Report sent to ${e.name}`)} className="grid h-8 w-8 place-items-center rounded-lg bg-gold text-navy hover:brightness-95 disabled:opacity-40"><Send className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t bg-muted/30 px-5 py-2.5 text-xs text-muted-foreground">The number is the employee&apos;s mobile number from User Management. Until Meta approves the two reports above, your current daily report keeps going out unchanged.</p>
      </div>

      {showing && createPortal(
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4" onClick={() => setShowing(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl" onClick={(ev) => ev.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div><h3 className="text-base font-bold text-navy">Message for {showing.name}</h3><p className="text-xs text-slate-500">With their real numbers as of now{showing.enabled ? '' : ' · currently switched off'}.</p></div>
              <button type="button" aria-label="Close" onClick={() => setShowing(null)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
            </div>
            <Phone text={showing.message} tall />
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-xs text-slate-500">{empApproved ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />Approved by Meta</> : 'Not being sent yet — waiting for Meta approval'}</span>
              <Button variant="outline" size="sm" onClick={() => setShowing(null)}>Close</Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
