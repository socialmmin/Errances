'use client';

import { useState } from 'react';
import { CalendarClock, Check, Clock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { FollowUp, useCreateFollowUp, useLeadFollowUps, useUpdateFollowUp } from '@/hooks/use-follow-ups';
import { CompleteFollowUpModal } from '@/components/follow-ups/complete-follow-up-modal';
import { ScheduleFollowUpModal } from '@/components/follow-ups/schedule-follow-up-modal';

const TYPE_LABEL: Record<string, string> = { call: 'Call', whatsapp: 'WhatsApp', site_visit: 'Site Visit', package: 'Package', payment: 'Payment', documents: 'Documents', general: 'General' };

const STATUS_STYLE: Record<FollowUp['status'], string> = {
  pending: 'bg-amber-100 text-amber-700',
  done: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

// Created here, on the lead's own page; the same rows also show up on the
// central Follow-ups page -- one record, two views.
export function FollowUpPanel({ leadId, customerName }: { leadId: string; customerName: string }) {
  const { data } = useLeadFollowUps(leadId);
  const create = useCreateFollowUp(leadId);
  const update = useUpdateFollowUp();
  const { toast } = useToast();
  const [showSchedule, setShowSchedule] = useState(false);
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);

  const items = data?.data ?? [];
  const openFollowUp = items.find((f) => f.status === 'pending');

  async function schedule(input: { dueAt: string; note?: string; followUpType: string; priority: string }) {
    try {
      await create.mutateAsync(input);
      setShowSchedule(false);
      toast('Follow-up scheduled', 'success');
    } catch (error: any) {
      toast(error.message || 'Could not schedule follow-up', 'error');
    }
  }

  async function complete(item: FollowUp, outcome: string, nextFollowUpAt?: string) {
    try {
      await update.mutateAsync({ id: item.id, status: 'done', outcome, nextFollowUpAt });
      setOutcomeFor(null);
      toast(nextFollowUpAt ? 'Marked complete — next follow-up scheduled' : 'Marked complete', 'success');
    } catch (error: any) {
      toast(error.message || 'Could not update', 'error');
    }
  }

  async function quickBusy(item: FollowUp) {
    const d = new Date(); d.setMinutes(d.getMinutes() + 180);
    try {
      await update.mutateAsync({ id: item.id, dueAt: d.toISOString(), outcome: 'Rescheduled — busy, +3 hours' });
      toast('Rescheduled to 3 hours from now', 'success');
    } catch (error: any) {
      toast(error.message || 'Could not reschedule', 'error');
    }
  }

  async function cancel(item: FollowUp) {
    try { await update.mutateAsync({ id: item.id, status: 'cancelled' }); toast('Follow-up cancelled', 'success'); }
    catch (error: any) { toast(error.message || 'Could not cancel', 'error'); }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-semibold text-blue-950"><CalendarClock className="h-4 w-4" />Follow-ups</h2>
          <Button variant="gold" onClick={() => setShowSchedule(true)}>+ Schedule Follow-up</Button>
        </div>
        {openFollowUp && <p className="mt-1 text-xs text-blue-800">Already has a follow-up pending on {new Date(openFollowUp.due_at).toLocaleString('en-IN')}. Scheduling a new one won't remove it — cancel or complete that one first if you don't want two open at once.</p>}
      </div>

      <div className="rounded-xl border border-border bg-card">
        {!items.length && <p className="p-5 text-center text-sm text-muted-foreground">No follow-ups yet for this lead.</p>}
        {items.map((item) => (
          <div key={item.id} className="border-b border-border p-4 last:border-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold text-navy dark:text-white">{new Date(item.due_at).toLocaleString('en-IN')}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[item.status]}`}>{item.status}</span>
                {item.follow_up_type && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-slate-300">{TYPE_LABEL[item.follow_up_type] || item.follow_up_type}</span>}
              </div>
              {item.status === 'pending' && (
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setOutcomeFor(item.id)} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700"><Check className="h-3.5 w-3.5" />Mark complete</button>
                  <button type="button" onClick={() => quickBusy(item)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-navy hover:bg-slate-50">Busy — +3h</button>
                  <button type="button" onClick={() => cancel(item)} className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"><X className="h-3.5 w-3.5" />Cancel</button>
                </div>
              )}
            </div>
            {item.note && <p className="mt-1 text-xs text-muted-foreground">{item.note}</p>}
            {item.outcome && <p className="mt-1 text-xs font-medium text-emerald-700">{item.outcome}</p>}
          </div>
        ))}
      </div>

      {showSchedule && (
        <ScheduleFollowUpModal customerName={customerName} saving={create.isPending} onClose={() => setShowSchedule(false)} onSave={schedule} />
      )}

      {outcomeFor && (() => {
        const item = items.find((f) => f.id === outcomeFor);
        if (!item) return null;
        return (
          <CompleteFollowUpModal
            leadId={leadId}
            customerName={customerName}
            saving={update.isPending}
            onClose={() => setOutcomeFor(null)}
            onSave={(outcome, nextFollowUpAt) => complete(item, outcome, nextFollowUpAt)}
          />
        );
      })()}
    </div>
  );
}
