'use client';

import { useState } from 'react';
import { CalendarClock, Check, Clock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { FollowUp, useCreateFollowUp, useLeadFollowUps, useUpdateFollowUp } from '@/hooks/use-follow-ups';
import { tr, locale } from '@/i18n';

function toLocalInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const STATUS_STYLE: Record<FollowUp['status'], string> = {
  pending: 'bg-amber-100 text-amber-700',
  done: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

// Created here, on the lead's own page; the same rows also show up on the
// central Follow-ups page -- one record, two views.
export function FollowUpPanel({ leadId }: { leadId: string }) {
  const { data } = useLeadFollowUps(leadId);
  const create = useCreateFollowUp(leadId);
  const update = useUpdateFollowUp();
  const { toast } = useToast();
  const [dueAt, setDueAt] = useState('');
  const [note, setNote] = useState('');
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);
  const [outcomeText, setOutcomeText] = useState('');
  const [scheduleNext, setScheduleNext] = useState(false);
  const [nextAt, setNextAt] = useState('');

  const items = data?.data ?? [];
  const openFollowUp = items.find((f) => f.status === 'pending');

  function quickSet(minutesFromNow?: number, tomorrow10am?: boolean) {
    const d = new Date();
    if (tomorrow10am) { d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); }
    else if (minutesFromNow) d.setMinutes(d.getMinutes() + minutesFromNow);
    setDueAt(toLocalInputValue(d));
  }

  async function submit() {
    if (!dueAt) return toast(tr("Pick a date and time"), 'error');
    try {
      await create.mutateAsync({ dueAt: new Date(dueAt).toISOString(), note: note.trim() || undefined });
      setDueAt(''); setNote('');
      toast(tr("Follow-up scheduled"), 'success');
    } catch (error: any) {
      toast(error.message || tr("Could not schedule follow-up"), 'error');
    }
  }

  async function complete(item: FollowUp, outcome: string) {
    try {
      await update.mutateAsync({ id: item.id, status: 'done', outcome, nextFollowUpAt: scheduleNext && nextAt ? new Date(nextAt).toISOString() : undefined });
      setOutcomeFor(null); setOutcomeText(''); setScheduleNext(false); setNextAt('');
      toast(scheduleNext && nextAt ? tr("Marked complete — next follow-up scheduled") : tr("Marked complete"), 'success');
    } catch (error: any) {
      toast(error.message || tr("Could not update"), 'error');
    }
  }

  async function reschedule(item: FollowUp, minutesFromNow: number, label: string) {
    const d = new Date(); d.setMinutes(d.getMinutes() + minutesFromNow);
    try {
      await update.mutateAsync({ id: item.id, dueAt: d.toISOString(), outcome: `Rescheduled — ${label}` });
      toast(tr("Rescheduled to {label}", { label: label }), 'success');
    } catch (error: any) {
      toast(error.message || tr("Could not reschedule"), 'error');
    }
  }

  async function cancel(item: FollowUp) {
    try { await update.mutateAsync({ id: item.id, status: 'cancelled' }); toast(tr("Follow-up cancelled"), 'success'); }
    catch (error: any) { toast(error.message || tr("Could not cancel"), 'error'); }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
        <h2 className="flex items-center gap-2 font-semibold text-blue-950"><CalendarClock className="h-4 w-4" />{tr("Schedule a follow-up")}</h2>
        {openFollowUp && <p className="mt-1 text-xs text-blue-800">{tr("This lead already has a follow-up pending on")}{' '}{new Date(openFollowUp.due_at).toLocaleString(locale())}{tr(". Creating a new one won't remove it — cancel or complete that one first if you don't want two open at once.")}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => quickSet(60)} className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100">{tr("In 1 hour")}</button>
          <button type="button" onClick={() => quickSet(180)} className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100">{tr("In 3 hours")}</button>
          <button type="button" onClick={() => quickSet(undefined, true)} className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100">{tr("Tomorrow 10 AM")}</button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
          <div><Label>{tr("Date & time")}</Label><Input type="datetime-local" className="mt-1.5 bg-white" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></div>
          <div><Label>{tr("Note (optional)")}</Label><Input className="mt-1.5 bg-white" placeholder={tr("What to follow up about")} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <div className="flex items-end"><Button variant="gold" className="w-full sm:w-auto" disabled={create.isPending} onClick={submit}>{create.isPending ? tr("Saving…") : tr("Schedule")}</Button></div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card">
        {!items.length && <p className="p-5 text-center text-sm text-muted-foreground">{tr("No follow-ups yet for this lead.")}</p>}
        {items.map((item) => (
          <div key={item.id} className="border-b border-border p-4 last:border-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /><span className="font-semibold text-navy dark:text-white">{new Date(item.due_at).toLocaleString(locale())}</span><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[item.status]}`}>{tr(item.status)}</span></div>
              {item.status === 'pending' && (
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setOutcomeFor(outcomeFor === item.id ? null : item.id)} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700"><Check className="h-3.5 w-3.5" />{tr("Mark complete")}</button>
                  <button type="button" onClick={() => reschedule(item, 180, '3 hours')} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-navy hover:bg-slate-50">{tr("Busy — +3h")}</button>
                  <button type="button" onClick={() => cancel(item)} className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"><X className="h-3.5 w-3.5" />{tr("Cancel")}</button>
                </div>
              )}
            </div>
            {item.note && <p className="mt-1 text-xs text-muted-foreground">{item.note}</p>}
            {item.outcome && <p className="mt-1 text-xs font-medium text-emerald-700">{tr(item.outcome)}</p>}
            {outcomeFor === item.id && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2">
                <button type="button" onClick={() => complete(item, 'Positive — customer interested')} className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-200">{tr("Positive")}</button>
                <button type="button" onClick={() => complete(item, 'Busy / driving — will call back')} className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-200">{tr("Busy / driving")}</button>
                <button type="button" onClick={() => complete(item, 'Not interested')} className="rounded-lg bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-200">{tr("Not interested")}</button>
                <input value={outcomeText} onChange={(e) => setOutcomeText(e.target.value)} placeholder={tr("Other outcome…")} className="h-8 min-w-[10rem] flex-1 rounded-lg border border-input px-2 text-xs outline-none focus:border-gold" />
                <button type="button" disabled={!outcomeText.trim()} onClick={() => complete(item, outcomeText.trim())} className="rounded-lg bg-navy px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40">{tr("Save")}</button>
                <label className="flex w-full items-center gap-2 text-xs font-medium text-foreground"><input type="checkbox" checked={scheduleNext} onChange={(e) => setScheduleNext(e.target.checked)} className="h-3.5 w-3.5 accent-gold" />{tr("Schedule another follow-up")}</label>
                {scheduleNext && <input type="datetime-local" value={nextAt} onChange={(e) => setNextAt(e.target.value)} className="h-8 w-full max-w-60 rounded-lg border border-input bg-background px-2 text-xs outline-none focus:border-gold" />}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
