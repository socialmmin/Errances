'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useAuthStore } from '@/store/auth-store';
import { useAudienceCounts, useBackfillMetaIds, useCapiStatus, useMetaFunnel, useMetaIdCoverage, useSetCapiMode } from '@/hooks/use-meta-quality';
import { useMetaLearning } from '@/hooks/use-meta-learning';
import { LearningLoop } from '@/components/meta/learning-loop';
import { StatusGuide } from '@/components/leads/status-guide';
import { tr, locale } from '@/i18n';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
const inr = (n: number | null | undefined) => (n == null ? '—' : `₹${Math.round(n).toLocaleString(locale())}`);

const SEGMENTS: { key: string; label: string; hint: string }[] = [
  { key: 'booked', label: 'Booked customers', hint: 'Source for the lookalike audience' },
  { key: 'advance', label: 'Advance paid', hint: 'Committed buyers' },
  { key: 'qualified', label: 'Qualified and beyond', hint: 'Confirmed requirement or better' },
  { key: 'bad', label: 'Bad leads', hint: 'Use as an exclusion' },
  { key: 'invalid', label: 'Invalid / duplicate', hint: 'Always exclude' },
];

export default function MetaQualityPage() {
  const { toast } = useToast();
  const token = useAuthStore((s) => s.accessToken);
  const { data: funnel, isLoading } = useMetaFunnel();
  const { data: cover } = useMetaIdCoverage();
  const { data: capi } = useCapiStatus();
  const { data: audiences } = useAudienceCounts();
  const { data: learning } = useMetaLearning();
  const setMode = useSetCapiMode();
  const backfill = useBackfillMetaIds();
  const [testCode, setTestCode] = useState('');

  const rows = funnel?.data ?? [];
  const total = rows.reduce((s, r) => ({ leads: s.leads + r.leads, valid: s.valid + r.valid, good: s.good + r.good, bad: s.bad + r.bad, qualified: s.qualified + r.qualified, quotation: s.quotation + r.quotation, advance: s.advance + r.advance, booked: s.booked + r.booked, revenue: s.revenue + r.revenue, spend: s.spend + (r.spend ?? 0) }), { leads: 0, valid: 0, good: 0, bad: 0, qualified: 0, quotation: 0, advance: 0, booked: 0, revenue: 0, spend: 0 });

  async function download(segment: string) {
    try {
      const res = await fetch(`${API_URL}/integrations/meta/audiences/${segment}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Could not download');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `errance-voyages-${segment}.csv`; a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) { toast(e.message || tr("Download failed"), 'error'); }
  }

  const evCount = (name: string, status: string) => capi?.events.find((e) => e.event_name === name && e.status === status)?.n ?? 0;

  return (
    <div className="space-y-5 pb-8">
      <section className="rounded-2xl bg-gradient-to-r from-navy via-navy-900 to-navy-800 p-6 text-white shadow-lg">
        <p className="text-xs font-bold uppercase tracking-[.2em] text-gold">{tr("Ads → leads → customers")}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{tr("Meta Quality")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-300">{tr("Which campaigns bring leads that actually turn into customers, and what the CRM tells Meta about them. Numbers below cover only leads that came from a Meta campaign — the Leads page total also includes other sources (social media, direct, etc.), which is why the two counts differ.")}</p>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[['Meta leads', total.leads], ['Sent to Meta', learning?.eventsSentTotal ?? '…'], ['Meta confirms', learning?.metaConfirmed.available ? Object.values(learning.metaConfirmed.totals).reduce((s, n) => s + n, 0) : '—'], ['Good quality', total.good]].map(([l, v]) => (
            <div key={String(l)} className="rounded-xl border-2 border-gold/30 bg-white/10 p-3"><p className="text-2xl font-bold text-gold">{v}</p><p className="text-xs text-slate-300">{tr(l)}</p></div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[['Spend', inr(total.spend)], ['Qualified', total.qualified], ['Advance paid', total.advance], ['Booked', total.booked]].map(([l, v]) => (
            <div key={String(l)} className="rounded-xl border border-white/10 bg-white/5 p-3"><p className="text-2xl font-bold text-gold">{v}</p><p className="text-xs text-slate-300">{tr(l)}</p></div>
          ))}
        </div>
      </section>

      <StatusGuide />

      <LearningLoop />

      {/* funnel */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-4"><h2 className="font-bold text-navy dark:text-white">{tr("Funnel by campaign")}</h2><p className="text-xs text-muted-foreground">{tr("Leads → valid → good → qualified → quotation → advance → booked. Spend is Meta's lifetime spend for the campaign.")}{funnel?.spendWithoutCrmLeads ? tr(" {value} was spent on older campaigns that have no leads in the CRM.", { value: inr(funnel.spendWithoutCrmLeads) }) : ''}{funnel?.spendError ? tr(" (Spend unavailable: {spendError})", { spendError: funnel.spendError }) : ''}</p></div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-gold text-xs uppercase tracking-wide text-white">
              <tr>{['Campaign', 'Spend', 'Leads', 'Valid', 'Good', 'Qualified', 'Quote', 'Advance', 'Booked', 'Revenue', 'Cost / lead', 'Cost / good', 'Cost / booking', 'ROAS'].map((h, i) => <th key={h} className={`px-3 py-3 ${i ? 'text-right' : ''}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={14} className="p-8 text-center text-muted-foreground">{tr("Loading…")}</td></tr>}
              {rows.map((r) => (
                <tr key={r.campaign} className="border-b border-border last:border-0 hover:bg-gold/5">
                  <td className="max-w-[18rem] truncate px-3 py-2.5 font-semibold text-navy dark:text-white" title={r.campaign}>{r.campaign}</td>
                  <td className="px-3 py-2.5 text-right">{inr(r.spend)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold">{r.leads}</td>
                  <td className="px-3 py-2.5 text-right">{r.valid}</td>
                  <td className="px-3 py-2.5 text-right text-emerald-700">{r.good}</td>
                  <td className="px-3 py-2.5 text-right">{r.qualified}</td>
                  <td className="px-3 py-2.5 text-right">{r.quotation}</td>
                  <td className="px-3 py-2.5 text-right">{r.advance}</td>
                  <td className="px-3 py-2.5 text-right font-semibold">{r.booked}</td>
                  <td className="px-3 py-2.5 text-right">{inr(r.revenue)}</td>
                  <td className="px-3 py-2.5 text-right">{inr(r.cpl)}</td>
                  <td className="px-3 py-2.5 text-right">{inr(r.costPerGood)}</td>
                  <td className="px-3 py-2.5 text-right">{inr(r.costPerBooking)}</td>
                  <td className="px-3 py-2.5 text-right">{r.roas ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Meta connection */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-bold text-navy dark:text-white">{tr("Sending outcomes to Meta")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{tr("Qualified, Quotation Sent, Advance Paid and Booked go to your dataset")}{' '}{capi?.datasetId ? `(${capi.datasetId})` : ''}{' '}{tr("as successes. Invalid Number, Wrong Number, Duplicate, Not Interested, No Response, Just Checking and Lost go as \"Disqualified\" — so Meta learns what a bad lead looks like too, not just the good ones. Leads still in progress (Neutral) are never sent either way.")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{tr("Mode:")}</span>
            {(['off', 'test', 'live'] as const).map((m) => (
              <button key={m} type="button" disabled={setMode.isPending}
                onClick={() => {
                  if (m === 'test' && !testCode.trim() && !capi?.testEventCode) { toast(tr("Paste the test event code from Events Manager → Test events first"), 'error'); return; }
                  if (m === 'live' && !window.confirm('Send real outcomes to Meta now? Confirm you have seen the test events arrive in Events Manager.')) return;
                  setMode.mutate({ mode: m, testEventCode: testCode.trim() || undefined }, { onSuccess: () => toast(tr("Meta sending is now {value}", { value: m.toUpperCase() }), 'success'), onError: (e: any) => toast(e.message || tr("Could not change mode"), 'error') });
                }}
                className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase ${capi?.mode === m ? (m === 'live' ? 'bg-emerald-600 text-white' : m === 'test' ? 'bg-amber-400 text-navy' : 'bg-slate-700 text-white') : 'border border-border text-muted-foreground hover:bg-muted'}`}>{m}</button>
            ))}
          </div>
          <input value={testCode} onChange={(e) => setTestCode(e.target.value)} placeholder={capi?.testEventCode ? tr("Test event code: {testEventCode}", { testEventCode: capi.testEventCode }) : tr("Test event code (from Events Manager → Test events)")} className="mt-3 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-gold" />
          <div className="mt-3 overflow-hidden rounded-lg border border-border text-xs">
            <table className="w-full"><thead className="bg-muted/50 text-muted-foreground"><tr><th className="px-3 py-1.5 text-left">{tr("Event")}</th><th className="px-3 py-1.5 text-right">{tr("Waiting")}</th><th className="px-3 py-1.5 text-right">{tr("Test sent")}</th><th className="px-3 py-1.5 text-right">{tr("Sent")}</th><th className="px-3 py-1.5 text-right">{tr("Failed")}</th></tr></thead>
              <tbody>{['Qualified', 'QuotationSent', 'AdvancePaid', 'Booked', 'Disqualified'].map((n) => <tr key={n} className="border-t border-border"><td className="px-3 py-1.5 font-medium">{n}</td><td className="px-3 py-1.5 text-right">{evCount(n, 'pending')}</td><td className="px-3 py-1.5 text-right">{evCount(n, 'test_sent')}</td><td className="px-3 py-1.5 text-right">{evCount(n, 'sent')}</td><td className="px-3 py-1.5 text-right text-red-600">{evCount(n, 'failed')}</td></tr>)}</tbody></table>
          </div>
          {!!capi?.recentErrors?.length && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{tr("Last error:")}{' '}{capi.recentErrors[0].event_name} — {capi.recentErrors[0].response}</p>}
          <p className="mt-2 text-[11px] text-muted-foreground">{tr("Off: nothing is sent, outcomes just wait. Test: events appear only under Events Manager → Test events. Live: real events, Meta learns from them.")}</p>
        </section>

        {/* Meta ids + audiences */}
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div>
            <h2 className="font-bold text-navy dark:text-white">{tr("Meta IDs on every lead")}</h2>
            {cover && (
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                {[['Meta leads', cover.meta_leads], ['With lead ID', cover.with_lead_id], ['Missing lead ID', cover.missing_lead_id], ['With campaign', cover.with_campaign], ['With ad set', cover.with_adset], ['With ad', cover.with_ad]].map(([l, v]) => <div key={String(l)} className="rounded-lg bg-muted/40 p-2"><p className="text-lg font-bold text-navy dark:text-white">{v}</p><p className="text-muted-foreground">{tr(l)}</p></div>)}
              </div>
            )}
            <Button size="sm" variant="outline" className="mt-2" disabled={backfill.isPending} onClick={() => backfill.mutate(undefined, { onSuccess: (r) => toast(tr("Checked {candidates} leads: {filled} filled, {failed} not available from Meta", { candidates: r.candidates, filled: r.filled, failed: r.failed }), 'success'), onError: (e: any) => toast(e.message || tr("Failed"), 'error') })}>{backfill.isPending ? tr("Fetching from Meta…") : tr("Fill missing IDs from Meta")}</Button>
          </div>
          <div>
            <h2 className="font-bold text-navy dark:text-white">{tr("Audience lists for Ads Manager")}</h2>
            <p className="text-xs text-muted-foreground">{tr("Download and upload under Ads Manager → Audiences → Custom audience → Customer list. Use only contacts you are allowed to advertise to.")}</p>
            <div className="mt-2 divide-y divide-border rounded-lg border border-border">
              {SEGMENTS.map((s) => (
                <div key={s.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1"><p className="font-semibold">{tr(s.label)} <span className="text-muted-foreground">({audiences?.[s.key] ?? '…'})</span></p><p className="text-[11px] text-muted-foreground">{s.hint}</p></div>
                  <Button size="sm" variant="outline" disabled={!(audiences?.[s.key])} onClick={() => download(s.key)}><Download className="mr-1 h-3.5 w-3.5" />{tr("CSV")}</Button>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
