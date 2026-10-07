'use client';
import { waNumber } from '@/lib/utils';

import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Moon, Plus, Send, Sun, Trash2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import {
  useDailyReportDeliveries, useDailyReportPreview, useDailyReportSettings, useSaveDailyReportSettings,
  useSendDailyReportNow, useSendDailyReportTest, useSubmitDailyReportTemplate, useSyncDailyReportTemplate,
} from '@/hooks/use-daily-report';

const SECTIONS = [
  { key: 'leadsToday', label: 'Leads', hint: 'New leads today' },
  { key: 'followUps', label: 'Follow-ups', hint: 'Done, Pending, Total' },
  { key: 'callbacks', label: 'Callback Requests', hint: 'Done, Pending, Total' },
  { key: 'failedWhatsapp', label: 'Failed WhatsApp', hint: 'Resolved, Needs attention, Total' },
  { key: 'itinerary', label: 'Packages & Itinerary', hint: 'Mapped, Not mapped, Total' },
  { key: 'quotations', label: 'Quotations', hint: 'Sent, Draft, Total' },
  { key: 'inbox', label: 'WhatsApp Inbox', hint: 'Handled, Unread, Total' },
  { key: 'finance', label: 'Finance', hint: 'Collected, Outstanding, Overdue' },
  { key: 'meta', label: 'Meta Quality', hint: 'Sent to Meta, Confirmed' },
];

const TEMPLATE_STYLE: Record<string, { label: string; chip: string }> = {
  APPROVED: { label: 'Approved', chip: 'bg-emerald-100 text-emerald-700' },
  PENDING: { label: 'Pending Meta review', chip: 'bg-amber-100 text-amber-700' },
  REJECTED: { label: 'Rejected', chip: 'bg-red-100 text-red-700' },
  PAUSED: { label: 'Paused', chip: 'bg-slate-100 text-slate-600' },
  DISABLED: { label: 'Disabled', chip: 'bg-slate-100 text-slate-600' },
};

