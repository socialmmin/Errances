'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { leadStatusLabel } from '@/lib/lead-statuses';

// A lead cannot be closed as Not Interested / Lost without saying why: the reason is saved on the
// lead (and as a note with who marked it), so the lost-reasons report shows what is going wrong.
export const REASON_STATUSES = ['not_interested', 'lost'];
export const needsReason = (status: string) => REASON_STATUSES.includes(status);
export const CLOSE_REASONS = ['Budget too low', 'Price enquiry only', 'Chose another company', 'Dates changed / not travelling', 'Will decide later', 'Destination not offered', 'Just checking', 'No response after follow-ups', 'Other'] as const;
export const MIN_REASON = 10;
// Stored as "Category — what the customer said", so reports can group by the category.
export const joinReason = (category: string, detail: string) => `${category} — ${detail.trim()}`;

export function ReasonFields({ category, detail, onCategory, onDetail, showErrors }: { category: string; detail: string; onCategory: (v: string) => void; onDetail: (v: string) => void; showErrors: boolean }) {
  const short = detail.trim().length < MIN_REASON;
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Main reason <span className="text-red-600">*</span></Label>
        <div className={`flex flex-wrap gap-1.5 rounded-xl border p-2 ${showErrors && !category ? 'border-red-500' : 'border-slate-200'}`}>
          {CLOSE_REASONS.map((r) => <button key={r} type="button" aria-pressed={category === r} onClick={() => onCategory(r)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${category === r ? 'border-navy bg-navy text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-gold'}`}>{r}</button>)}
        </div>
        {showErrors && !category && <p className="text-xs font-medium text-red-600">Choose the main reason.</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="close-reason">What did the customer say? <span className="text-red-600">*</span></Label>
        <textarea id="close-reason" rows={3} value={detail} onChange={(e) => onDetail(e.target.value)} placeholder="Type the reason in your own words, e.g. “Budget is only ₹20,000 for 4 people, our lowest package is ₹32,000.”"
          className={`w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-gold ${showErrors && short ? 'border-red-500' : 'border-input'}`} />
        <p className={`text-xs ${showErrors && short ? 'font-medium text-red-600' : 'text-slate-500'}`}>{short ? `At least ${MIN_REASON} characters — ${Math.max(MIN_REASON - detail.trim().length, 0)} more.` : 'Saved on the lead with your name and the time.'}</p>
      </div>
    </div>
  );
}

// `adding`: the lead is already closed and only the missing reason is being filled in.
export function ReasonDialog({ leadName, status, saving, adding, onCancel, onConfirm }: { leadName?: string | null; status: string; saving?: boolean; adding?: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [category, setCategory] = useState('');
  const [detail, setDetail] = useState('');
  const [tried, setTried] = useState(false);
  const ok = !!category && detail.trim().length >= MIN_REASON;
  return createPortal(
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.stopPropagation()}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 text-slate-900 shadow-2xl">
        <h3 className="text-base font-bold text-navy">{adding ? `Why is this lead ${leadStatusLabel(status)}?` : `Mark as ${leadStatusLabel(status)} — reason needed`}</h3>
        <p className="mb-3 text-xs text-slate-500">{leadName ? `${leadName} · ` : ''}{adding ? 'This lead was closed without a reason. Add it now.' : 'The lead is not changed until you save the reason.'}</p>
        <ReasonFields category={category} detail={detail} onCategory={setCategory} onDetail={setDetail} showErrors={tried} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>{adding ? 'Cancel' : 'Cancel — keep the lead as it is'}</Button>
          <Button variant="gold" disabled={saving} onClick={() => { setTried(true); if (ok) onConfirm(joinReason(category, detail)); }}>{saving ? 'Saving…' : adding ? 'Save the reason' : `Save and mark ${leadStatusLabel(status)}`}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
