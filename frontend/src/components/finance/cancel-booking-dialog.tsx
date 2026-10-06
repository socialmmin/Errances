'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';

const inr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n) || 0);

// Cancel a booking (or just refund): the reason is noted, the cancellation charge under the
// terms and conditions is deducted from what was paid, and the rest goes back to the customer.
// Used from the invoice, the Invoices list and Payment Reminders.
export function CancelBookingDialog({ invoiceId, invoiceNumber, customerName, paid, refunded = 0, mode = 'cancel', onClose }: {
  invoiceId: string; invoiceNumber: string; customerName?: string | null; paid: number; refunded?: number; mode?: 'cancel' | 'refund'; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const cancel = mode === 'cancel';
  const refundable = Math.max(Number(paid) - Number(refunded), 0);
  const [reason, setReason] = useState('');
  const [deduction, setDeduction] = useState('');
  const [policy, setPolicy] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);
  const charge = Math.min(Math.max(Number(deduction) || 0, 0), refundable);
  const refund = refundable - charge;

  async function save() {
    if (cancel && !reason.trim()) { setMissing(true); toast('Note the reason for the cancellation', 'error'); return; }
    setSaving(true);
    try {
      await api.post(`/finance/invoices/${invoiceId}/cancel-refund`, { cancel, reason, refundAmount: refund, method, reference, policyNote: policy, deductionAmount: charge });
      toast(cancel ? `Booking cancelled${refund > 0 ? ` — ${inr(refund)} to refund` : ''}` : 'Refund recorded', 'success');
      qc.invalidateQueries({ queryKey: ['finance'] }); qc.invalidateQueries({ queryKey: ['quotations'] });
      onClose();
    } catch (e: any) { toast(e.message || 'Could not save', 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[94vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-navy">{cancel ? 'Cancel this booking' : 'Refund to the customer'}</h3>
        <p className="text-xs text-slate-500">{invoiceNumber} · {customerName || 'Customer'}</p>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Paid by customer</p><p className="text-lg font-bold tabular-nums text-navy">{inr(refundable)}</p></div>
          <div className="rounded-xl bg-rose-50 p-3"><p className="text-[11px] font-bold uppercase tracking-wide text-rose-700">Deducted (kept)</p><p className="text-lg font-bold tabular-nums text-rose-700">− {inr(charge)}</p></div>
          <div className="rounded-xl bg-emerald-50 p-3"><p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">Refund to customer</p><p className="text-lg font-bold tabular-nums text-emerald-700">{inr(refund)}</p></div>
        </div>

        <div className="mt-4 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cb-reason">Reason for the {cancel ? 'cancellation' : 'refund'} {cancel && <span className="text-red-600">*</span>}</Label>
            <Input id="cb-reason" value={reason} onChange={(e) => { setReason(e.target.value); setMissing(false); }} placeholder="e.g. Customer's travel plan changed" className={missing ? 'border-red-500 ring-2 ring-red-200' : ''} />
            {missing && <p className="text-xs font-semibold text-red-600">The reason is compulsory</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="cb-deduct">Deduction as per terms (₹)</Label>
              <Input id="cb-deduct" type="number" min={0} max={refundable} value={deduction} onChange={(e) => setDeduction(e.target.value)} placeholder={refundable > 0 ? `0 to ${refundable}` : 'Nothing paid yet'} disabled={refundable <= 0} />
              <div className="flex flex-wrap gap-1.5 pt-1 text-[11px]">{[0, 25, 50, 75, 100].map((pct) => <button key={pct} type="button" disabled={refundable <= 0} onClick={() => setDeduction(String(Math.round((refundable * pct) / 100)))} className="rounded-full border border-slate-200 px-2 py-0.5 font-semibold text-slate-600 hover:border-gold disabled:opacity-40">{pct === 0 ? 'No deduction' : `${pct}%`}</button>)}</div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cb-policy">Terms &amp; conditions applied</Label>
              <textarea id="cb-policy" rows={3} value={policy} onChange={(e) => setPolicy(e.target.value)} placeholder="e.g. Cancelled within 7 days of travel: 50% charge. Hotel advance is non-refundable." className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
            </div>
          </div>
          {refund > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label htmlFor="cb-method">Refund sent by</Label><select id="cb-method" value={method} onChange={(e) => setMethod(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{['bank_transfer', 'upi', 'cash', 'card', 'cheque'].map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}</select></div>
              <div className="space-y-1"><Label htmlFor="cb-ref">Refund reference</Label><Input id="cb-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction ID (optional)" /></div>
            </div>
          )}
        </div>

        {cancel && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">The booking is marked cancelled, its payment reminder stops, the balance is no longer collected, and this requirement is closed — the customer&apos;s next trip becomes the next requirement. A cancellation can be undone from the invoice.</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Back</Button>
          <Button className="bg-red-600 text-white hover:bg-red-700" disabled={saving || (!cancel && refund <= 0)} onClick={save}>{saving ? 'Saving…' : cancel ? (refund > 0 ? `Cancel booking & refund ${inr(refund)}` : 'Cancel booking, no refund') : `Record refund of ${inr(refund)}`}</Button>
        </div>
      </div>
    </div>
  );
}