const DELIVERY: Record<string, { label: string; cls: string }> = {
  read: { label: 'Read', cls: 'bg-emerald-100 text-emerald-700' },
  delivered: { label: 'Delivered', cls: 'bg-emerald-100 text-emerald-700' },
  sent: { label: 'Sent', cls: 'bg-sky-100 text-sky-700' },
  accepted: { label: 'Accepted — no delivery confirmation yet', cls: 'bg-amber-100 text-amber-700' },
  failed: { label: 'Failed', cls: 'bg-red-100 text-red-700' },
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// Owner's daily WhatsApp report. Three gated steps (who/when → what's in it → Meta approval), the
// real WhatsApp message on a phone on the right the whole time, and below, whether each number is
// actually receiving it -- from Meta's own delivery confirmations, not just "enabled".
export function DailyReportPanel() {
  const { toast } = useToast();
  const { data: settings } = useDailyReportSettings();
  const save = useSaveDailyReportSettings();
  const submitTemplate = useSubmitDailyReportTemplate();
  const syncTemplate = useSyncDailyReportTemplate();
  const sendNow = useSendDailyReportNow();
  const sendTest = useSendDailyReportTest();
  const { data: deliveries } = useDailyReportDeliveries();

  const [numbers, setNumbers] = useState<string[]>([]);
  const [newNumber, setNewNumber] = useState('');
  const [sendTimes, setSendTimes] = useState<string[]>(['20:00']);
  const [enabled, setEnabled] = useState(false);
  const [includedSections, setIncludedSections] = useState<string[]>(SECTIONS.map((s) => s.key));
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [step, setStep] = useState(1);
  const [maxStep, setMaxStep] = useState(1);
  const [testNumber, setTestNumber] = useState('');
  const [dark, setDark] = useState(false);
  const { data: preview, isFetching: previewLoading } = useDailyReportPreview(includedSections);

  if (settings && !loadedOnce) {
    setNumbers(settings.phoneNumbers);
    setSendTimes(settings.sendTimes.length ? settings.sendTimes : ['20:00']);
    setEnabled(settings.enabled);
    setIncludedSections(settings.includedSections?.length ? settings.includedSections : SECTIONS.map((s) => s.key));
    // Already set up before? Let them jump straight to any step.
    setMaxStep(settings.templateStatus ? 3 : settings.phoneNumbers.length ? 2 : 1);
    setLoadedOnce(true);
  }

  // While Meta is reviewing, check the status by itself every 30s.
  const pending = settings?.templateStatus === 'PENDING';
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => syncTemplate.mutate(), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const status = settings?.templateStatus ? TEMPLATE_STYLE[settings.templateStatus] : null;
  const go = (n: number) => { setStep(n); setMaxStep((m) => Math.max(m, n)); };

  async function saveAndGo(next: number) {
    try {
      await save.mutateAsync({ phoneNumbers: numbers, sendTimes, enabled, includedSections });
      toast('Saved', 'success');
      go(next);
    } catch (e: any) { toast(e.message || 'Could not save', 'error'); }
  }
  function addNumber() {
    const n = newNumber.trim();
    if (!n) return;
    if (!waNumber(n)) { toast('Enter a valid WhatsApp number, e.g. 06 12 34 56 78 or +33 6 12 34 56 78', 'error'); return; }
    setNumbers((list) => [...list, n]); setNewNumber('');
  }

  const STEPS = [{ n: 1, label: 'Numbers & send times' }, { n: 2, label: "What's in the report" }, { n: 3, label: 'Template approval & test' }];
  const theme = dark
    ? { frame: 'bg-[#0b141a]', head: 'bg-[#202c33]', bubble: 'bg-[#202c33] text-slate-100', time: 'text-slate-400', pill: 'bg-[#182229] text-slate-400' }
    : { frame: 'bg-[#efeae2]', head: 'bg-[#075e54]', bubble: 'bg-white text-slate-800', time: 'text-slate-400', pill: 'bg-white/80 text-slate-500' };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-navy to-slate-900 p-6 text-white shadow-xl">
        <p className="text-xs font-bold uppercase tracking-widest text-gold">Owner reporting</p>
        <h2 className="mt-2 text-2xl font-bold">Daily WhatsApp Report</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">Goes out at every time you set, to every number you add. Each figure is pulled live from that section's own data at send time.</p>
        <div className="mt-4 flex flex-wrap gap-3 text-xs">
          <span className="rounded-full bg-white/10 px-3 py-1 font-semibold">{numbers.length} number{numbers.length === 1 ? '' : 's'}</span>
          <span className="rounded-full bg-white/10 px-3 py-1 font-semibold">{sendTimes.join(', ')} IST</span>
          <span className={`rounded-full px-3 py-1 font-semibold ${enabled ? 'bg-emerald-400/20 text-emerald-300' : 'bg-white/10 text-slate-300'}`}>{enabled ? 'Automatic sending on' : 'Automatic sending off'}</span>
          {status && <span className={`rounded-full px-3 py-1 font-bold ${status.chip}`}>Template: {status.label}</span>}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {/* Stepper */}
          <div className="flex gap-2">
            {STEPS.map(({ n, label }) => (
              <button key={n} type="button" onClick={() => n <= maxStep && setStep(n)} disabled={n > maxStep}
                className={`flex-1 rounded-xl border px-3 py-3 text-left text-xs font-bold ${n === step ? 'border-gold bg-gold/10 text-navy shadow-sm' : n <= maxStep ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
                <span className={`mr-2 inline-grid h-5 w-5 place-items-center rounded-full ${n === step ? 'bg-gold text-navy' : n <= maxStep ? 'bg-emerald-500 text-white' : 'bg-slate-200'}`}>{n}</span>{label}
              </button>
            ))}
          </div>

          {step === 1 && (
            <section className="rounded-2xl border bg-white p-6 shadow-sm">
              <h3 className="text-lg font-bold text-navy">1. Who gets it, and when</h3>
              <div className="mt-4 grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>WhatsApp numbers</Label>
                  {numbers.map((n, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input value={n} readOnly className="bg-slate-50 font-mono" />
                      <button type="button" onClick={() => setNumbers((list) => list.filter((_, j) => j !== i))} className="rounded-lg p-2 text-red-500 hover:bg-red-50" aria-label="Remove number"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <Input value={newNumber} onChange={(e) => setNewNumber(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNumber()} placeholder="98XXXXXXXX" />
                    <button type="button" onClick={addNumber} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-slate-50"><Plus className="h-3.5 w-3.5" />Add</button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Send times — IST</Label>
                  {sendTimes.map((t, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-slate-400" />
                      <input type="time" value={t} onChange={(e) => setSendTimes((list) => list.map((x, j) => (j === i ? e.target.value : x)))} className="h-10 rounded-md border border-input bg-background px-2 text-sm" />
                      {sendTimes.length > 1 && <button type="button" onClick={() => setSendTimes((list) => list.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50" aria-label="Remove time"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </div>
                  ))}
                  <button type="button" onClick={() => setSendTimes((list) => [...list, '09:00'])} className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50"><Plus className="h-3.5 w-3.5" />Add another time</button>
                </div>
              </div>
              <label className="mt-5 flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
                Send automatically at these times
              </label>
              {enabled && settings?.templateStatus !== 'APPROVED' && <p className="mt-1 text-xs text-amber-700">Nothing will go out until the template is approved in step 3.</p>}
              <div className="mt-5 flex justify-end border-t pt-5">
                <Button variant="gold" onClick={() => saveAndGo(2)} disabled={save.isPending || !numbers.length}>{save.isPending ? 'Saving…' : 'Save & next'}</Button>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="rounded-2xl border bg-white p-6 shadow-sm">
              <h3 className="text-lg font-bold text-navy">2. What's in the report</h3>
              <p className="mt-1 text-sm text-slate-500">Tick a section to include it — the phone on the right updates as you go. A section you leave out still has its line (Meta fixes the template's slots) but says "Not included in this report".</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {SECTIONS.map((s) => {
                  const on = includedSections.includes(s.key);
                  return (
                    <label key={s.key} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${on ? 'border-gold/50 bg-gold/5' : 'border-slate-200 bg-slate-50 opacity-70'}`}>
                      <input type="checkbox" checked={on} onChange={() => setIncludedSections((list) => (on ? list.filter((k) => k !== s.key) : [...list, s.key]))} className="mt-0.5 h-4 w-4" />
                      <span><span className="block text-sm font-semibold text-navy">{s.label}</span><span className="text-xs text-slate-500">{s.hint}</span></span>
                    </label>
                  );
                })}
              </div>
              <div className="mt-5 flex justify-between border-t pt-5">
                <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
                <Button variant="gold" onClick={() => saveAndGo(3)} disabled={save.isPending || !includedSections.length}>{save.isPending ? 'Saving…' : 'Save & next'}</Button>
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="rounded-2xl border bg-white p-6 shadow-sm">
              <h3 className="text-lg font-bold text-navy">3. Template approval & test</h3>
              <p className="mt-1 text-sm text-slate-500">WhatsApp only allows business-initiated messages from an approved template. Submit once; Meta usually reviews within minutes to a few hours. This page checks the status by itself while it's pending.</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {status ? <span className={`rounded-full px-3 py-1 text-xs font-bold ${status.chip}`}>{status.label}</span> : <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">Not submitted yet</span>}
                {(!settings?.templateStatus || settings.templateStatus === 'REJECTED') && <Button size="sm" onClick={() => submitTemplate.mutate(undefined, { onSuccess: () => toast('Template submitted to Meta for review', 'success'), onError: (e: any) => toast(e.message || 'Could not submit', 'error') })} disabled={submitTemplate.isPending}>{submitTemplate.isPending ? 'Submitting…' : 'Submit for approval'}</Button>}
                {settings?.templateStatus && settings.templateStatus !== 'APPROVED' && <Button size="sm" variant="outline" onClick={() => syncTemplate.mutate(undefined, { onSuccess: () => toast('Checked with Meta', 'success'), onError: (e: any) => toast(e.message || 'Could not check', 'error') })} disabled={syncTemplate.isPending}>{syncTemplate.isPending ? 'Checking…' : 'Check status now'}</Button>}
              </div>
              {settings?.templateStatus === 'REJECTED' && settings.templateRejectionReason && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">Meta's reason: {settings.templateRejectionReason}</p>}

              <div className={`mt-5 rounded-xl border p-4 ${settings?.templateStatus === 'APPROVED' ? 'border-slate-200' : 'border-dashed border-slate-200 opacity-60'}`}>
                <p className="text-sm font-semibold text-navy">Send a test</p>
                <p className="text-xs text-slate-500">Sends today's real report to one number only — it doesn't count as the day's send. {settings?.templateStatus !== 'APPROVED' && 'Available once the template is approved.'}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Input value={testNumber} onChange={(e) => setTestNumber(e.target.value)} placeholder="98XXXXXXXX" className="max-w-[14rem]" disabled={settings?.templateStatus !== 'APPROVED'} />
                  <Button size="sm" variant="outline" disabled={settings?.templateStatus !== 'APPROVED' || !testNumber.trim() || sendTest.isPending}
                    onClick={() => sendTest.mutate(testNumber.trim(), { onSuccess: (r) => toast(r.sent ? 'Test sent — check that phone' : `Test failed: ${r.failed[0] ?? 'unknown error'}`, r.sent ? 'success' : 'error'), onError: (e: any) => toast(e.message || 'Could not send', 'error') })}>
                    <Send className="mr-1.5 h-3.5 w-3.5" />{sendTest.isPending ? 'Sending…' : 'Send test'}
                  </Button>
                  <Button size="sm" disabled={settings?.templateStatus !== 'APPROVED' || !numbers.length || sendNow.isPending}
                    onClick={() => sendNow.mutate(undefined, { onSuccess: (r) => toast(`Sent to ${r.sent} number(s)${r.failed.length ? `, ${r.failed.length} failed` : ''}`, r.failed.length ? 'error' : 'success'), onError: (e: any) => toast(e.message || 'Could not send', 'error') })}>
                    {sendNow.isPending ? 'Sending…' : `Send to all ${numbers.length} now`}
                  </Button>
                </div>
              </div>
              <div className="mt-5 flex justify-between border-t pt-5"><Button variant="outline" onClick={() => setStep(2)}>Back</Button></div>
            </section>
          )}
        </div>

        {/* Phone preview: the exact WhatsApp message, visible at every step. */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Live preview {previewLoading && <span className="font-normal normal-case text-slate-400">· updating…</span>}</p>
            <button type="button" onClick={() => setDark((d) => !d)} className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">{dark ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}{dark ? 'Light' : 'Dark'}</button>
          </div>
          <div className="mx-auto w-full max-w-[300px] rounded-[2.5rem] border-[10px] border-slate-900 bg-slate-900 shadow-2xl">
            <div className={`relative overflow-hidden rounded-[1.75rem] ${theme.frame}`}>
              <div className="absolute left-1/2 top-0 z-10 h-5 w-28 -translate-x-1/2 rounded-b-2xl bg-slate-900" />
              <div className={`flex items-center gap-2 px-4 pb-2 pt-6 text-white ${theme.head}`}>
                <div className="grid h-8 w-8 place-items-center rounded-full bg-white/20 text-xs font-bold">TR</div>
                <div><p className="text-sm font-semibold leading-tight">Errances Voyages</p><p className="text-[10px] text-white/70">WhatsApp Business</p></div>
              </div>
              <div className="max-h-[30rem] min-h-[22rem] overflow-y-auto p-3">
                <p className={`mx-auto mb-2 w-fit rounded-md px-2 py-0.5 text-[10px] ${theme.pill}`}>TODAY</p>
                <div className={`w-[92%] rounded-lg rounded-tl-none p-3 text-xs shadow-sm ${theme.bubble}`}>
                  {preview?.message
                    ? <p className="whitespace-pre-wrap leading-relaxed">{preview.message}</p>
                    : <p className={theme.time}>Loading today's numbers…</p>}
                  <p className={`mt-1.5 text-right text-[10px] ${theme.time}`}>{sendTimes[0] || '20:00'}</p>
                </div>
              </div>
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] text-slate-400">Exactly the approved template, filled with today's live numbers.</p>
        </aside>
      </div>

      {/* Is each number actually receiving it? */}
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="border-b px-5 py-4">
          <h3 className="font-bold text-navy">Delivery by number — last 7 days</h3>
          <p className="text-xs text-slate-500">From WhatsApp's own delivery confirmations for each message, not just whether sending is switched on.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5">Number</th><th className="px-3 py-2.5">Last sent</th><th className="px-3 py-2.5">Last status</th>
                <th className="px-3 py-2.5 text-center">Sent</th><th className="px-3 py-2.5 text-center">Delivered</th><th className="px-3 py-2.5 text-center">Read</th><th className="px-5 py-2.5 text-center">Failed</th>
              </tr>
            </thead>
            <tbody>
              {!(deliveries?.data ?? []).length && <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-400">No numbers saved yet.</td></tr>}
              {(deliveries?.data ?? []).map((d) => {
                const st = d.lastStatus ? DELIVERY[d.lastStatus] ?? { label: d.lastStatus, cls: 'bg-slate-100 text-slate-600' } : null;
                const ok = d.lastStatus === 'delivered' || d.lastStatus === 'read';
                return (
                  <tr key={d.phone} className="border-b last:border-0">
                    <td className="px-5 py-3 font-mono">{d.phone}</td>
                    <td className="px-3 py-3 text-xs text-slate-600">{fmt(d.lastAt)}{d.lastTrigger === 'test' && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-500">test</span>}</td>
                    <td className="px-3 py-3">
                      {st ? <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${st.cls}`}>{ok ? <CheckCircle2 className="h-3 w-3" /> : d.lastStatus === 'failed' ? <XCircle className="h-3 w-3" /> : null}{st.label}</span> : <span className="text-xs text-slate-400">Never sent</span>}
                      {d.lastStatus === 'failed' && d.lastError && <p className="mt-1 max-w-xs text-[11px] text-red-600">{d.lastError}</p>}
                    </td>
                    <td className="px-3 py-3 text-center">{d.sends}</td>
                    <td className="px-3 py-3 text-center text-emerald-700">{d.delivered}</td>
                    <td className="px-3 py-3 text-center text-emerald-700">{d.read}</td>
                    <td className={`px-5 py-3 text-center ${d.failed ? 'font-bold text-red-600' : ''}`}>{d.failed}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t px-5 py-2.5 text-[11px] text-slate-400">"Accepted — no delivery confirmation yet" means WhatsApp took the message but hasn't reported back. While WhatsApp replies aren't reaching the CRM (see the alert banner), confirmations can't arrive either.</p>
      </section>
    </div>
  );
}
