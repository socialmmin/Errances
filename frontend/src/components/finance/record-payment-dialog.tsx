'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { IndianRupee, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';

export interface PaymentResult { receipt?: { sent: boolean; reason?: string; usedTemplate?: boolean } }
const METHODS = ['cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other'];
export const inr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n) || 0);

// One pop-up for recording a payment, used from the Quotations and Invoices lists and the invoice
// page. After saving it says whether the customer's WhatsApp confirmation went out.
export function RecordPaymentDialog({ title, subtitle, total, paid, onSubmit, onClose }: {
  title: string; subtitle?: string; total: number; paid: number;
  onSubmit: (dto: { amount: number; method: string; reference?: string }) => Promise<PaymentResult>;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const balance = Math.max(Number(total) - Number(paid), 0);
  const [amount, setAmount] = useState(balance ? String(balance) : '');
  const [method, setMethod] = useState('upi');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!value || value <= 0) { toast('Enter the amount received', 'error'); return; }
    setSaving(true);
    try {
      const result = await onSubmit({ amount: value, method, reference: reference.trim() || undefined });
      const r = result?.receipt;
      toast(r?.sent ? `Payment of ${inr(value)} recorded — confirmation sent to the customer on WhatsApp` : `Payment of ${inr(value)} recorded. WhatsApp confirmation not sent${r?.reason ? `: ${r.reason}` : ''}`, r?.sent ? 'success' : 'error');
      onClose();
    } catch (err: any) { toast(err.message || 'Could not record this payment', 'error'); }
    finally { setSaving(false); }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9990] grid place-items-center bg-black/45 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={submit} className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-navy-900">
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-navy dark:text-white"><IndianRupee className="h-5 w-5 text-gold" />{title}</h2>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-3 divide-x border-b bg-slate-50 text-center dark:bg-white/5">
          <div className="p-3"><p className="text-[11px] font-semibold uppercase text-muted-foreground">Total</p><p className="font-bold text-navy dark:text-white">{inr(total)}</p></div>
          <div className="p-3"><p className="text-[11px] font-semibold uppercase text-muted-foreground">Paid</p><p className="font-bold text-emerald-600">{inr(paid)}</p></div>
          <div className="p-3"><p className="text-[11px] font-semibold uppercase text-muted-foreground">Balance</p><p className="font-bold text-red-600">{inr(balance)}</p></div>
        </div>
        <div className="space-y-3 p-5">
          <div className="space-y-1.5"><Label htmlFor="pay-amount">Amount received (₹)</Label><Input id="pay-amount" type="number" min={1} autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="pay-method">Paid by</Label>
              <select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm capitalize">{METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}</select></div>
            <div className="space-y-1.5"><Label htmlFor="pay-ref">Reference (optional)</Label><Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI / cheque no." /></div>
          </div>
          <p className="text-xs text-muted-foreground">The customer gets a WhatsApp confirmation with the amount, balance and a link to download the invoice.</p>
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Record payment'}</Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
