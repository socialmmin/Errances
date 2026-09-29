'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ChevronDown, Download, Pencil, RefreshCw, Search, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ActiveSwitch } from '@/components/packages/active-switch';
import { usePackage } from '@/hooks/use-packages';
import { usePackageDelivery, usePackageMessages, useResendItinerary, useSendPendingItinerary } from '@/hooks/use-whatsapp';
import { tr, locale } from '@/i18n';

type Group = 'sent' | 'delivered' | 'viewed' | 'failed' | 'skipped' | 'not_sent';
interface Row { key: string; name: string; phone: string; enquiry: string; at: string | null; group: Group; reason: string; leadId: string | null; sentBy: string | null }

const LABEL: Record<Group, string> = { sent: 'Sent', delivered: 'Delivered', viewed: 'Viewed', failed: 'Failed', skipped: 'Skipped (test mode)', not_sent: 'Not sent' };
const STYLE: Record<Group, string> = {
  sent: 'bg-sky-100 text-sky-700', delivered: 'bg-indigo-100 text-indigo-700', viewed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700', skipped: 'bg-slate-100 text-slate-600', not_sent: 'bg-amber-100 text-amber-700',
};

function groupOf(status: string): Group {
  if (status === 'read') return 'viewed';
  if (status === 'delivered') return 'delivered';
  if (status === 'failed') return 'failed';
  if (status === 'test_mode_skipped') return 'skipped';
  return 'sent';
}

// Meta's own failure text is often either too vague ("healthy ecosystem engagement")
// or just a code -- turn it into something the team can actually act on.
function friendlyFailureReason(raw: string | null): string {
  const text = (raw || '').toLowerCase();
  if (!text) return 'WhatsApp did not give a reason.';
  if (text.includes('healthy ecosystem engagement')) return 'Meta blocked this one — usually because your sending pace/quality was flagged, or because this customer\'s own WhatsApp privacy setting ("Who can message me from businesses") is blocking messages from a number they haven\'t saved. Try Resend later; if it keeps failing for the same person, ask them to save your business number or check that privacy setting.';
  if (text.includes('undeliverable') || text.includes('not a whatsapp user') || text.includes('1013')) return 'This number could not be reached — it may not have WhatsApp, or has never messaged this business number.';
  if (text.includes('24 hour') || text.includes('24-hour') || text.includes('re-engagement') || text.includes('131047')) return 'More than 24 hours passed since this customer last messaged — only a fresh approved template can reach them now.';
  if (text.includes('rate limit') || text.includes('too many')) return 'Sending too fast — WhatsApp is temporarily throttling this business number.';
  if (text.includes('template') && (text.includes('paused') || text.includes('disabled'))) return 'This message template was paused or disabled by Meta — check WhatsApp Manager.';
  return raw || 'WhatsApp did not give a reason.';
}

