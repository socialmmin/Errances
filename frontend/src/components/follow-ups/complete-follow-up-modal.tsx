'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PhoneMissed, Hourglass, CalendarClock, ThumbsDown, MoreHorizontal, X, ArrowLeft, FileText, Receipt, Briefcase } from 'lucide-react';

// Pipeline-stage labels (Contacted/Qualified/Quotation Sent/Negotiation/Booking Confirmed)
// removed -- "waste of time" per explicit feedback: "positive" only genuinely means money has
// actually moved (paid/booked), and an outcome list should be ACTION-based, not a re-statement of
// the Status dropdown. "Needs more time" and "Need to ask family" merged into one (same real-world
// situation, no reason to make someone pick between near-identical options).
const OUTCOMES = [
  { label: 'RNR / No response', icon: PhoneMissed },
  { label: 'Busy, call later', icon: Briefcase },
  { label: 'Need more time / Ask family', icon: Hourglass },
  { label: 'Requested callback', icon: CalendarClock },
  { label: 'Not interested', icon: ThumbsDown },
  { label: 'Other', icon: MoreHorizontal },
] as const;

// Quotation/Invoice aren't picked from the outcome grid at all -- they're their own action
// buttons with their own confirm-then-navigate flow (see QuotationOrInvoiceAction below), since
// "they need a quotation" isn't really an outcome of the CALL, it's a thing that happens AFTER --
// create the quotation, mark this follow-up done, and schedule a check-in to see if they respond.
const ACTIONS = [
  { label: 'Quotation', href: (leadId: string) => `/quotations/new?lead_id=${leadId}`, icon: FileText, confirm: 'Create a quotation for this lead? This marks the current follow-up as done and schedules a check-in.' },
  { label: 'Invoice', href: () => `/finance/invoices`, icon: Receipt, confirm: 'Move to Invoices for this lead? This marks the current follow-up as done and schedules a check-in.' },
] as const;

const NEEDS_FOLLOWUP = new Set(['RNR / No response', 'Busy, call later', 'Need more time / Ask family', 'Requested callback', 'Other']);
const NEEDS_REASON = new Set(['Not interested']);

// Quick-pick reschedule times instead of always having to open the date picker. The raw
// datetime-local input right below these always stays visible and editable too, so "Custom" is
// never a separate mode -- just type/pick whatever doesn't match a preset.
function fmt(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function inHours(hours: number) {
  const d = new Date(); d.setHours(d.getHours() + hours, 0, 0, 0);
  return fmt(d);
}
function tomorrowAt(hour: number, minute = 0) {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(hour, minute, 0, 0);
  return fmt(d);
}
const QUICK_RESCHEDULE_OPTIONS = [
  { label: '1 hour', value: () => inHours(1) },
  { label: '2 hours', value: () => inHours(2) },
  { label: '4 hours', value: () => inHours(4) },
  { label: 'Tomorrow 10:00 AM', value: () => tomorrowAt(10, 0) },
  { label: 'Tomorrow 4:30 PM', value: () => tomorrowAt(16, 30) },
];

function defaultNextFollowUp() {
  const d = new Date(); d.setDate(d.getDate() + 3); d.setHours(11, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CompleteFollowUpModal({ leadId, customerName, onClose, onSave, saving }: {
  leadId: string;
  customerName: string;
  onClose: () => void;
  onSave: (outcome: string, nextFollowUpAt?: string) => void;
  saving: boolean;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<string | null>(null);
  const [when, setWhen] = useState(defaultNextFollowUp);
  const [note, setNote] = useState('');
  const [confirmingAction, setConfirmingAction] = useState<(typeof ACTIONS)[number] | null>(null);

  const needsFollowUp = outcome ? NEEDS_FOLLOWUP.has(outcome) : false;
  const needsReason = outcome ? NEEDS_REASON.has(outcome) : false;

  function save() {
    if (!outcome) return;
    if (needsFollowUp && !when) return;
    if (needsReason && !note.trim()) return;
    const full = note.trim() ? `${outcome} — ${note.trim()}` : outcome;
    onSave(full, needsFollowUp ? new Date(when).toISOString() : undefined);
  }

  // Marks this follow-up done (outcome = the action name) with an auto check-in scheduled 3 days
  // out, then navigates -- the explicit ask was "it should ask a warning, do you confirm", so the
  // actual navigation only happens after that confirm step, never on the first tap.
  function confirmAction(action: (typeof ACTIONS)[number]) {
    onSave(action.label, new Date(defaultNextFollowUp()).toISOString());
    router.push(action.href(leadId));
  }

  return (
    <div className="fixed inset-0 z-[500] grid place-items-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl dark:bg-navy-900">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-bold text-navy dark:text-white">Complete Follow-up — {customerName}</h2>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-5">
          {confirmingAction ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-900">{confirmingAction.confirm}</p>
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setConfirmingAction(null)} className="rounded-lg border border-input bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted">Cancel</button>
                <button type="button" onClick={() => confirmAction(confirmingAction)} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"><confirmingAction.icon className="h-3.5 w-3.5" />Confirm</button>
              </div>
            </div>
          ) : !outcome ? (
            <>
              <p className="text-sm font-semibold text-foreground">They need a quotation or invoice?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {ACTIONS.map((action) => (
                  <button key={action.label} type="button" onClick={() => setConfirmingAction(action)} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"><action.icon className="h-3.5 w-3.5" />{action.label}</button>
                ))}
              </div>
              <p className="mt-5 text-sm font-semibold text-foreground">Or what's the outcome?</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {OUTCOMES.map(({ label, icon: Icon }) => (
                  <button key={label} type="button" onClick={() => setOutcome(label)} className="flex items-center gap-2 rounded-xl border border-input bg-white px-3 py-2.5 text-left text-xs font-semibold text-slate-700 hover:border-gold hover:bg-gold/5 dark:bg-navy-800 dark:text-slate-300">
                    <Icon className="h-4 w-4 shrink-0" />{label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setOutcome(null)} className="flex items-center gap-1 text-xs font-semibold text-gold"><ArrowLeft className="h-3.5 w-3.5" />Change outcome</button>
              <p className="mt-2 inline-block rounded-full bg-navy px-3 py-1 text-xs font-bold text-white">{outcome}</p>

              {needsFollowUp && (
                <div className="mt-4">
                  <p className="text-sm font-semibold text-foreground">When should we try again? <span className="text-red-600">*</span></p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {QUICK_RESCHEDULE_OPTIONS.map((opt) => (
                      <button key={opt.label} type="button" onClick={() => setWhen(opt.value())} className="rounded-full border border-input px-3 py-1 text-xs font-semibold text-slate-700 hover:border-gold hover:bg-gold/5 dark:text-slate-300">{opt.label}</button>
                    ))}
                  </div>
                  <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-gold" />
                </div>
              )}

              <p className="mt-4 text-sm font-semibold text-foreground">{needsReason ? <>Why aren't they interested? <span className="text-red-600">*</span></> : 'Note (optional)'}</p>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={needsReason ? 'e.g. budget too high, went with another agency, trip cancelled…' : 'What did they say?'} className="mt-1.5 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
            </>
          )}
        </div>

        {!confirmingAction && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
            <button type="button" onClick={onClose} className="rounded-lg border border-input px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted">Cancel</button>
            {outcome && <button type="button" disabled={(needsFollowUp && !when) || (needsReason && !note.trim()) || saving} onClick={save} className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Saving…' : 'Complete Follow-up'}</button>}
          </div>
        )}
      </div>
    </div>
  );
}
