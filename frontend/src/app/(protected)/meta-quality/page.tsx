'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useAuthStore } from '@/store/auth-store';
import { useAudienceCounts, useBackfillMetaIds, useCapiStatus, useMetaEventLog, useMetaFunnel, useMetaIdCoverage, useRetryMetaEvent, useSetCapiMode } from '@/hooks/use-meta-quality';
import { useMetaLearning } from '@/hooks/use-meta-learning';
import { StatusGuide } from '@/components/leads/status-guide';
import { leadStatusLabel } from '@/lib/lead-statuses';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
const inr = (n: number | null | undefined) => (n == null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`);

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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const rows = funnel?.data ?? [];
  const total = rows.reduce((s, r) => ({ leads: s.leads + r.leads, valid: s.valid + r.valid, good: s.good + r.good, bad: s.bad + r.bad, neutral: s.neutral + (r.neutral ?? 0), qualified: s.qualified + r.qualified, quotation: s.quotation + r.quotation, advance: s.advance + r.advance, booked: s.booked + r.booked, revenue: s.revenue + r.revenue, spend: s.spend + (r.spend ?? 0) }), { leads: 0, valid: 0, good: 0, bad: 0, neutral: 0, qualified: 0, quotation: 0, advance: 0, booked: 0, revenue: 0, spend: 0 });
  // "Meta confirms" is a count of Meta-side CAPI events (Lead, Qualified, ... can be several per
  // lead), not leads -- so it isn't the same denominator as total.leads and "not yet read" can't
  // be a clean subtraction. Shown as its own number with that caveat, not tallied against the total.
  const metaConfirmedTotal = learning?.metaConfirmed.available ? Object.values(learning.metaConfirmed.totals).reduce((s, n) => s + n, 0) : null;

  async function download(segment: string) {
    try {
      const res = await fetch(`${API_URL}/integrations/meta/audiences/${segment}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Could not download');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `errances-voyages-${segment}.csv`; a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) { toast(e.message || 'Download failed', 'error'); }
  }

  const evCount = (name: string, status: string) => capi?.events.find((e) => e.event_name === name && e.status === status)?.n ?? 0;

  return (
    <div className="space-y-5 pb-8">
      <section className="rounded-2xl bg-gradient-to-r from-navy via-navy-900 to-navy-800 p-6 text-white shadow-lg">
        <p className="text-xs font-bold uppercase tracking-[.2em] text-gold">Ads → leads → customers</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Meta Quality</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-300">Only leads that came from a Meta campaign are counted below — the Leads page total also includes other sources. "Meta confirms" is pulled live from Meta's own dataset statistics, not our send log — it is Meta's own number, and it counts events (Lead, Qualified, ...), not leads, so it won't tally against the totals below one-to-one.</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border-2 border-gold/30 bg-white/10 p-4"><p className="text-3xl font-bold text-gold">{total.leads}</p><p className="text-xs text-slate-300">Total Meta leads</p></div>
          <div className="rounded-xl border-2 border-gold/30 bg-white/10 p-4"><p className="text-3xl font-bold text-gold">{metaConfirmedTotal ?? '—'}</p><p className="text-xs text-slate-300">Meta confirms (events read by Meta)</p></div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4"><p className="text-2xl font-bold text-emerald-300">{total.good}</p><p className="text-xs text-slate-300">Positive (good)</p></div>
          <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-4"><p className="text-2xl font-bold text-red-300">{total.bad}</p><p className="text-xs text-slate-300">Negative (bad)</p></div>
          <div className="rounded-xl border border-slate-400/30 bg-slate-400/10 p-4"><p className="text-2xl font-bold text-slate-300">{total.neutral}</p><p className="text-xs text-slate-300">Neutral</p></div>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">{total.good + total.bad + total.neutral} of {total.leads} leads have a quality rating yet.</p>
      </section>

      <StatusGuide />

      {/* funnel */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-4"><h2 className="font-bold text-navy dark:text-white">Funnel by campaign</h2><p className="text-xs text-muted-foreground">Leads → valid → good / neutral / bad at a glance below. Click "Details" on a row for the qualified → quotation → advance → booked breakdown and revenue. Spend is Meta's lifetime spend for the campaign.{funnel?.spendWithoutCrmLeads ? ` ${inr(funnel.spendWithoutCrmLeads)} was spent on older campaigns that have no leads in the CRM.` : ''}{funnel?.spendError ? ` (Spend unavailable: ${funnel.spendError})` : ''}</p></div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-navy text-xs uppercase tracking-wide text-slate-300">
              <tr>{['Campaign', 'Spend', 'Leads', 'Valid', 'Good', 'Neutral', 'Bad', 'Cost / lead', 'Cost / good', ''].map((h, i) => <th key={h || 'expand'} className={`px-3 py-3 ${i && h ? 'text-right' : ''}`} title={h === 'Neutral' ? "Not yet marked good or bad -- still needs a follow-up/status update before Meta learns anything from it" : h === 'Bad' ? 'Disqualified -- wrong number, duplicate, not interested, lost, etc.' : undefined}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">Loading…</td></tr>}
              {rows.map((r) => {
                const open = expanded.has(r.campaign);
                return (
                <Fragment key={r.campaign}>
                <tr className="border-b border-border last:border-0 hover:bg-gold/5">
                  <td className="max-w-[18rem] truncate px-3 py-2.5 font-semibold text-navy dark:text-white" title={r.campaign}>{r.campaign}</td>
                  <td className="px-3 py-2.5 text-right">{inr(r.spend)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold">{r.leads}</td>
                  <td className="px-3 py-2.5 text-right">{r.valid}</td>
                  <td className="px-3 py-2.5 text-right text-emerald-700">{r.good}</td>
                  <td className="px-3 py-2.5 text-right text-amber-600" title="Still needs a status update -- not counted as good or bad yet">{r.neutral}</td>
                  <td className="px-3 py-2.5 text-right text-red-600">{r.bad}</td>
                  <td className="px-3 py-2.5 text-right">{inr(r.cpl)}</td>
                  <td className="px-3 py-2.5 text-right">{inr(r.costPerGood)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button type="button" onClick={() => setExpanded((s) => { const n = new Set(s); n.has(r.campaign) ? n.delete(r.campaign) : n.add(r.campaign); return n; })} className="text-xs font-semibold text-navy underline dark:text-white">{open ? 'Hide' : 'Details'}</button>
                  </td>
                </tr>
                {open && (
                  <tr key={`${r.campaign}-details`} className="border-b border-border bg-muted/30 last:border-0">
                    <td colSpan={10} className="px-3 py-3">
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4 lg:grid-cols-7">
                        <div><p className="text-[10px] font-bold uppercase text-muted-foreground">Qualified</p><p className="text-sm font-semibold text-navy dark:text-white">{r.qualified}</p></div>
                        <div><p className="text-[10px] font-bold uppercase text-muted-foreground">Quote</p><p className="text-sm font-semibold text-navy dark:text-white">{r.quotation}</p></div>
                        <div><p className="text-[10px] font-bold uppercase text-muted-foreground">Advance</p><p className="text-sm font-semibold text-navy dark:text-white">{r.advance}</p></div>
                        <div><p className="text-[10px] font-bold uppercase text-muted-foreground">Booked</p><p className="text-sm font-semibold text-navy dark:text-white">{r.booked}</p></div>
                        <div><p className="text-[10px] font-bold uppercase text-muted-foreground">Revenue</p><p className="text-sm font-semibold text-navy dark:text-white">{inr(r.revenue)}</p></div>
                        <div><p className="text-[10px] font-bold uppercase text-muted-foreground">Cost / booking</p><p className="text-sm font-semibold text-navy dark:text-white">{inr(r.costPerBooking)}</p></div>
                        <div><p className="text-[10px] font-bold uppercase text-muted-foreground">ROAS</p><p className="text-sm font-semibold text-navy dark:text-white">{r.roas ?? '—'}</p></div>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Meta connection */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-bold text-navy dark:text-white">Sending outcomes to Meta</h2>
          <p className="mt-1 text-xs text-muted-foreground">Every real Meta lead gets a "Lead" event the moment it enters the CRM, so Meta has 100% coverage from day one. Qualified, Quotation Sent, Advance Paid and Booked follow as successes. Invalid Number, Wrong Number, Duplicate, Not Interested, No Response, Just Checking and Lost follow as "Disqualified" — so Meta learns what a bad lead looks like too, not just the good ones.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">Mode:</span>
            {(['off', 'test', 'live'] as const).map((m) => (
              <button key={m} type="button" disabled={setMode.isPending}
                onClick={() => {
                  if (m === 'test' && !testCode.trim() && !capi?.testEventCode) { toast('Paste the test event code from Events Manager → Test events first', 'error'); return; }
                  if (m === 'live' && !window.confirm('Send real outcomes to Meta now? Confirm you have seen the test events arrive in Events Manager.')) return;
                  setMode.mutate({ mode: m, testEventCode: testCode.trim() || undefined }, { onSuccess: () => toast(`Meta sending is now ${m.toUpperCase()}`, 'success'), onError: (e: any) => toast(e.message || 'Could not change mode', 'error') });
                }}
                className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase ${capi?.mode === m ? (m === 'live' ? 'bg-emerald-600 text-white' : m === 'test' ? 'bg-amber-400 text-navy' : 'bg-slate-700 text-white') : 'border border-border text-muted-foreground hover:bg-muted'}`}>{m}</button>
            ))}
          </div>
          <input value={testCode} onChange={(e) => setTestCode(e.target.value)} placeholder={capi?.testEventCode ? `Test event code: ${capi.testEventCode}` : 'Test event code (from Events Manager → Test events)'} className="mt-3 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-gold" />
          <div className="mt-3 overflow-hidden rounded-lg border border-border text-xs">
            <table className="w-full"><thead className="bg-muted/50 text-muted-foreground"><tr><th className="px-3 py-1.5 text-left">Event</th><th className="px-3 py-1.5 text-right">Waiting</th><th className="px-3 py-1.5 text-right">Test sent</th><th className="px-3 py-1.5 text-right">Sent</th><th className="px-3 py-1.5 text-right">Failed</th></tr></thead>
              <tbody>{['Lead', 'Qualified', 'QuotationSent', 'AdvancePaid', 'Booked', 'Disqualified'].map((n) => <tr key={n} className="border-t border-border"><td className="px-3 py-1.5 font-medium">{n}</td><td className="px-3 py-1.5 text-right">{evCount(n, 'pending')}</td><td className="px-3 py-1.5 text-right">{evCount(n, 'test_sent')}</td><td className="px-3 py-1.5 text-right">{evCount(n, 'sent')}</td><td className="px-3 py-1.5 text-right text-red-600">{evCount(n, 'failed')}</td></tr>)}</tbody></table>
          </div>
          {!!capi?.recentErrors?.length && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">Last error: {capi.recentErrors[0].event_name} — {capi.recentErrors[0].response}</p>}
          <p className="mt-2 text-[11px] text-muted-foreground">Off: nothing is sent, outcomes just wait. Test: events appear only under Events Manager → Test events. Live: real events, Meta learns from them.</p>
        </section>

        {/* Meta ids + audiences */}
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div>
            <h2 className="font-bold text-navy dark:text-white">Meta IDs on every lead</h2>
            {cover && (
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                {[['Meta leads', cover.meta_leads], ['With lead ID', cover.with_lead_id], ['Missing lead ID', cover.missing_lead_id], ['With campaign', cover.with_campaign], ['With ad set', cover.with_adset], ['With ad', cover.with_ad]].map(([l, v]) => <div key={String(l)} className="rounded-lg bg-muted/40 p-2"><p className="text-lg font-bold text-navy dark:text-white">{v}</p><p className="text-muted-foreground">{l}</p></div>)}
              </div>
            )}
            <Button size="sm" variant="outline" className="mt-2" disabled={backfill.isPending} onClick={() => backfill.mutate(undefined, { onSuccess: (r) => toast(`Checked ${r.candidates} leads: ${r.filled} filled, ${r.failed} not available from Meta`, 'success'), onError: (e: any) => toast(e.message || 'Failed', 'error') })}>{backfill.isPending ? 'Fetching from Meta…' : 'Fill missing IDs from Meta'}</Button>
          </div>
          <div>
            <h2 className="font-bold text-navy dark:text-white">Audience lists for Ads Manager</h2>
            <p className="text-xs text-muted-foreground">Download and upload under Ads Manager → Audiences → Custom audience → Customer list. Use only contacts you are allowed to advertise to.</p>
            <div className="mt-2 divide-y divide-border rounded-lg border border-border">
              {SEGMENTS.map((s) => (
                <div key={s.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1"><p className="font-semibold">{s.label} <span className="text-muted-foreground">({audiences?.[s.key] ?? '…'})</span></p><p className="text-[11px] text-muted-foreground">{s.hint}</p></div>
                  <Button size="sm" variant="outline" disabled={!(audiences?.[s.key])} onClick={() => download(s.key)}><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <MetaCategoryLegend />

      <PerLeadMetaLog />
    </div>
  );
}

const CATEGORY_ROWS: { category: string; tone: string; statuses: string; meaning: string }[] = [
  { category: 'Lead', tone: 'bg-slate-100 text-slate-700', statuses: 'Every lead, the moment it enters the CRM', meaning: 'Baseline signal so Meta has 100% coverage, regardless of outcome' },
  { category: 'Qualified / QuotationSent / AdvancePaid / Booked', tone: 'bg-emerald-100 text-emerald-700', statuses: 'Qualified, Quotation Sent, Advance Paid, Booking Confirmed / Won', meaning: 'Good — a real, progressing customer' },
  { category: 'Disqualified', tone: 'bg-red-100 text-red-700', statuses: 'Invalid Number, Wrong Number, Duplicate, Not Interested, No Response, Just Checking, Lost', meaning: 'Bad — tells Meta what NOT to target more of' },
  { category: '(nothing sent yet)', tone: 'bg-amber-100 text-amber-700', statuses: 'New, Contacted, Follow-up', meaning: 'Neutral — still in progress, only has the baseline "Lead" event so far' },
];

// The plain-language key to the table below: which CRM status words land in which Meta category.
function MetaCategoryLegend() {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-5 py-4">
        <h2 className="font-bold text-navy dark:text-white">What each Meta category means</h2>
        <p className="text-xs text-muted-foreground">Every CRM status word falls into exactly one of these when it's sent to Meta.</p>
      </div>
      <div className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2">Sent to Meta as</th><th className="px-3 py-2">Which CRM lead statuses</th><th className="px-3 py-2">What it means</th></tr></thead>
          <tbody>
            {CATEGORY_ROWS.map((r) => (
              <tr key={r.category} className="border-t border-border">
                <td className="px-3 py-2"><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${r.tone}`}>{r.category}</span></td>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{r.statuses}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border bg-muted/30 px-5 py-3 text-xs text-muted-foreground">
        <p className="font-semibold text-navy dark:text-white">To cross-check this yourself in your Facebook Ads account</p>
        <p className="mt-1">Meta Events Manager → Data sources → your configured Meta dataset name → Overview (Live mode) or Test events (Test mode) → filter by event name (Lead, Qualified, QuotationSent, AdvancePaid, Booked, Disqualified). The count Meta shows there should match the "Meta confirms" number on this page — that's the same number, pulled the same way.</p>
      </div>
    </section>
  );
}

const RECEIVED_TABS = [['all', 'All'], ['received', 'Received'], ['not_received', 'Not received']] as const;

// One row per lead: its current CRM status (set by your team), what was sent to Meta to
// represent that status, and whether it was actually received -- taken from our own send log
// (Meta's ingestion endpoint returned success), since Meta exposes no per-lead read-receipt
// lookup of its own. Filter to see exactly which leads still need attention.
function PerLeadMetaLog() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<'all' | 'received' | 'not_received'>('all');
  const [campaign, setCampaign] = useState('all');
  const { data: log } = useMetaEventLog(filter === 'all' ? undefined : filter);
  const retry = useRetryMetaEvent();
  const allRows = log?.data ?? [];
  const campaigns = Array.from(new Set(allRows.map((r) => r.campaign_name))).sort();
  const rows = campaign === 'all' ? allRows : allRows.filter((r) => r.campaign_name === campaign);

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-navy dark:text-white">Lead-by-lead: what Meta was told</h2>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">{rows.length} of {allRows.length}</span>
        </div>
        <p className="text-xs text-muted-foreground">Sent automatically, no manual step. "Received" means Meta's own ingestion endpoint accepted it — Meta gives no per-lead read receipt after the fact, so this is the real, honest answer per lead.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {RECEIVED_TABS.map(([key, label]) => <button key={key} onClick={() => setFilter(key)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${filter === key ? 'bg-gold text-navy' : 'bg-muted text-muted-foreground'}`}>{label}</button>)}
          <select value={campaign} onChange={(e) => setCampaign(e.target.value)} className="h-8 rounded-lg border border-border bg-background px-2 text-xs font-semibold">
            <option value="all">All campaigns</option>
            {campaigns.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="sticky top-0 bg-navy text-xs uppercase tracking-wide text-slate-300">
            <tr><th className="px-3 py-2.5">#</th><th className="px-3 py-2.5">Lead</th><th className="px-3 py-2.5">Campaign</th><th className="px-3 py-2.5">CRM status</th><th className="px-3 py-2.5">Sent to Meta as</th><th className="px-3 py-2.5">Received by Meta</th></tr>
          </thead>
          <tbody>
            {!rows.length && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No leads in this view yet.</td></tr>}
            {rows.map((r, i) => {
              const received = r.send_status === 'sent' || r.send_status === 'test_sent';
              return (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-gold/5">
                  <td className="px-3 py-2 text-xs text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2"><Link href={`/leads/${r.lead_id}`} className="font-semibold text-navy hover:underline dark:text-white">{r.customer_name}</Link><p className="text-[10px] text-muted-foreground">{r.lead_number}</p></td>
                  <td className="max-w-[14rem] truncate px-3 py-2 text-xs text-slate-600 dark:text-slate-300" title={r.campaign_name}>{r.campaign_name}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{leadStatusLabel(r.crm_status)}</td>
                  <td className="px-3 py-2">{r.event_name}</td>
                  <td className="px-3 py-2">
                    {received ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Yes</span>
                      : <span className="flex items-center gap-2"><span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700" title={r.response ?? ''}>No{r.send_status === 'pending' ? ' (waiting)' : r.send_status === 'skipped' ? ' (no real Meta ID)' : ''}</span>
                        {r.send_status === 'failed' && <button type="button" disabled={retry.isPending} onClick={() => retry.mutate(r.id, { onSuccess: () => toast('Queued for retry', 'success'), onError: (e: any) => toast(e.message || 'Could not retry', 'error') })} className="text-[11px] font-semibold text-navy underline hover:text-gold">Retry</button>}
                      </span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
