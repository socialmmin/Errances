'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ReminderDialog } from '@/components/finance/reminder-dialog';
import { CancelBookingDialog } from '@/components/finance/cancel-booking-dialog';
import { TripVendors } from '@/components/vendors/trip-vendors';
import { TemplatePreview } from '@/components/finance/template-preview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { useToast } from '@/components/ui/toast';
import { PERMISSIONS } from '@/lib/permissions';
import { useInvoice, useRecordPayment, useReminderTemplate, useSendInvoiceReminder, useSubmitReminderTemplate, useSyncReminderTemplate } from '@/hooks/use-finance';
import { INVOICE_STATUS_LABELS } from '@/types/finance';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  partial: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  paid: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  overdue: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  refunded: 'bg-navy-50 text-navy dark:bg-navy-800 dark:text-gold',
};

const METHODS = ['cash', 'bank_transfer', 'upi', 'card', 'cheque', 'other'];

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const { data: invoice, isLoading } = useInvoice(params.id);
  const recordPayment = useRecordPayment(params.id);
  const { data: reminderTpl } = useReminderTemplate();
  const submitTpl = useSubmitReminderTemplate();
  const syncTpl = useSyncReminderTemplate();
  const sendReminder = useSendInvoiceReminder(params.id);

  const qc = useQueryClient();
  const confirm = useConfirm();
  const [remindOpen, setRemindOpen] = useState(false);
  // Cancel the booking and/or refund: the refund is what the policy allows, the rest is retained.
  const [cancelForm, setCancelForm] = useState<null | { cancel: boolean }>(null);
  async function reopen() {
    const ok = await confirm({ title: 'Undo the cancellation?', description: 'The invoice becomes active again. Refunds already recorded stay as they are.', confirmLabel: 'Undo cancellation' });
    if (!ok) return;
    try { await api.post(`/finance/invoices/${params.id}/reopen`, {}); toast('Cancellation undone', 'success'); qc.invalidateQueries({ queryKey: ['finance'] }); qc.invalidateQueries({ queryKey: ['quotations'] }); }
    catch (e: any) { toast(e.message || 'Could not undo', 'error'); }
  }
  // A payment entered wrongly can be corrected or removed; paid and balance follow.
  const [editing, setEditing] = useState<null | { id: string; amount: string; method: string; reference: string; paidAt: string }>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['finance'] }); qc.invalidateQueries({ queryKey: ['quotations'] }); };
  async function saveEdit() {
    if (!editing) return;
    setSavingEdit(true);
    try { await api.patch(`/finance/payments/${editing.id}`, { amount: Number(editing.amount), method: editing.method, reference: editing.reference, paidAt: editing.paidAt ? new Date(editing.paidAt).toISOString() : undefined }); toast('Payment corrected', 'success'); setEditing(null); refresh(); }
    catch (e: any) { toast(e.message || 'Could not save the payment', 'error'); }
    finally { setSavingEdit(false); }
  }
  async function removePayment(p: { id: string; amount: number }) {
    const ok = await confirm({ title: `Remove this payment of ${formatCurrency(p.amount)}?`, description: 'Use this when a payment was entered by mistake. The invoice balance goes back up by this amount.', confirmLabel: 'Remove payment', variant: 'destructive' });
    if (!ok) return;
    try { await api.delete(`/finance/payments/${p.id}`); toast('Payment removed', 'success'); refresh(); }
    catch (e: any) { toast(e.message || 'Could not remove the payment', 'error'); }
  }
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');

  if (isLoading || !invoice) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  const balance = invoice.balance_due ?? 0;

  async function onRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!value || value <= 0) return;
    try {
      const result: any = await recordPayment.mutateAsync({ amount: value, method, reference: reference || undefined });
      setAmount('');
      setReference('');
      // The server also sends the customer a WhatsApp confirmation; say whether it went out.
      const r = result?.receipt;
      toast(r?.sent ? 'Payment recorded — confirmation sent to the customer on WhatsApp' : `Payment recorded. WhatsApp confirmation not sent${r?.reason ? `: ${r.reason}` : ''}`, r?.sent ? 'success' : 'error');
    } catch {
      toast('Could not record this payment', 'error');
    }
  }

  async function onRemind() {
    try {
      const result = await sendReminder.mutateAsync();
      toast(`Reminder sent to ${result.sentTo}`, 'success');
    } catch (err: any) {
      toast(err?.message || 'Could not send reminder -- customer may be outside the 24h WhatsApp session window', 'error');
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={() => router.push('/finance/invoices')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-navy dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Back to Invoices
      </button>

      <section className="rounded-2xl bg-gradient-to-br from-navy to-slate-900 p-5 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gold">Invoice</p>
            <h1 className="mt-1 text-2xl font-bold">{invoice.invoice_number}</h1>
            <p className="mt-0.5 text-sm text-slate-300">{invoice.customer_name || 'Unknown customer'}{invoice.customer_phone ? ` · ${invoice.customer_phone}` : ''}{invoice.quotation_number ? ` · from quotation ${invoice.quotation_number}` : ''}{invoice.booking_number ? ` · from booking ${invoice.booking_number}` : ''}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {invoice.cancelled_at ? <span className="rounded-full bg-red-500 px-3 py-1 text-xs font-bold text-white">Cancelled</span> : <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_BADGE[invoice.status] ?? 'bg-white/10'}`}>{INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status}</span>}
            <PermissionGuard permission={PERMISSIONS.FINANCE_COLLECT_PAYMENT}>
              {invoice.cancelled_at
                ? <button type="button" onClick={reopen} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20">Undo cancellation</button>
                : <button type="button" onClick={() => setCancelForm({ cancel: true })} className="rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500">Cancel booking</button>}
              {Number(invoice.paid_amount ?? 0) - Number(invoice.refunded_amount ?? 0) > 0 && <button type="button" onClick={() => setCancelForm({ cancel: false })} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20">Refund</button>}
            </PermissionGuard>
            {invoice.public_share_token && <a href={`${process.env.NEXT_PUBLIC_APP_URL || 'https://errances.socialmm.in'}/i/${invoice.public_share_token}?print=1`} target="_blank" rel="noreferrer" className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20">Download PDF</a>}
            {invoice.quotation_id && <button type="button" onClick={() => router.push(`/quotations/${invoice.quotation_id}/edit`)} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20">Open quotation</button>}
          </div>
        </div>
        {invoice.cancelled_at && <p className="mt-3 rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-100">Cancelled on {new Date(invoice.cancelled_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}{invoice.cancel_reason ? ` — ${invoice.cancel_reason}` : ''}. Nothing more is collected on this invoice.{invoice.cancel_policy ? ` Terms applied: ${invoice.cancel_policy}` : ''}</p>}
        {(Number(invoice.refunded_amount ?? 0) > 0 || invoice.cancelled_at) && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white/5 p-3"><p className="text-xl font-bold tabular-nums text-amber-300">{formatCurrency(Number(invoice.refunded_amount ?? 0))}</p><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Refunded to customer</p></div>
            <div className="rounded-xl bg-white/5 p-3"><p className="text-xl font-bold tabular-nums text-emerald-300">{formatCurrency(Number(invoice.retained_amount ?? 0))}</p><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{invoice.cancelled_at ? 'Deducted and kept, as per terms' : 'Retained by us (paid − refunded)'}</p></div>
          </div>
        )}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-white/5 p-3"><p className="text-xl font-bold tabular-nums">{formatCurrency(invoice.total_amount)}</p><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Total</p></div>
          <div className="rounded-xl bg-white/5 p-3"><p className="text-xl font-bold tabular-nums text-emerald-300">{formatCurrency(invoice.paid_amount ?? 0)}</p><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Paid</p></div>
          <div className="rounded-xl bg-white/5 p-3"><p className={`text-xl font-bold tabular-nums ${balance > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{formatCurrency(balance)}</p><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Balance outstanding</p></div>
        </div>
        <p className="mt-3 border-t border-white/10 pt-3 text-xs text-slate-300">Paid <b className="text-emerald-300">{formatCurrency(invoice.paid_amount ?? 0)}</b> + Balance <b className="text-rose-300">{formatCurrency(balance)}</b> = Total <b className="text-white">{formatCurrency(invoice.total_amount)}</b> · {invoice.payments?.length ?? 0} payment{(invoice.payments?.length ?? 0) === 1 ? '' : 's'} recorded</p>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PermissionGuard permission={PERMISSIONS.FINANCE_COLLECT_PAYMENT}>
          <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-navy dark:text-white">Record a payment</h2>
            {balance <= 0 ? (
              <p className="text-sm text-emerald-600">This invoice is fully paid.</p>
            ) : (
              <form onSubmit={onRecordPayment} className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="amount">Amount (₹)</Label>
                  <Input id="amount" type="number" min={1} max={balance} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`Up to ${balance}`} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="method">Payment Method</Label>
                  <select id="method" value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
                    {METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="reference">Reference (optional)</Label>
                  <Input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction ID, cheque #, etc." />
                </div>
                <Button type="submit" variant="gold" disabled={recordPayment.isPending}>
                  {recordPayment.isPending ? 'Recording…' : 'Record Payment'}
                </Button>
              </form>
            )}
          </section>
        </PermissionGuard>

        <PermissionGuard permission={PERMISSIONS.FINANCE_COLLECT_PAYMENT}>
          <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-navy dark:text-white">Payment reminder</h2>
            {reminderTpl?.templateStatus === 'APPROVED' ? (
              <p className="text-sm text-muted-foreground"><span className="mr-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">Template approved</span>Sends the approved WhatsApp reminder about the balance due — it reaches the customer any time.</p>
            ) : (
              <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p>{reminderTpl?.templateStatus === 'PENDING' ? 'The reminder template is with Meta for review. Until it is approved, a reminder only reaches customers who messaged in the last 24 hours.' : reminderTpl?.templateStatus === 'REJECTED' ? `Meta rejected the reminder template${reminderTpl.templateRejectionReason ? `: ${reminderTpl.templateRejectionReason}` : ''}. Submit it again.` : 'No approved reminder template yet, so a reminder only reaches customers who messaged in the last 24 hours. Submit the template once to remove that limit.'}</p>
                <div className="flex gap-2">
                  {(!reminderTpl?.templateId || reminderTpl.templateStatus === 'REJECTED') && <Button size="sm" disabled={submitTpl.isPending} onClick={() => submitTpl.mutate(undefined, { onSuccess: () => toast('Reminder template submitted to Meta', 'success'), onError: (e: any) => toast(e.message || 'Could not submit', 'error') })}>{submitTpl.isPending ? 'Submitting…' : 'Submit template to Meta'}</Button>}
                  {reminderTpl?.templateStatus === 'PENDING' && <Button size="sm" variant="outline" disabled={syncTpl.isPending} onClick={() => syncTpl.mutate(undefined, { onSuccess: () => toast('Checked with Meta', 'success'), onError: (e: any) => toast(e.message || 'Could not check', 'error') })}>{syncTpl.isPending ? 'Checking…' : 'Check status'}</Button>}
                </div>
              </div>
            )}
            {invoice.next_reminder_at && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">A reminder is set for <b>{new Date(invoice.next_reminder_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</b>. Use the button below to reschedule or cancel it.</p>}
            <TemplatePreview title="Reminder template — preview" preview={(reminderTpl as any)?.preview} button={(reminderTpl as any)?.button} status={reminderTpl?.templateStatus} />
            <div className="flex flex-wrap gap-2">
              <Button variant="gold" disabled={balance <= 0} onClick={() => setRemindOpen(true)}>Send now or set a date &amp; time</Button>
              <Button variant="outline" disabled={balance <= 0 || sendReminder.isPending} onClick={onRemind}>{sendReminder.isPending ? 'Sending…' : 'Send on WhatsApp now'}</Button>
            </div>
          </section>
        </PermissionGuard>
      </div>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-navy dark:text-white">Payment history</h2>
        {!invoice.payments?.length ? (
          <p className="mt-2 text-sm text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <div className="mt-3 divide-y divide-border">
            {invoice.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <p className="font-medium text-navy dark:text-white">{formatCurrency(p.amount)} · {(p.method || 'unknown').replace(/_/g, ' ')}</p>
                  <p className="text-xs text-muted-foreground">{new Date(p.paid_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}{p.collected_by_name ? ` · by ${p.collected_by_name}` : ''}{p.reference ? ` · Ref: ${p.reference}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{p.status === 'completed' ? 'Received' : p.status}</span>
                  <PermissionGuard permission={PERMISSIONS.FINANCE_COLLECT_PAYMENT}>
                    <button type="button" title="Correct this payment" aria-label="Edit payment" onClick={() => { const d = new Date(p.paid_at); setEditing({ id: p.id, amount: String(p.amount), method: p.method || 'cash', reference: p.reference || '', paidAt: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }); }} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-navy hover:border-gold"><Pencil className="h-3.5 w-3.5" /></button>
                    <button type="button" title="Remove this payment (entered by mistake)" aria-label="Remove payment" onClick={() => removePayment(p)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-red-600 hover:border-red-300"><Trash2 className="h-3.5 w-3.5" /></button>
                  </PermissionGuard>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {invoice.quotation_id && <TripVendors quotationId={invoice.quotation_id} destination={(invoice as any).destination} />}

      {!!invoice.refunds?.length && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-navy dark:text-white">Refunds</h2>
          <div className="mt-3 divide-y divide-border">
            {invoice.refunds.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-2.5 text-sm">
                <div><p className="font-medium text-navy dark:text-white">{formatCurrency(r.amount)} · {(r.method || 'refund').replace(/_/g, ' ')}{r.reference ? ` · ${r.reference}` : ''}</p><p className="text-xs text-muted-foreground">{new Date(r.refunded_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}{r.refunded_by_name ? ` · by ${r.refunded_by_name}` : ''}{r.reason ? ` · ${r.reason}` : ''}</p></div>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Refunded</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {cancelForm && <CancelBookingDialog invoiceId={invoice.id} invoiceNumber={invoice.invoice_number} customerName={invoice.customer_name} paid={Number(invoice.paid_amount ?? 0)} refunded={Number(invoice.refunded_amount ?? 0)} mode={cancelForm.cancel ? 'cancel' : 'refund'} onClose={() => setCancelForm(null)} />}

      {remindOpen && <ReminderDialog invoiceId={invoice.id} invoiceNumber={invoice.invoice_number} customerName={invoice.customer_name} total={Number(invoice.total_amount || 0)} paid={Number(invoice.paid_amount || 0)} onClose={() => setRemindOpen(false)} />}

      {editing && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-navy">Correct this payment</h3>
            <p className="text-xs text-slate-500">Change what was entered wrongly. The invoice’s paid amount and balance update straight away.</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label htmlFor="ep-amount">Amount (₹)</Label><Input id="ep-amount" type="number" min={1} value={editing.amount} onChange={(e) => setEditing({ ...editing, amount: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="ep-method">Method</Label><select id="ep-method" value={editing.method} onChange={(e) => setEditing({ ...editing, method: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{Array.from(new Set(['cash', 'upi', 'bank_transfer', 'card', 'cheque', editing.method])).map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}</select></div>
              <div className="space-y-1"><Label htmlFor="ep-date">Paid on</Label><Input id="ep-date" type="datetime-local" value={editing.paidAt} onChange={(e) => setEditing({ ...editing, paidAt: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="ep-ref">Reference</Label><Input id="ep-ref" value={editing.reference} onChange={(e) => setEditing({ ...editing, reference: e.target.value })} placeholder="Optional" /></div>
            </div>
            <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button variant="gold" disabled={savingEdit || !(Number(editing.amount) > 0)} onClick={saveEdit}>{savingEdit ? 'Saving…' : 'Save correction'}</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}
