'use client';

import { formatPhone } from '@/lib/utils';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { FailedItinerary, useFailedItineraries, useMarkManualSent } from '@/hooks/use-whatsapp';
import { tr } from '@/i18n';

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
      toast(tr("Itinerary PDF link copied — paste it in WhatsApp Web"), 'success');
    } catch { toast(tr("Could not get the itinerary link"), 'error'); }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        {showLead && <Link href={`/leads/${item.leadId}`} className="font-semibold text-navy hover:underline dark:text-white">{item.customerName}</Link>}
        {showLead && <span className="ml-2 text-xs text-slate-500">{formatPhone(item.phone)}</span>}
        <p className="text-sm font-bold text-red-800">{tr("Automatic itinerary not delivered")}</p>
        <p className="mt-0.5 text-xs text-red-700">{tr("Why:")}{' '}{tr(item.reason)}</p>
        <p className="mt-1 text-sm text-slate-700">{tr("Send them:")}{' '}<span className="rounded-md bg-gold px-2 py-0.5 text-sm font-bold text-navy">{item.destination || tr("Unknown destination")}</span> <span className="text-xs text-slate-500">— {item.packageName}</span></p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {digits && <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"><ExternalLink className="h-3.5 w-3.5" />{tr("Open WhatsApp Web")}</a>}
        <button type="button" onClick={copyLink} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">{tr("Copy itinerary link")}</button>
        <button type="button" disabled={mark.isPending} onClick={() => mark.mutate({ leadId: item.leadId, packageId: item.packageId }, { onSuccess: () => toast(tr("Marked as sent manually"), 'success') })} className="h-9 rounded-lg bg-navy px-3 text-xs font-semibold text-white hover:bg-navy/90">{tr("I sent it — mark done")}</button>
      </div>
    </div>
  );
}

// On a single lead (Inbox conversation, lead profile).
export function ManualSendBanner({ leadId }: { leadId: string; phone?: string }) {
  const { data } = useFailedItineraries();
  const items = (data?.data ?? []).filter((i) => i.leadId === leadId && !i.manualAt && (i.fault as string) !== 'queued');
  if (!items.length) return null;
  return <div className="space-y-3 border-b border-red-200 bg-red-50 px-5 py-3 dark:bg-red-950/30">{items.map((item) => <ManualSendRow key={item.packageId} item={item} />)}</div>;
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
        <div><h2 className="font-bold text-navy dark:text-white">{tr("Itineraries to send manually")}</h2><p className="mt-0.5 text-xs text-muted-foreground">{tr("The automatic WhatsApp send failed — send from WhatsApp Web, then mark done")}{undeliverable ? tr(" ({undeliverable} numbers are not on WhatsApp: call them)", { undeliverable: undeliverable }) : ''}</p></div>
        {items.length > 0 && <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">{items.length}{' '}{tr("pending")}</span>}
      </div>
      <div className="max-h-[28rem] divide-y divide-border overflow-y-auto">
        {items.map((item) => <div key={item.packageId + item.leadId} className="bg-red-50/40 px-5 py-3.5"><ManualSendRow item={item} showLead /></div>)}
        {!items.length && <p className="px-5 py-4 text-center text-sm text-muted-foreground">{tr("Nothing to send manually.")}</p>}
      </div>
    </div>
  );
}