export default function ItineraryMessagesPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { data: pkg } = usePackage(id);
  const { data: logs } = usePackageMessages(id);
  const { data: delivery } = usePackageDelivery(id);
  const sendPending = useSendPendingItinerary();
  const resend = useResendItinerary();
  const [resendingId, setResendingId] = useState<string | null>(null);
  async function handleResend(leadId: string) {
    setResendingId(leadId);
    try {
      const r = await resend.mutateAsync({ packageId: id, leadId });
      const message = r.sent
        ? 'Resent successfully'
        : r.reason === 'already_sent'
          ? 'Already delivered to this lead — skipped to avoid sending a duplicate'
          : 'Test mode is ON — this number is not an approved test number, so it was skipped again';
      toast(tr(message), r.sent || r.reason === 'already_sent' ? 'success' : 'error');
    } catch (error: any) {
      toast(error.message || tr("Resend failed"), 'error');
    } finally {
      setResendingId(null);
    }
  }
  const [filter, setFilter] = useState<Group | 'all'>('all');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const GROUP_RANK: Record<Group, number> = { viewed: 1, delivered: 2, sent: 3, failed: 4, skipped: 5, not_sent: 6 };

  const rows = useMemo<Row[]>(() => {
    // Every attempt (test sends, resends, skipped-while-in-test-mode reruns) writes its
    // own log row -- one real person can have many. Keep only the single best/latest
    // attempt per person so counts reflect actual people in this campaign, not history.
    const fromLogs: Row[] = (logs?.data ?? []).map((log) => {
      const group = groupOf(log.status);
      return {
        key: log.id, name: log.customer_name || 'Unknown', phone: log.to_number, enquiry: log.destination || log.campaign_name || '',
        at: log.sent_at || log.created_at, group, leadId: log.lead_id, sentBy: log.sent_by_name || null,
        reason: group === 'failed' ? friendlyFailureReason(log.error_message) : group === 'skipped' ? 'Test mode is ON and this number is not on the approved test list' : group === 'viewed' ? 'Customer opened the message' : group === 'delivered' ? 'Delivered to the phone, not opened yet' : 'Accepted by WhatsApp, waiting for delivery',
      };
    });
    const byPerson = new Map<string, Row>();
    for (const row of fromLogs) {
      const dedupeKey = row.leadId || row.phone;
      const existing = byPerson.get(dedupeKey);
      if (!existing || GROUP_RANK[row.group] < GROUP_RANK[existing.group] || (GROUP_RANK[row.group] === GROUP_RANK[existing.group] && (row.at || '') > (existing.at || ''))) {
        byPerson.set(dedupeKey, row);
      }
    }
    const withLogs = new Set(Array.from(byPerson.values()).map((row) => row.leadId).filter(Boolean));
    const pending: Row[] = (delivery?.leads ?? []).filter((lead) => !lead.sent && !withLogs.has(lead.id)).map((lead) => ({
      key: 'p-' + lead.id, name: lead.name, phone: lead.phone || '', enquiry: lead.enquiry, at: null, group: 'not_sent', leadId: lead.id, sentBy: null,
      reason: lead.validPhone ? 'Not sent yet' : 'No valid WhatsApp number on this enquiry',
    }));
    return [...Array.from(byPerson.values()), ...pending];
  }, [logs?.data, delivery?.leads]);

  const counts = useMemo(() => {
    const c: Record<Group, number> = { sent: 0, delivered: 0, viewed: 0, failed: 0, skipped: 0, not_sent: 0 };
    rows.forEach((row) => { c[row.group] += 1; });
    return c;
  }, [rows]);

  const shown = rows.filter((row) => {
    if (filter !== 'all' && row.group !== filter) return false;
    const text = search.trim().toLowerCase();
    if (text && !(row.name + ' ' + row.phone + ' ' + row.enquiry).toLowerCase().includes(text)) return false;
    if (row.at) {
      const day = new Date(row.at).toISOString().slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
    }
    return true;
  });

  function exportCsv() {
    const lines = [['Customer', 'Phone', 'Enquiry', 'Time', 'Status', 'Sent by', 'Details'], ...shown.map((r) => [r.name, r.phone, r.enquiry, r.at ? new Date(r.at).toLocaleString(locale()) : '', LABEL[r.group], r.sentBy || (r.at ? 'Auto' : ''), r.reason])];
    const csv = lines.map((line) => line.map((cell) => '"' + String(cell).replace(/"/g, '""') + '"').join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = 'itinerary-messages.csv';
    link.click();
  }

  async function sendBacklog() {
    if (!delivery) return;
    // Sends immediately, no confirm dialog -- clicking the button is the confirmation.
    try {
      const r = await sendPending.mutateAsync(id);
      toast(
        delivery.liveMode
          ? 'Sent ' + r.sent + (r.failed ? ', ' + r.failed + ' failed' : '')
          : tr("Test mode is ON — sent {sent} to test numbers, {skippedTestMode} real numbers skipped. Turn off test mode in Settings to reach everyone.", { sent: r.sent, skippedTestMode: r.skippedTestMode }),
        r.failed ? 'error' : 'success',
      );
    } catch (error: any) { toast(error.message || tr("Could not send"), 'error'); }
  }

  const chips: { key: Group | 'all'; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: rows.length }, { key: 'sent', label: 'Sent', count: counts.sent }, { key: 'delivered', label: 'Delivered', count: counts.delivered },
    { key: 'viewed', label: 'Viewed', count: counts.viewed }, { key: 'failed', label: 'Failed', count: counts.failed }, { key: 'skipped', label: 'Skipped', count: counts.skipped }, { key: 'not_sent', label: 'Not sent', count: counts.not_sent },
  ];

  return (
    <div className="space-y-5 pb-8">
      <Link href="/packages" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-navy"><ArrowLeft className="h-4 w-4" />{tr("Packages & Itinerary")}</Link>

      <div>
        <p className="text-xs font-bold uppercase tracking-[.2em] text-gold">{tr("Itinerary messages")}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-navy dark:text-white">{pkg?.name || tr("Itinerary")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{pkg?.destinations?.join(', ')}{pkg?.campaign_name ? ' · ' + pkg.campaign_name : ''}{pkg?.itinerary_pdf_file_name ? ' · ' + pkg.itinerary_pdf_file_name : ''}</p>
      </div>

      <div className="grid overflow-hidden rounded-2xl bg-gradient-to-br from-navy via-slate-900 to-navy-950 text-white shadow-xl lg:grid-cols-[1.1fr_1.6fr]">
        <div className="flex flex-col justify-between gap-4 p-5">
          <div>
            <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${pkg?.is_active ? 'animate-pulse bg-emerald-400' : 'bg-slate-500'}`} /><span className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-300">{pkg?.is_active ? tr("Automatic sending is on") : tr("Automatic sending is off")}</span></div>
            <h2 className="mt-2 max-w-xl text-lg font-bold leading-tight">{counts.sent + counts.delivered + counts.viewed} / {rows.length}{' '}{tr("sent")}</h2>
            <p className="mt-1 max-w-xl text-xs leading-5 text-slate-300">{tr("Filter, search and export the full delivery history below.")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {pkg && <ActiveSwitch pkg={pkg} />}
            <Link href={'/packages/' + id}><Button variant="outline" className="gap-2 border-white/20 bg-white/5 text-white hover:bg-white/10"><Pencil className="h-4 w-4" />{tr("Edit")}</Button></Link>
            {delivery && delivery.pending > 0 && pkg?.is_active && pkg.whatsapp_template_status === 'APPROVED' && <Button variant="gold" className="gap-2" disabled={sendPending.isPending} onClick={sendBacklog}><Send className="h-4 w-4" />{sendPending.isPending ? tr("Sending…") : 'Send to ' + delivery.pending + ' not sent'}</Button>}
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-white/10 border-t border-white/10 bg-white/[.04] sm:grid-cols-4 lg:border-l lg:border-t-0">
          {chips.map((chip) => (
            <button
              key={chip.key}
              onClick={() => setFilter(chip.key)}
              className={`p-4 text-left transition ${filter === chip.key ? 'bg-white/10' : 'hover:bg-white/[.06]'}`}
            >
              <p className={`text-2xl font-bold ${chip.key === 'sent' || chip.key === 'delivered' || chip.key === 'viewed' ? 'text-emerald-400' : chip.key === 'failed' ? 'text-red-400' : chip.key === 'not_sent' ? 'text-amber-300' : 'text-white'}`}>{chip.count}</p>
              <p className="mt-1 text-[11px] text-slate-300">{tr(chip.label)}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
        <div className="relative min-w-[14rem] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr("Search name, number or enquiry…")} className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-gold" /></div>
        <StatusFilterSelect value={filter} onChange={setFilter} />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">{tr("From")}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 rounded-lg border border-input bg-background px-2 text-sm" /></label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">{tr("To")}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 rounded-lg border border-input bg-background px-2 text-sm" /></label>
        <Button variant="outline" className="gap-2" onClick={exportCsv}><Download className="h-4 w-4" />{tr("Export")}</Button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead><tr className="border-b border-white/10 bg-navy text-xs uppercase tracking-wide text-slate-300"><th className="px-5 py-3">{tr("Customer")}</th><th className="px-5 py-3">{tr("Phone")}</th><th className="px-5 py-3">{tr("Enquiry")}</th><th className="px-5 py-3">{tr("Time")}</th><th className="px-5 py-3">{tr("Status")}</th><th className="px-5 py-3">{tr("Sent by")}</th><th className="px-5 py-3">{tr("Details")}</th></tr></thead>
          <tbody>
            {shown.map((row) => <tr key={row.key} className="border-b border-border last:border-0 hover:bg-gold/5">
              <td className="px-5 py-3 font-semibold text-navy dark:text-white">{row.leadId ? <Link href={'/leads/' + row.leadId} className="hover:underline">{row.name}</Link> : row.name}</td>
              <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{row.phone || '—'}</td>
              <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{row.enquiry || '—'}</td>
              <td className="px-5 py-3 text-muted-foreground">{row.at ? new Date(row.at).toLocaleString(locale()) : '—'}</td>
              <td className="px-5 py-3"><span className={'rounded-full px-2.5 py-1 text-xs font-semibold ' + STYLE[row.group]}>{LABEL[row.group]}</span></td>
              <td className="px-5 py-3 text-xs text-muted-foreground">{row.sentBy ? <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-700 dark:bg-white/10 dark:text-slate-200">{row.sentBy}</span> : row.at ? <span className="rounded-full bg-sky-50 px-2 py-1 font-medium text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">{tr("Auto")}</span> : '—'}</td>
              <td className={'px-5 py-3 text-xs ' + (row.group === 'failed' ? 'font-medium text-red-700' : 'text-muted-foreground')}>
                <div className="flex items-center gap-2">
                  <span className="max-w-xs">{tr(row.reason)}</span>
                  {row.group === 'failed' && row.leadId && (
                    <button
                      type="button"
                      disabled={resendingId === row.leadId}
                      onClick={() => handleResend(row.leadId!)}
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-navy/20 px-2 py-1 text-[11px] font-semibold text-navy hover:bg-navy/5 disabled:opacity-50 dark:border-white/20 dark:text-white"
                    >
                      <RefreshCw className={`h-3 w-3 ${resendingId === row.leadId ? 'animate-spin' : ''}`} />
                      {resendingId === row.leadId ? tr("Resending…") : tr("Resend")}
                    </button>
                  )}
                </div>
              </td>
            </tr>)}
            {!shown.length && <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-muted-foreground">{tr("No messages match these filters.")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// App-styled dropdown for the status filter -- the native <select> it replaces used
// the browser's own popup styling, which doesn't match the rest of the CRM.
function StatusFilterSelect({ value, onChange }: { value: Group | 'all'; onChange: (value: Group | 'all') => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const options: (Group | 'all')[] = ['all', 'sent', 'delivered', 'viewed', 'failed', 'skipped', 'not_sent'];
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex h-10 min-w-[10rem] items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm">
        <span className="min-w-0 flex-1 truncate text-left">{value === 'all' ? tr("All statuses") : LABEL[value]}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 top-11 z-30 w-56 overflow-hidden rounded-xl border border-border bg-card p-1 shadow-xl">
          {options.map((g) => (
            <button key={g} type="button" onClick={() => { onChange(g); setOpen(false); }} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-gold/10 ${value === g ? 'font-semibold text-gold' : 'text-foreground'}`}>
              {g === 'all' ? tr("All statuses") : LABEL[g]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
