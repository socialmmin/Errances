'use client';

import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { useUpdateWhatsAppRates, useWhatsAppUsageSummary } from '@/hooks/use-whatsapp';
import { tr, locale } from '@/i18n';

// Real message counts (from our own logs) x the team's real Meta rate (typed in here from
// their invoice) -- never a guessed price. Rates default to 0 until set, so spend starts at ₹0.
export function WhatsAppUsagePanel() {
  const { data } = useWhatsAppUsageSummary();
  const updateRates = useUpdateWhatsAppRates();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data && !editing) setDrafts(Object.fromEntries(data.categories.map((c) => [c.category, String(c.priceInr)])));
  }, [data, editing]);

  if (!data) return null;

  async function save() {
    try {
      await updateRates.mutateAsync(data!.categories.map((c) => ({ category: c.category, priceInr: Number(drafts[c.category]) || 0 })));
      toast(tr("Rates saved"), 'success');
      setEditing(false);
    } catch (error: any) {
      toast(error.message || tr("Could not save rates"), 'error');
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-navy">{tr("WhatsApp messaging cost")}</p>
          <p className="text-xs text-muted-foreground">{data.totalMessages}{' '}{tr("messages sent · priced at the rate you enter per category (from your Meta invoice)")}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-navy">₹{data.totalSpentInr.toLocaleString(locale())}</p>
          <p className="text-[11px] text-muted-foreground">{tr("total spend")}{!data.ratesSet ? tr(" · rates not set yet") : ''}</p>
        </div>
      </div>

      {!data.ratesSet && !editing && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{tr("Per-message rates are ₹0 by default. Enter your actual per-message price for each category from your Meta WhatsApp invoice to see the real cost — click Edit rates below.")}</p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.categories.map((c) => (
          <div key={c.category} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{tr(c.category)}</p>
            <p className="mt-1 text-xl font-bold text-navy">{c.count}<span className="ml-1 text-xs font-normal text-slate-400">{tr("sent")}</span></p>
            <p className="mt-1 text-[11px] text-slate-500">{tr(c.label)}</p>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="text-slate-500">{tr("₹/msg")}</span>
              {editing ? (
                <input value={drafts[c.category] ?? ''} onChange={(e) => setDrafts((d) => ({ ...d, [c.category]: e.target.value }))} inputMode="decimal" className="h-7 w-20 rounded border border-slate-300 px-2 text-xs outline-none focus:border-gold" />
              ) : (
                <span className="font-semibold text-navy">₹{c.priceInr}</span>
              )}
              <span className="ml-auto font-semibold text-navy">= ₹{c.subtotalInr.toLocaleString(locale())}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex justify-end gap-2">
        {editing ? (
          <><button onClick={() => setEditing(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600">{tr("Cancel")}</button>
          <button onClick={save} disabled={updateRates.isPending} className="rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-navy disabled:opacity-50">{updateRates.isPending ? tr("Saving…") : tr("Save rates")}</button></>
        ) : (
          <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-navy hover:border-gold"><Pencil className="h-3.5 w-3.5" />{tr("Edit rates")}</button>
        )}
      </div>
    </div>
  );
}
