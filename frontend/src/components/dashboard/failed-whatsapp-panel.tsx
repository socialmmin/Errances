'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, ExternalLink, MessageCircleWarning, Undo2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { useFailedItineraries, useMarkManualSent } from '@/hooks/use-whatsapp';

type View = 'pending' | 'done' | 'all';

// Dashboard version of the Failed WhatsApp list: who still needs the itinerary by hand,
// who is done, and everything together. Same fixed height as the other panels.
export function FailedWhatsAppPanel() {
  const { data } = useFailedItineraries();
  const mark = useMarkManualSent();
  const { toast } = useToast();
  const [view, setView] = useState<View>('all');

  const all = (data?.data ?? []).filter((i) => (i.fault as string) !== 'queued');
  const pending = all.filter((i) => !i.manualAt);
  const done = all.filter((i) => i.manualAt);
  const rows = (view === 'pending' ? pending : view === 'done' ? done : all).slice().sort((a, b) => (a.destination || '').localeCompare(b.destination || ''));

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-red-100 p-2 text-red-600"><MessageCircleWarning className="h-4 w-4" /></span>
          <h2 className="font-semibold">Failed WhatsApp</h2>
          <b className="rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">{pending.length}</b>
        </div>
        <Link href="/failed-whatsapp" className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-navy">All <ArrowRight className="h-3 w-3" /></Link>
      </header>
      <div className="flex border-b text-xs font-semibold">
        {([['all', `All (${all.length})`], ['pending', `Pending (${pending.length})`], ['done', `Done (${done.length})`]] as [View, string][]).map(([v, label]) => (
          <button key={v} type="button" onClick={() => setView(v)} className={`flex-1 py-2 ${view === v ? 'border-b-2 border-gold text-navy dark:text-white' : 'text-muted-foreground hover:bg-muted/40'}`}>{label}</button>
        ))}
      </div>
      <div className="max-h-[24rem] divide-y divide-border overflow-y-auto">
        {rows.map((item) => {
          const digits = (item.phone || '').replace(/\D/g, '');
          return (
            <div key={item.packageId + item.leadId} className="flex items-center gap-2 px-5 py-3">
              <div className="min-w-0 flex-1">
                <Link href={`/leads/${item.leadId}`} className="block truncate text-sm font-semibold hover:underline">{item.customerName}</Link>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground"><span className="rounded bg-gold px-1.5 py-0.5 font-bold text-navy">{item.destination || 'Unknown'}</span>{item.fault === 'customer' ? <span className="text-red-600">not on WhatsApp</span> : <span>Meta blocked</span>}</p>
              </div>
              {item.manualAt ? (
                <>
                  <span className="text-[11px] font-semibold text-emerald-700"><CheckCircle2 className="mr-0.5 inline h-3.5 w-3.5" />Sent</span>
                  <button type="button" title="Marked by mistake? Put it back in Pending" onClick={() => mark.mutate({ leadId: item.leadId, packageId: item.packageId, undo: true })} className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50"><Undo2 className="h-3 w-3" />Undo</button>
                </>
              ) : (
                <>
                  {digits && <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" title="Open WhatsApp Web" className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"><ExternalLink className="h-3 w-3" />Web</a>}
                  <button type="button" title="Mark as sent" disabled={mark.isPending} onClick={() => mark.mutate({ leadId: item.leadId, packageId: item.packageId }, { onSuccess: () => toast(`${item.customerName} marked as sent`, 'success') })} className="rounded-md bg-navy p-1.5 text-white hover:bg-navy/90"><CheckCircle2 className="h-3.5 w-3.5" /></button>
                </>
              )}
            </div>
          );
        })}
        {!rows.length && <p className="px-5 py-10 text-center text-sm text-muted-foreground">{view === 'pending' ? 'Nothing pending. All caught up.' : 'Nothing here yet.'}</p>}
      </div>
    </section>
  );
}
