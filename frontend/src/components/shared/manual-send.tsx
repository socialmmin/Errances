'use client';

import { formatPhone } from '@/lib/utils';
import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Copy, ExternalLink, Info } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { FailedItinerary, useFailedItineraries, useMarkManualSent } from '@/hooks/use-whatsapp';

// One failed itinerary: what they want, why it did not go, and the manual route
// (WhatsApp Web on a personal number) with one-tap mark-as-done.
function ManualSendRow({ item, showLead }: { item: FailedItinerary; showLead?: boolean }) {
  const mark = useMarkManualSent();
  const { toast } = useToast();
  const digits = (item.phone || '').replace(/\D/g, '');

  async function copyLink() {
    try {
      const { url } = await api.get<{ url: string }>(`/integrations/whatsapp/packages/${item.packageId}/document-url`);
      await navigator.clipboard.writeText(url);
      toast('Itinerary PDF link copied — paste it in WhatsApp Web', 'success');
    } catch { toast('Could not get the itinerary link', 'error'); }
  }

  const [why, setWhy] = useState(false);
  const small = 'inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-semibold';
  // One compact row: what failed + which itinerary, small actions on the right; the long
  // explanation only opens on "Why?".
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-600" />
          {showLead && <Link href={`/leads/${item.leadId}`} className="shrink-0 font-semibold text-navy hover:underline dark:text-white">{item.customerName}</Link>}
          {showLead && <span className="shrink-0 text-slate-500">{formatPhone(item.phone)}</span>}
          <span className="truncate text-red-800 dark:text-red-300"><b>Itinerary not delivered</b> · send <span className="rounded bg-gold px-1.5 py-px font-bold text-navy">{item.destination || 'Unknown'}</span> <span className="text-slate-500">({item.packageName})</span></span>
          <button type="button" onClick={() => setWhy((v) => !v)} className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-red-700 hover:underline" aria-expanded={why}><Info className="h-3 w-3" />Why?</button>
        </div>
        <div className="flex items-center gap-1.5">
          {digits && <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" className={`${small} bg-emerald-600 text-white hover:bg-emerald-700`} title="Open this chat in WhatsApp Web"><ExternalLink className="h-3 w-3" />WhatsApp Web</a>}
          <button type="button" onClick={copyLink} className={`${small} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`} title="Copy the itinerary PDF link"><Copy className="h-3 w-3" />Copy link</button>
          <button type="button" disabled={mark.isPending} onClick={() => mark.mutate({ leadId: item.leadId, packageId: item.packageId }, { onSuccess: () => toast('Marked as sent manually', 'success') })} className={`${small} bg-navy text-white hover:bg-navy/90`} title="I sent it myself — mark done"><Check className="h-3 w-3" />Mark sent</button>
        </div>
      </div>
      {why && <p className="mt-1.5 pl-5 text-[11px] leading-snug text-red-700 dark:text-red-300">{item.reason}</p>}
    </div>
  );
}

// On a single lead (Inbox conversation, lead profile).
export function ManualSendBanner({ leadId }: { leadId: string; phone?: string }) {
  const { data } = useFailedItineraries();
  const items = (data?.data ?? []).filter((i) => i.leadId === leadId && !i.manualAt && (i.fault as string) !== 'queued');
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  // Closed by default: one slim line above the chat. Tap to open the details and actions, tap
  // again to tuck it away.
  return (
    <div className="border-b border-red-200 bg-red-50 dark:bg-red-950/30">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs font-semibold text-red-800 hover:bg-red-100/60 dark:text-red-300">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-600" />
        {items.length} {items.length === 1 ? 'itinerary' : 'itineraries'} not delivered{!open && items[0]?.destination ? ` · ${items[0].destination}` : ''}
        <span className="ml-auto inline-flex items-center gap-0.5 text-[11px] font-semibold text-red-700">{open ? 'Hide' : 'Show'}<ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} /></span>
      </button>
      {open && <div className="space-y-2 px-4 pb-2">{items.map((item) => <ManualSendRow key={item.packageId} item={item} />)}</div>}
    </div>
  );
}

// Compact version for the chat header: one small chip; click opens the details and the three
// actions (WhatsApp Web / Copy link / Mark sent) in a dropdown, click again (or outside) closes it.
export function ManualSendDropdown({ leadId }: { leadId: string }) {
  const { data } = useFailedItineraries();
  const items = (data?.data ?? []).filter((i) => i.leadId === leadId && !i.manualAt && (i.fault as string) !== 'queued');
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="relative z-40 inline-flex h-7 items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 text-[11px] font-semibold text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        title="The automatic itinerary was not delivered">
        <AlertTriangle className="h-3.5 w-3.5" />Not delivered{items[0]?.destination ? ` · ${items[0].destination}` : ''}{items.length > 1 ? ` +${items.length - 1}` : ''}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-40 mt-1.5 w-[min(34rem,85vw)] space-y-2 rounded-xl border border-red-200 bg-white p-3 shadow-2xl dark:border-red-900 dark:bg-navy-950">
            {items.map((item) => <ManualSendRow key={item.packageId} item={item} />)}
          </div>
        </>
      )}
    </div>
  );
}

// Team-wide list on the Follow-ups page, next to callback requests.
export function ManualSendPanel() {
  const { data, isLoading } = useFailedItineraries();
  if (isLoading) return null;
  const items = (data?.data ?? []).filter((i) => !i.manualAt && (i.fault as string) !== 'queued');
  const undeliverable = items.filter((i) => i.fault === 'customer').length;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div><h2 className="font-bold text-navy dark:text-white">Itineraries to send manually</h2><p className="mt-0.5 text-xs text-muted-foreground">The automatic WhatsApp send failed — send from WhatsApp Web, then mark done{undeliverable ? ` (${undeliverable} numbers are not on WhatsApp: call them)` : ''}</p></div>
        {items.length > 0 && <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">{items.length} pending</span>}
      </div>
      <div className="max-h-[28rem] divide-y divide-border overflow-y-auto">
        {items.map((item) => <div key={item.packageId + item.leadId} className="bg-red-50/40 px-5 py-2.5"><ManualSendRow item={item} showLead /></div>)}
        {!items.length && <p className="px-5 py-4 text-center text-sm text-muted-foreground">Nothing to send manually.</p>}
      </div>
    </div>
  );
}
