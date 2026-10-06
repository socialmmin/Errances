'use client';

import { useWhatsAppUsageSummary } from '@/hooks/use-whatsapp';

const GST_PCT = 18;
const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const NAMES: Record<string, string> = { marketing: 'Marketing', utility: 'Utility', authentication: 'Authentication', service: 'Service' };

// WhatsApp's charges, as a compact second row of the Packages hero board: messages sent per
// category x Meta's rate, the total, and GST on top. Read-only -- it reflects what Meta charges.
export function WhatsAppUsagePanel() {
  const { data } = useWhatsAppUsageSummary();
  if (!data) return null;
  const gst = (data.totalSpentInr * GST_PCT) / 100;
  return (
    <div className="border-t border-white/10 bg-white/[.03] px-5 py-3 lg:col-span-2">
      <div className="flex flex-wrap items-stretch gap-2">
        <div className="flex min-w-[9rem] flex-col justify-center pr-2">
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-gold">WhatsApp messaging cost</p>
          <p className="text-[11px] text-slate-400">{data.totalMessages.toLocaleString('en-IN')} messages sent</p>
        </div>
        {data.categories.map((c) => (
          <div key={c.category} className="min-w-[8.5rem] flex-1 rounded-lg bg-white/5 px-3 py-2" title={c.label}>
            <p className="flex items-baseline justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{NAMES[c.category] ?? c.category}</span><span className="text-sm font-bold tabular-nums text-white">{inr(c.subtotalInr)}</span></p>
            <p className="text-[11px] tabular-nums text-slate-400">{c.count.toLocaleString('en-IN')} × {c.priceInr > 0 ? inr(c.priceInr) : 'free'}</p>
          </div>
        ))}
        <div className="min-w-[13rem] rounded-lg bg-gold/15 px-3 py-2 ring-1 ring-gold/40">
          <p className="flex items-baseline justify-between gap-3"><span className="text-[10px] font-bold uppercase tracking-wide text-gold">Total with GST</span><span className="text-base font-extrabold tabular-nums text-gold">{inr(data.totalSpentInr + gst)}</span></p>
          <p className="text-[11px] tabular-nums text-slate-300">{inr(data.totalSpentInr)} + {GST_PCT}% GST {inr(gst)}</p>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
        <b className="text-slate-200">Explore itineraries:</b> the first itinerary to a lead goes as a template and is charged as <b className="text-slate-200">Marketing</b>. When the customer taps Explore, the next itineraries go inside the 24-hour window their tap opens — those are <b className="text-slate-200">Service</b> messages and are <b className="text-emerald-300">free</b>, not marketing and not utility.
      </p>
    </div>
  );
}
