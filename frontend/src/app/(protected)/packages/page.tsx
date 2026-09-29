'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMarkManualSent } from '@/hooks/use-whatsapp';
import { Activity, AlertTriangle, ChevronLeft, ChevronRight, FileText, Info, Link2, RefreshCw, Send, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { PERMISSIONS } from '@/lib/permissions';
import { useMetaCampaigns, usePackages } from '@/hooks/use-packages';
import { ActiveSwitch } from '@/components/packages/active-switch';
import { PackageDeliveryStats } from '@/components/packages/package-delivery-stats';
import { WhatsAppUsagePanel } from '@/components/packages/whatsapp-usage-panel';
import { WhatsAppLog } from '@/types/whatsapp';
import { useLeadCoverage, useFailedItineraries, useRetryAllFailed, useResendItinerary, useWhatsAppAutomation, useWhatsAppHealth, useWhatsAppLogs } from '@/hooks/use-whatsapp';
import { useToast } from '@/components/ui/toast';
import { tr, locale } from '@/i18n';

type Tab = 'delivery' | 'campaigns' | 'itineraries' | 'failed';

const FAULT_LABEL: Record<string, string> = { queued: 'Not sent yet', meta: 'Meta blocked it', customer: 'Customer-side', us: 'Our side (now fixed)', unknown: 'Unclear' };
const FAULT_STYLE: Record<string, string> = { queued: 'bg-sky-100 text-sky-700', meta: 'bg-amber-100 text-amber-700', customer: 'bg-slate-100 text-slate-600', us: 'bg-red-100 text-red-700', unknown: 'bg-slate-100 text-slate-600' };

// One short, actionable word/phrase per row instead of a paragraph -- the full
// explanation is still one click away via "Details".
function shortSolution(item: { fault: string; retryable: boolean }): string {
  if (item.fault === 'queued') return 'Sends automatically';
  if (!item.retryable) return item.fault === 'customer' ? 'Get correct number' : 'Not fixable';
  if (item.fault === 'us') return 'Retry now';
  if (item.fault === 'meta') return 'Retry later';
  if (item.fault === 'customer') return 'Resend template';
  return 'Retry once';
}

function FailedSendsPanel() {
  const { toast } = useToast();
  // This table has 3 real columns (Whose side, Solution, When) between "Why it failed" and the
  // pinned Action button that go off-screen with zero indication on a normal-width window -- the
  // Action button then floats right next to visible text, looking like the middle of the table is
  // blank or broken rather than just unscrolled. A visible top scrollbar + arrows fixes that.
  const scrollRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => { setScrollWidth(el.scrollWidth); setOverflowing(el.scrollWidth > el.clientWidth + 2); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  });
  const { data, isLoading } = useFailedItineraries();
  const { data: health } = useWhatsAppHealth();
  const retryAll = useRetryAllFailed();
  const resendOne = useResendItinerary();
  const [destinationFilter, setDestinationFilter] = useState('all');
  const [faultFilter, setFaultFilter] = useState<'all' | 'queued' | 'meta' | 'customer' | 'us' | 'unknown'>('all');
  const [resendingKey, setResendingKey] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<null | { reason: string; solution: string; customerName: string }>(null);
  const [confirmBreakdown, setConfirmBreakdown] = useState<null | { rows: { destination: string; count: number }[]; total: number }>(null);
  const markManual = useMarkManualSent();
  const [view, setView] = useState<'todo' | 'manual'>('todo');
  const allItems = data?.data ?? [];
  const manualCount = allItems.filter((i) => i.manualAt).length;
  const items = allItems.filter((i) => (view === 'manual' ? !!i.manualAt : !i.manualAt));
  const destinations = Array.from(new Set(items.map((item) => item.destination || 'Unknown'))).sort();
  const filtered = items
    .filter((item) => destinationFilter === 'all' || (item.destination || 'Unknown') === destinationFilter)
    .filter((item) => faultFilter === 'all' || item.fault === faultFilter);
  const retryableCount = filtered.filter((item) => item.retryable).length;

  type RunState = { state: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped'; msg?: string };
  const [run, setRun] = useState<null | { items: typeof items; status: Record<string, RunState>; running: boolean }>(null);
  const stopRef = useRef(false);
  const [showRun, setShowRun] = useState(false);
  const bulkRetrying = !!run?.running;
  const keyOf = (i: { packageId: string; leadId: string }) => i.packageId + i.leadId;
  const noFilterActive = destinationFilter === 'all' && faultFilter === 'all';

  function openRetryConfirm() {
    const toRetry = filtered.filter((item) => item.retryable);
    const byDestination = new Map<string, number>();
    for (const item of toRetry) byDestination.set(item.destination || 'Unknown', (byDestination.get(item.destination || 'Unknown') || 0) + 1);
    const rows = Array.from(byDestination.entries()).map(([destination, count]) => ({ destination, count })).sort((a, b) => b.count - a.count);
    setConfirmBreakdown({ rows, total: toRetry.length });
  }

  // Runs on this page, one lead at a time, so every row shows what is happening to it
  // (waiting -> sending -> sent / failed) instead of a silent "Retrying...".
  async function runRetry() {
    setConfirmBreakdown(null);
    const toRetry = filtered.filter((item) => item.retryable);
    if (!toRetry.length) return;
    stopRef.current = false;
    setShowRun(true);
    setRun({ items: toRetry, status: Object.fromEntries(toRetry.map((i) => [keyOf(i), { state: 'queued' } as RunState])), running: true });
    const mark = (k: string, v: RunState) => setRun((r) => (r ? { ...r, status: { ...r.status, [k]: v } } : r));
    for (const item of toRetry) {
      if (stopRef.current) break;
      const k = keyOf(item);
      mark(k, { state: 'sending' });
      try {
        const r = await resendOne.mutateAsync({ packageId: item.packageId, leadId: item.leadId });
        if (r.sent) mark(k, { state: 'sent' });
        else if (r.reason === 'already_sent') mark(k, { state: 'sent', msg: 'Already delivered' });
        else mark(k, { state: 'skipped', msg: 'Skipped (test mode is on)' });
      } catch (error: any) {
        mark(k, { state: 'failed', msg: error.message || 'Failed' });
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    setRun((r) => (r ? { ...r, running: false } : r));
  }

  const runChip = (st?: RunState) => {
    if (!st) return null;
    if (st.state === 'sent') return <span title={st.msg} className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">{tr("✔ Sent")}</span>;
    if (st.state === 'sending') return <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-bold text-sky-700"><RefreshCw className="h-3 w-3 animate-spin" />{tr("Sending…")}</span>;
    if (st.state === 'failed') return <span title={st.msg} className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">{tr("✖ Failed")}</span>;
    if (st.state === 'skipped') return <span title={st.msg} className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">{tr("Skipped")}</span>;
    return <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">{tr("Waiting")}</span>;
  };
  const runCounts = run ? Object.values(run.status).reduce((c, v) => ({ ...c, [v.state]: (c[v.state as keyof typeof c] || 0) + 1 }), { queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0 }) : null;

  async function handleResendOne(item: { packageId: string; leadId: string }) {
    const key = item.packageId + item.leadId;
    setResendingKey(key);
    try {
      const r = await resendOne.mutateAsync({ packageId: item.packageId, leadId: item.leadId });
      toast(r.sent ? tr("Resent successfully") : (r.reason === 'already_sent' ? tr("Already delivered — skipped") : tr("Skipped")), r.sent ? 'success' : 'error');
    } catch (error: any) {
      toast(error.message || tr("Resend failed"), 'error');
    } finally {
      setResendingKey(null);
    }
  }

  const qualityStyle = health?.qualityRating === 'RED' ? 'bg-red-100 text-red-700' : health?.qualityRating === 'YELLOW' ? 'bg-amber-100 text-amber-700' : health?.qualityRating === 'GREEN' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500';

  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    {health?.qualityRating && <div className="flex flex-wrap items-center gap-2 border-b bg-navy px-5 py-2.5 text-xs text-slate-300">
      <span>{tr("Your WhatsApp number, straight from Meta:")}</span>
      <span className={`rounded-full px-2 py-0.5 font-bold ${qualityStyle}`}>{tr("Quality:")}{' '}{health.qualityRating}</span>
      <span className="rounded-full bg-white/10 px-2 py-0.5 font-bold text-white">{tr("Tier:")}{' '}{health.throughputTier || tr("STANDARD")}</span>
      {health.qualityRating === 'GREEN' && <span className="text-slate-400">{tr("— your account is in good standing; \"Meta blocked it\" rows are almost always about sending pace, not account quality.")}</span>}
    </div>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-slate-50 px-5 py-4">
      <div><h2 className="text-lg font-bold text-navy">{tr("Failed itinerary sends — every package, one place")}</h2><p className="mt-1 text-sm text-slate-500">{tr("Grouped by destination. Each row says why it failed, whose side it's on, and whether retrying can help.")}</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border bg-white text-sm font-semibold"><button type="button" onClick={() => setView("todo")} className={`px-3 py-2 ${view === "todo" ? "bg-navy text-white" : "text-slate-600"}`}>{tr("To do (")}{allItems.length - manualCount})</button><button type="button" onClick={() => setView("manual")} className={`px-3 py-2 ${view === "manual" ? "bg-emerald-600 text-white" : "text-slate-600"}`}>{tr("Sent manually (")}{manualCount})</button></div>
        <select value={destinationFilter} onChange={(e) => setDestinationFilter(e.target.value)} className="h-10 max-w-64 rounded-lg border bg-white px-3 text-sm"><option value="all">{tr("All destinations (")}{items.length})</option>{destinations.map((d) => <option key={d} value={d}>{tr(d)} ({items.filter((i) => (i.destination || 'Unknown') === d).length})</option>)}</select>
        <select value={faultFilter} onChange={(e) => setFaultFilter(e.target.value as typeof faultFilter)} className="h-10 max-w-56 rounded-lg border bg-white px-3 text-sm">
          <option value="all">{tr("Whose side: all")}</option>
          {(['queued', 'meta', 'customer', 'us', 'unknown'] as const).map((f) => <option key={f} value={f}>{tr(FAULT_LABEL[f])} ({items.filter((i) => i.fault === f).length})</option>)}
        </select>
        <Button variant="gold" className="gap-2" disabled={retryAll.isPending || bulkRetrying || !retryableCount} onClick={openRetryConfirm}>
          <RefreshCw className={`h-4 w-4 ${retryAll.isPending || bulkRetrying ? 'animate-spin' : ''}`} />
          {noFilterActive ? tr("Retry all retryable ({retryableCount})", { retryableCount: retryableCount }) : bulkRetrying ? tr("Retrying…") : tr("Retry these ({retryableCount})", { retryableCount: retryableCount })}
        </Button>
      </div>
    </div>
    {run && runCounts && <div className="border-b bg-slate-50 px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="font-semibold text-navy">{run.running ? tr("Retrying…") : tr("Retry finished")} — {runCounts.sent + runCounts.failed + runCounts.skipped}{' '}{tr("of")}{' '}{run.items.length}{' '}{tr("done")}</p>
        <div className="flex flex-wrap items-center gap-3 text-xs font-semibold"><span className="text-emerald-700">✔ {runCounts.sent}{' '}{tr("sent")}</span><span className="text-red-700">✖ {runCounts.failed}{' '}{tr("failed")}</span><span className="text-slate-500">⏳ {runCounts.queued + runCounts.sending}{' '}{tr("waiting")}</span>
          {run.running ? <button type="button" onClick={() => { stopRef.current = true; }} className="rounded-lg border border-red-200 px-2.5 py-1 text-red-600 hover:bg-red-50">{tr("Stop")}</button> : <button type="button" onClick={() => setRun(null)} className="rounded-lg bg-navy px-2.5 py-1 text-white">{tr("Done")}</button>}
        </div>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round(((runCounts.sent + runCounts.failed + runCounts.skipped) / run.items.length) * 100)}%` }} /></div>
      <p className="mt-1.5 text-[11px] text-slate-500">{tr("Keep this page open while it runs. \"Sent\" means WhatsApp accepted it; if the customer's phone rejects it later, the row returns to this list on its own.")}</p>
    </div>}
    {overflowing && (
      <div className="sticky top-0 z-30 flex items-center gap-1 border-b bg-white px-1.5 py-1">
        <button type="button" aria-label={tr("Scroll left")} onClick={() => scrollRef.current?.scrollBy({ left: -400, behavior: 'smooth' })} className="rounded-md p-1 text-navy hover:bg-muted"><ChevronLeft className="h-5 w-5" /></button>
        <div ref={topRef} className="theme-scroll min-w-0 flex-1 overflow-x-auto" onScroll={(e) => { if (scrollRef.current && scrollRef.current.scrollLeft !== e.currentTarget.scrollLeft) scrollRef.current.scrollLeft = e.currentTarget.scrollLeft; }}><div style={{ width: scrollWidth, height: 1 }} /></div>
        <button type="button" aria-label={tr("Scroll right")} onClick={() => scrollRef.current?.scrollBy({ left: 400, behavior: 'smooth' })} className="rounded-md p-1 text-navy hover:bg-muted"><ChevronRight className="h-5 w-5" /></button>
      </div>
    )}
    <div
      ref={scrollRef}
      className="theme-scroll max-h-[32rem] overflow-y-auto overflow-x-auto"
      onScroll={(e) => { if (topRef.current && topRef.current.scrollLeft !== e.currentTarget.scrollLeft) topRef.current.scrollLeft = e.currentTarget.scrollLeft; }}
    >
      <table className="w-full min-w-[1350px] table-fixed text-left text-sm">
        <colgroup><col className="w-12" /><col className="w-44" /><col className="w-28" /><col className="w-32" /><col className="w-48" /><col className="w-32" /><col className="w-36" /><col className="w-32" /><col className="w-60" /></colgroup>
        <thead className="sticky top-0 z-10"><tr className="border-b bg-navy text-xs uppercase tracking-wide text-slate-300"><th className="px-3 py-3">#</th><th className="px-5 py-3">{tr("Customer")}</th><th className="px-5 py-3">{tr("Destination")}</th><th className="px-5 py-3">{tr("Itinerary")}</th><th className="px-5 py-3">{tr("Why it failed")}</th><th className="px-5 py-3">{tr("Whose side")}</th><th className="px-5 py-3">{tr("Solution")}</th><th className="px-5 py-3">{tr("When")}</th><th className="sticky right-0 z-20 whitespace-nowrap bg-navy px-4 py-3 text-right shadow-[-8px_0_8px_-6px_rgba(0,0,0,.35)]">{tr("Action")}</th></tr></thead>
        <tbody>
          {isLoading ? <tr><td colSpan={9} className="p-10 text-center text-slate-400">{tr("Loading…")}</td></tr>
            : !filtered.length ? <tr><td colSpan={9} className="p-10 text-center text-slate-400"><AlertTriangle className="mx-auto mb-2 h-8 w-8 text-emerald-400" />{tr("No failed sends for this filter — everything's delivered or pending.")}</td></tr>
            : (run ? run.items : filtered).map((item, index) => <tr key={item.packageId + item.leadId} className={`h-16 border-b border-slate-100 hover:bg-amber-50/30 ${run?.status[keyOf(item)]?.state === 'sent' ? 'bg-emerald-50/70' : ''}`}>
              <td className="px-3 py-3 text-xs text-slate-400">{index + 1}</td>
              <td className="truncate px-5 py-3"><Link href={`/leads/${item.leadId}`} className="block truncate font-semibold text-navy hover:underline">{item.customerName}</Link><p className="truncate text-xs text-slate-400">{item.phone || tr("No phone")}</p></td>
              <td className="truncate px-5 py-3 text-slate-600">{item.destination || '—'}</td>
              <td className="truncate px-5 py-3 text-slate-500" title={tr("This lead's own {value} itinerary template — not shared with other destinations", { value: item.destination || '' })}>{item.packageName}</td>
              <td className="truncate px-5 py-3 text-slate-700" title={tr(item.reason)}>{tr(item.reason)}</td>
              <td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${FAULT_STYLE[item.fault]}`}>{tr(FAULT_LABEL[item.fault])}</span></td>
              <td className="px-5 py-3"><button onClick={() => setDetailItem({ reason: item.reason, solution: item.solution, customerName: item.customerName })} className="flex items-center gap-1.5 text-xs font-semibold text-navy hover:underline"><span>{shortSolution(item)}</span><Info className="h-3.5 w-3.5 text-slate-400" /></button></td>
              <td className="truncate px-5 py-3 text-xs text-slate-400">{new Date(item.failedAt).toLocaleString(locale())}</td>
              <td className="sticky right-0 z-[5] whitespace-nowrap bg-white px-4 py-3 text-right shadow-[-8px_0_8px_-6px_rgba(0,0,0,.12)]">{item.manualAt
                ? <div className="flex items-center justify-end gap-2"><span className="text-xs font-semibold text-emerald-700">{tr("Sent manually")}{item.manualBy ? ` by ${item.manualBy}` : ''}</span><Button size="sm" variant="outline" onClick={() => markManual.mutate({ leadId: item.leadId, packageId: item.packageId, undo: true })}>{tr("Undo")}</Button></div>
                : run ? runChip(run.status[keyOf(item)])
                : <div className="flex items-center justify-end gap-1.5">{item.retryable && <Button size="sm" variant="outline" disabled={resendingKey === item.packageId + item.leadId} onClick={() => handleResendOne(item)}>{resendingKey === item.packageId + item.leadId ? tr("Sending…") : tr("Resend")}</Button>}<Button size="sm" variant="gold" disabled={markManual.isPending} onClick={() => markManual.mutate({ leadId: item.leadId, packageId: item.packageId }, { onSuccess: () => toast(tr("{customerName} marked as sent manually", { customerName: item.customerName }), 'success') })}>{tr("Mark sent")}</Button></div>}</td>
            </tr>)}
        </tbody>
      </table>
    </div>

    {detailItem && <div className="fixed inset-0 z-[200] grid place-items-center bg-black/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailItem(null); }}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-navy">{detailItem.customerName}</h2>
        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{tr("Why it failed")}</p>
        <p className="mt-1 text-sm text-slate-700">{tr(detailItem.reason)}</p>
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">{tr("Full solution")}</p>
        <p className="mt-1 text-sm text-slate-700">{detailItem.solution}</p>
        <Button variant="gold" className="mt-5 w-full" onClick={() => setDetailItem(null)}>{tr("Close")}</Button>
      </div>
    </div>}

    {showRun && run && runCounts && <div className="fixed inset-0 z-[200] grid place-items-center bg-black/55 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-navy">{run.running ? tr("Sending itineraries…") : tr("Finished")}</h2>
        <p className="mt-1 text-sm text-slate-500">{runCounts.sent + runCounts.failed + runCounts.skipped}{' '}{tr("of")}{' '}{run.items.length}{' '}{tr("done · about 1 per second · keep this page open")}</p>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round(((runCounts.sent + runCounts.failed + runCounts.skipped) / run.items.length) * 100)}%` }} /></div>
        <div className="mt-2 flex flex-wrap gap-4 text-xs font-semibold"><span className="text-emerald-700">✔ {runCounts.sent}{' '}{tr("sent")}</span><span className="text-red-700">✖ {runCounts.failed}{' '}{tr("failed")}</span><span className="text-slate-500">⏳ {runCounts.queued + runCounts.sending}{' '}{tr("waiting")}</span></div>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl border">
          {run.items.map((item) => <div key={keyOf(item)} className={`flex items-center justify-between gap-3 border-b px-4 py-2 last:border-0 ${run.status[keyOf(item)]?.state === 'sent' ? 'bg-emerald-50' : ''}`}><div className="min-w-0"><p className="truncate text-sm font-semibold text-navy">{item.customerName}</p><p className="truncate text-xs text-slate-400">{item.destination || '—'}{run.status[keyOf(item)]?.state === 'failed' && run.status[keyOf(item)]?.msg ? ` · ${run.status[keyOf(item)]?.msg}` : ''}</p></div>{runChip(run.status[keyOf(item)])}</div>)}
        </div>
        <div className="mt-4 flex gap-2">{run.running ? <Button variant="outline" className="flex-1" onClick={() => { stopRef.current = true; }}>{tr("Stop")}</Button> : null}<Button variant="gold" className="flex-1" onClick={() => setShowRun(false)}>{run.running ? tr("Hide (keeps running)") : tr("Close")}</Button></div>
      </div>
    </div>}

    {confirmBreakdown && <div className="fixed inset-0 z-[200] grid place-items-center bg-black/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmBreakdown(null); }}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-navy">{tr("Confirm before sending")}</h2>
        <p className="mt-1 text-sm text-slate-500">{tr("Each destination gets its own itinerary template -- nobody gets someone else's.")}</p>
        <div className="mt-4 max-h-64 overflow-y-auto rounded-xl border">
          {confirmBreakdown.rows.map((row) => <div key={row.destination} className="flex items-center justify-between border-b px-4 py-2.5 last:border-0"><span className="text-sm font-medium text-navy">{row.destination}</span><span className="rounded-full bg-gold/15 px-2.5 py-1 text-xs font-bold text-gold">{row.count}{' '}{tr("template")}{row.count > 1 ? 's' : ''}</span></div>)}
        </div>
        <div className="mt-3 flex items-center justify-between rounded-xl bg-navy px-4 py-3 text-white"><span className="text-sm font-semibold">{tr("Total to send")}</span><span className="text-lg font-bold">{confirmBreakdown.total}</span></div>
        <div className="mt-5 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setConfirmBreakdown(null)}>{tr("Cancel")}</Button>
          <Button variant="gold" className="flex-1" onClick={runRetry}>{tr("Send")}</Button>
        </div>
      </div>
    </div>}
  </section>;
}

export default function PackagesPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('delivery');
  const [deliveryStatus, setDeliveryStatus] = useState('all');
  const [deliveryCampaign, setDeliveryCampaign] = useState('all');
  const [campaignSearch, setCampaignSearch] = useState('');
  const [mappingFilter, setMappingFilter] = useState<'all' | 'mapped' | 'unmapped'>('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [itinerarySearch, setItinerarySearch] = useState('');
  const [itineraryActive, setItineraryActive] = useState<'all' | 'active' | 'inactive'>('all');
  const { data, isLoading } = usePackages();
  const { data: campaignData, isLoading: campaignsLoading } = useMetaCampaigns();
  const { data: cover } = useLeadCoverage();
  const [coverList, setCoverList] = useState<null | 'noPhone' | 'noItinerary'>(null);
  const { data: automation } = useWhatsAppAutomation();
  const { data: logData } = useWhatsAppLogs();
  const allPackages = data?.data ?? [];
  const packages = allPackages.filter((pkg) => {
    const text = itinerarySearch.trim().toLowerCase();
    const matchesSearch = !text || (pkg.name + ' ' + (pkg.destinations?.join(' ') || '')).toLowerCase().includes(text);
    const matchesActive = itineraryActive === 'all' || (itineraryActive === 'active' ? pkg.is_active : !pkg.is_active);
    return matchesSearch && matchesActive;
  });
  const campaigns = campaignData?.data ?? [];
  // Every send/resend/retry writes its own log row for the same person -- collapse
  // to the single best/latest attempt per (package, person) so counts and the table
  // reflect real people, not repeated history.
  const STATUS_RANK: Record<string, number> = { read: 1, delivered: 2, sent: 3, accepted: 3, failed: 4, test_mode_skipped: 5 };
  const logs = Array.from(
    (logData?.data ?? [])
      .filter((log) => log.message_type === 'itinerary')
      .reduce((byPerson, log) => {
        const key = `${log.package_id ?? ''}:${log.lead_id ?? log.to_number}`;
        const existing = byPerson.get(key);
        const rank = STATUS_RANK[log.status] ?? 6;
        const existingRank = existing ? (STATUS_RANK[existing.status] ?? 6) : Infinity;
        const at = log.sent_at || log.created_at;
        const existingAt = existing ? (existing.sent_at || existing.created_at) : '';
        if (!existing || rank < existingRank || (rank === existingRank && at > existingAt)) byPerson.set(key, log);
        return byPerson;
      }, new Map<string, WhatsAppLog>())
      .values(),
  );
  const sent = logs.filter((log) => ['accepted', 'sent', 'delivered', 'read'].includes(log.status));
  const failed = logs.filter((log) => log.status === 'failed');
  const pending = logs.filter((log) => !['accepted', 'sent', 'delivered', 'read', 'failed'].includes(log.status));
  const deliveryCampaigns = Array.from(new Set(logs.map((log) => log.campaign_name).filter(Boolean))) as string[];
  const filteredLogs = logs.filter((log) => {
    const group = ['accepted','sent','delivered','read'].includes(log.status) ? 'sent' : log.status === 'failed' ? 'failed' : 'pending';
    return (deliveryStatus === 'all' || group === deliveryStatus) && (deliveryCampaign === 'all' || log.campaign_name === deliveryCampaign);
  });
  const mapped = campaigns.filter((campaign) => packages.some((pkg) => pkg.campaign_name === campaign.name)).length;
  const campaignStatuses = Array.from(new Set(campaigns.map((campaign) => campaign.effective_status || campaign.status).filter(Boolean)));
  const filteredCampaigns = campaigns.filter((campaign) => {
    const linked = packages.some((pkg) => pkg.campaign_name === campaign.name);
    const matchesSearch = campaign.name.toLowerCase().includes(campaignSearch.trim().toLowerCase());
    const matchesMapping = mappingFilter === 'all' || (mappingFilter === 'mapped' ? linked : !linked);
    const matchesStatus = statusFilter === 'all' || (campaign.effective_status || campaign.status) === statusFilter;
    return matchesSearch && matchesMapping && matchesStatus;
  });
  const tabs = [{ id: 'delivery' as Tab, label: 'Delivery Status', icon: Activity, count: logs.length }, { id: 'failed' as Tab, label: 'Failed Sends', icon: AlertTriangle, count: failed.length }, { id: 'campaigns' as Tab, label: 'Campaign Mapping', icon: Link2, count: campaigns.length }, { id: 'itineraries' as Tab, label: 'Itinerary Library', icon: FileText, count: packages.length }];

  return <div className="space-y-5 pb-8">
    <div><p className="text-xs font-bold uppercase tracking-[.2em] text-gold">{tr("Automation workspace")}</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-navy dark:text-white">{tr("Packages & Itinerary")}</h1><p className="mt-1 text-sm text-muted-foreground">{tr("Map campaigns, test documents and monitor every WhatsApp delivery.")}</p></div>

    <div className="grid overflow-hidden rounded-2xl bg-gradient-to-br from-navy via-slate-900 to-navy-950 text-white shadow-xl lg:grid-cols-[1.1fr_1.4fr]">
      <div className="p-5"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${automation?.live_mode ? 'animate-pulse bg-emerald-400' : 'bg-sky-400'}`} /><span className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-300">{automation?.live_mode ? tr("Live automation") : tr("Protected test mode")}</span></div><h2 className="mt-2 max-w-xl text-lg font-bold leading-tight">{tr("The right itinerary for every campaign lead.")}</h2><p className="mt-1 max-w-xl text-xs leading-5 text-slate-300">{tr("Map, test and monitor automatic WhatsApp delivery.")}</p></div>
      <div className="border-t border-white/10 bg-white/[.04] lg:border-l lg:border-t-0"><div className="grid grid-cols-2 sm:grid-cols-4"><div className="border-r border-white/10 p-4"><p className="text-2xl font-bold text-emerald-400">{cover?.received ?? "…"}</p><p className="mt-1 text-[11px] text-slate-300">{tr("Received itinerary")}</p></div><div className="border-r border-white/10 p-4"><p className="text-2xl font-bold text-red-400">{cover?.failed ?? "…"}</p><p className="mt-1 text-[11px] text-slate-300">{tr("Every attempt failed")}</p></div><div className="border-r border-white/10 p-4"><p className="text-2xl font-bold text-amber-300">{cover?.notSentYet ?? "…"}</p><p className="mt-1 text-[11px] text-slate-300">{tr("Not sent yet")}</p></div><div className="p-4"><p className="text-2xl font-bold ">{cover ? cover.noPhone + cover.noItinerary : "…"}</p><p className="mt-1 text-[11px] text-slate-300">{tr("Can't send (no phone / no itinerary)")}</p></div></div><p className="border-t border-white/10 px-4 py-2 text-[11px] text-slate-400">{tr("All")}{' '}{cover?.total ?? '…'}{' '}{tr("leads counted once — the same total as the Leads page.")}{cover && <> <button type="button" onClick={() => setCoverList('noPhone')} className="font-semibold text-amber-300 underline">{tr("No phone:")}{' '}{cover.noPhone}{' '}{tr("- see list")}</button> · <button type="button" onClick={() => setCoverList('noItinerary')} className="font-semibold text-amber-300 underline">{tr("No matching itinerary:")}{' '}{cover.noItinerary}{' '}{tr("- see list")}</button></>}</p></div>
    </div>

    <div className="flex justify-end"><PermissionGuard permission={PERMISSIONS.PACKAGES_CREATE}><Link href="/packages/new"><Button variant="gold" className="gap-2 shadow-lg shadow-amber-200"><UploadCloud className="h-4 w-4" />{' '}{tr("Upload itinerary")}</Button></Link></PermissionGuard></div>

    <WhatsAppUsagePanel />
    <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">{tabs.map(({ id, label, icon: Icon, count }) => <button key={id} onClick={() => setTab(id)} className={`flex min-w-max items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${tab === id ? 'bg-navy text-white shadow-md' : 'text-slate-500 hover:bg-slate-50 hover:text-navy'}`}><Icon className={`h-4 w-4 ${tab === id ? 'text-gold' : ''}`} />{tr(label)}<span className={`rounded-full px-2 py-.5 text-[10px] ${tab === id ? 'bg-white/10' : 'bg-slate-100'}`}>{count}</span></button>)}</div>

    {tab === 'delivery' && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b bg-slate-50 px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-navy">{tr("Itinerary delivery status")}</h2><p className="mt-1 text-sm text-slate-500">{tr("Only leads an itinerary has actually been attempted for -- not your full lead count. A lead with zero attempts (no matching active itinerary yet, or never reached) won't appear here at all; check the Failed Sends tab or Dashboard coverage card for those.")}</p></div><div className="flex gap-2"><select value={deliveryStatus} onChange={e=>setDeliveryStatus(e.target.value)} className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="all">{tr("All statuses")}</option><option value="sent">{tr("Sent")}</option><option value="failed">{tr("Failed")}</option><option value="pending">{tr("Pending")}</option></select><select value={deliveryCampaign} onChange={e=>setDeliveryCampaign(e.target.value)} className="h-10 max-w-64 rounded-lg border bg-white px-3 text-sm"><option value="all">{tr("All campaigns")}</option>{deliveryCampaigns.map(name=><option key={name} value={name}>{tr(name)}</option>)}</select></div></div></div><div className="grid grid-cols-2 border-b bg-navy text-white sm:grid-cols-4"><button onClick={()=>setDeliveryStatus('sent')} className="border-r border-white/10 p-4 text-left"><b className="text-2xl text-emerald-400">{sent.length}</b><p className="text-xs text-slate-300">{tr("Sent")}</p></button><button onClick={()=>setDeliveryStatus('failed')} className="border-r border-white/10 p-4 text-left"><b className="text-2xl text-red-400">{failed.length}</b><p className="text-xs text-slate-300">{tr("Failed")}</p></button><button onClick={()=>setDeliveryStatus('pending')} className="border-r border-white/10 p-4 text-left"><b className="text-2xl text-amber-300">{pending.length}</b><p className="text-xs text-slate-300">{tr("Pending")}</p></button><button onClick={()=>setDeliveryStatus('all')} className="p-4 text-left"><b className="text-2xl">{logs.length}</b><p className="text-xs text-slate-300">{tr("Attempted (not all leads)")}</p></button></div><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead><tr className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><th className="px-5 py-3">{tr("Lead")}</th><th className="px-5 py-3">{tr("Mobile")}</th><th className="px-5 py-3">{tr("Campaign")}</th><th className="px-5 py-3">{tr("Itinerary")}</th><th className="px-5 py-3">{tr("Status")}</th><th className="px-5 py-3">{tr("Date & time")}</th><th className="px-5 py-3">{tr("Details")}</th></tr></thead><tbody>{!filteredLogs.length?<tr><td colSpan={7} className="p-10 text-center text-slate-400">{tr("No delivery records match these filters.")}</td></tr>:filteredLogs.map(log=>{const group=['accepted','sent','delivered','read'].includes(log.status)?'sent':log.status==='failed'?'failed':'pending';return <tr key={log.id} className="border-b hover:bg-amber-50/30"><td className="px-5 py-4"><p className="font-semibold text-navy">{log.customer_name||tr("Test / unknown lead")}</p><p className="text-xs text-slate-400">{log.lead_number||'—'}</p></td><td className="px-5 py-4">+{log.to_number}</td><td className="max-w-64 px-5 py-4"><p className="truncate">{log.campaign_name||'—'}</p></td><td className="max-w-56 px-5 py-4"><p className="truncate font-medium">{log.package_name||log.template_name||tr("Itinerary")}</p></td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${group==='sent'?'bg-emerald-100 text-emerald-700':group==='failed'?'bg-red-100 text-red-700':'bg-amber-100 text-amber-700'}`}>{tr(log.status.replace(/_/g,' '))}</span></td><td className="whitespace-nowrap px-5 py-4 text-xs text-slate-500">{new Date(log.sent_at||log.created_at).toLocaleString(locale())}</td><td className="max-w-64 px-5 py-4 text-xs text-red-600">{log.error_message||'—'}</td></tr>})}</tbody></table></div><div className="bg-slate-50 px-5 py-3 text-xs text-slate-500">{tr("Showing")}{' '}{filteredLogs.length}{' '}{tr("of")}{' '}{logs.length}{' '}{tr("delivery records")}</div></section>}

    {coverList && cover && <div className="fixed inset-0 z-[200] grid place-items-center bg-black/55 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setCoverList(null); }}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-navy">{coverList === 'noPhone' ? tr("Leads with no phone number") : tr("Leads with a phone but no matching itinerary")} ({(coverList === 'noPhone' ? cover.noPhoneLeads : cover.noItineraryLeads).length})</h2>
        <p className="mt-1 text-sm text-slate-500">{coverList === 'noPhone' ? tr("Nothing can be sent until we get a WhatsApp number from the customer.") : tr("Upload or activate an itinerary for their destination, then they send automatically.")}{' '}{tr("Newest first.")}</p>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl border">
          <table className="w-full text-left text-sm"><thead className="sticky top-0 bg-gold text-xs uppercase tracking-wide text-white"><tr><th className="px-3 py-2">{tr("Lead")}</th><th className="px-3 py-2">{tr("Came in")}</th><th className="px-3 py-2">{tr("Destination / campaign")}</th></tr></thead>
            <tbody>{(coverList === 'noPhone' ? cover.noPhoneLeads : cover.noItineraryLeads).map((l) => <tr key={l.id} className="border-b last:border-0"><td className="px-3 py-2"><Link href={`/leads/${l.id}`} className="font-semibold text-navy hover:underline">{l.name}</Link>{l.phone ? <p className="text-xs text-slate-400">{l.phone}</p> : null}</td><td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{new Date(l.createdAt).toLocaleString(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</td><td className="px-3 py-2 text-xs text-slate-500">{l.destination || l.campaign || l.source || '-'}</td></tr>)}</tbody></table>
        </div>
        <Button variant="gold" className="mt-4" onClick={() => setCoverList(null)}>{tr("Close")}</Button>
      </div>
    </div>}
    {tab === 'failed' && <FailedSendsPanel />}

    {tab === 'campaigns' && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/40">
      <div className="border-b border-slate-100 bg-gradient-to-r from-white to-amber-50/50 px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-lg font-bold text-navy">{tr("Meta campaign mapping")}</h2><p className="mt-1 text-sm text-slate-500">{tr("Connect each live campaign to its automatic itinerary.")}</p></div><div className="min-w-52"><div className="mb-2 flex justify-between text-xs font-semibold"><span>{mapped}{' '}{tr("mapped")}</span><span>{campaigns.length - mapped}{' '}{tr("remaining")}</span></div><div className="h-2.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-gradient-to-r from-gold to-amber-400 transition-all" style={{ width: `${campaigns.length ? mapped / campaigns.length * 100 : 0}%` }} /></div></div></div>
        <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_190px_190px_auto]"><input value={campaignSearch} onChange={(e) => setCampaignSearch(e.target.value)} placeholder={tr("Search campaign name…")} className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/20" /><select value={mappingFilter} onChange={(e) => setMappingFilter(e.target.value as typeof mappingFilter)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-gold"><option value="all">{tr("All mappings")}</option><option value="mapped">{tr("Mapped")}</option><option value="unmapped">{tr("Not mapped")}</option></select><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-gold"><option value="all">{tr("All statuses")}</option>{campaignStatuses.map((status) => <option key={status} value={status}>{tr(status.replace(/_/g, ' '))}</option>)}</select><Button variant="outline" className="h-11 rounded-xl" onClick={() => { setCampaignSearch(''); setMappingFilter('all'); setStatusFilter('all'); }}>{tr("Clear filters")}</Button></div>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead><tr className="border-b bg-navy text-xs uppercase tracking-wide text-slate-300"><th className="px-5 py-3.5 font-semibold">{tr("Campaign")}</th><th className="px-5 py-3.5 font-semibold">{tr("Meta status")}</th><th className="px-5 py-3.5 font-semibold">{tr("Objective")}</th><th className="px-5 py-3.5 font-semibold">{tr("Mapped itinerary")}</th><th className="px-5 py-3.5 text-right font-semibold">{tr("Action")}</th></tr></thead><tbody>{campaignsLoading ? <tr><td colSpan={5} className="p-10 text-center text-slate-500">{tr("Loading campaigns…")}</td></tr> : !filteredCampaigns.length ? <tr><td colSpan={5} className="p-10 text-center text-slate-500">{tr("No campaigns match these filters.")}</td></tr> : filteredCampaigns.map((campaign) => { const linkedAll = packages.filter((pkg) => pkg.campaign_name === campaign.name); const linked = linkedAll[0]; const status = campaign.effective_status || campaign.status; return <tr key={campaign.id} className="border-b border-slate-100 transition hover:bg-amber-50/40"><td className="max-w-md px-5 py-4"><p className="truncate font-semibold text-navy">{campaign.name}</p><p className="mt-1 text-xs text-slate-400">{tr("ID:")}{' '}{campaign.id}</p></td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{tr(status.replace(/_/g, ' '))}</span></td><td className="px-5 py-4 text-xs font-medium text-slate-600">{campaign.objective?.replace(/_/g, ' ') || '—'}</td><td className="px-5 py-4">{linked ? <div className="space-y-1.5">{linkedAll.map((lp) => <div key={lp.id} className="flex items-center gap-2"><div className="min-w-0"><p className="max-w-56 truncate text-sm font-semibold text-emerald-700">{lp.name}</p><p className="max-w-56 truncate text-xs text-slate-400">{lp.duration_days ? `${lp.duration_days}D / ${lp.duration_nights ?? 0}N · ` : ''}{lp.itinerary_pdf_file_name || tr("Document linked")}</p></div><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${lp.whatsapp_template_status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : lp.whatsapp_template_status === 'REJECTED' ? 'bg-red-100 text-red-700' : lp.whatsapp_template_status === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{lp.whatsapp_template_status === 'APPROVED' ? tr("Approved") : lp.whatsapp_template_status === 'PENDING' ? tr("In review") : lp.whatsapp_template_status === 'REJECTED' ? tr("Rejected") : tr("Not submitted")}</span></div>)}</div> : <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-700">{tr("Not mapped")}</span>}</td><td className="px-5 py-4 text-right">{linked ? <div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => router.push(`/packages/${linked.id}`)}>{tr("View / Edit")}</Button><Button size="sm" variant="gold" onClick={() => router.push(`/packages/new?another=1&campaign=${encodeURIComponent(campaign.name)}&destination=${encodeURIComponent(linked.destinations?.[0] || '')}`)}>{tr("+ Add another")}</Button></div> : <Button size="sm" variant="gold" onClick={() => router.push(`/packages/new?campaign=${encodeURIComponent(campaign.name)}`)}>{tr("Upload itinerary")}</Button>}</td></tr>; })}</tbody></table></div>
      <div className="flex items-center justify-between bg-slate-50 px-5 py-3 text-xs text-slate-500"><span>{tr("Showing")}{' '}{filteredCampaigns.length}{' '}{tr("of")}{' '}{campaigns.length}{' '}{tr("campaigns")}</span><span>{tr("Synced from Meta Ads Manager")}</span></div>
    </section>}

    {tab === 'itineraries' && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center gap-2 border-b bg-white px-5 py-3"><input value={itinerarySearch} onChange={(e) => setItinerarySearch(e.target.value)} placeholder={tr("Search itinerary or destination…")} className="h-9 min-w-[14rem] flex-1 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-gold" /><select value={itineraryActive} onChange={(e) => setItineraryActive(e.target.value as 'all' | 'active' | 'inactive')} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="all">{tr("All")}</option><option value="active">{tr("Active only")}</option><option value="inactive">{tr("Inactive only")}</option></select><span className="text-xs text-slate-400">{packages.length}{' '}{tr("of")}{' '}{allPackages.length}</span></div><div className="grid grid-cols-[1.1fr_0.8fr_0.9fr_10rem_9rem_auto] gap-3 border-b bg-slate-50 px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500"><span>{tr("Itinerary")}</span><span>{tr("Destination")}</span><span>{tr("Document")}</span><span>{tr("Sent / Not sent")}</span><span>{tr("Automatic sending")}</span><span className="text-right">{tr("Open")}</span></div>{isLoading ? <p className="p-6 text-sm text-slate-500">{tr("Loading itineraries…")}</p> : !packages.length ? <p className="p-10 text-center text-sm text-slate-400">{allPackages.length ? tr("No itinerary matches this filter.") : tr("No itineraries uploaded yet.")}</p> : packages.map((pkg) => <div key={pkg.id} className="grid grid-cols-[1.1fr_0.8fr_0.9fr_10rem_9rem_auto] items-center gap-3 border-b px-5 py-4 text-sm transition hover:bg-amber-50/40"><Link href={`/packages/${pkg.id}/messages`} className="font-semibold text-navy hover:underline">{pkg.name}<span className="mt-0.5 block text-[11px] font-normal text-slate-400">{tr("See every message sent")}</span></Link><span className="text-slate-600">{pkg.destinations?.join(', ') || '—'}</span><span className="truncate text-slate-500">{pkg.itinerary_pdf_file_name || tr("Not uploaded")}</span><PackageDeliveryStats packageId={pkg.id} /><ActiveSwitch pkg={pkg} /><span className="flex justify-end gap-2"><Link href={`/packages/${pkg.id}/messages`} className="rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white">{tr("Messages")}</Link><Link href={`/packages/${pkg.id}`} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-navy hover:bg-slate-50">{tr("Edit")}</Link></span></div>)}</section>}
  </div>;
}

