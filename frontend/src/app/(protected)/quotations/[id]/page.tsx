'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { PERMISSIONS } from '@/lib/permissions';
import { useQuotation, useUpdateQuotationStatus, useDeleteQuotation, useSendQuotationWhatsApp } from '@/hooks/use-quotations';
import { QUOTATION_STATUSES, QUOTATION_STATUS_LABELS, marginColorClass } from '@/types/quotation';

const selectClass = 'h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
}

export default function QuotationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data: quotation, isLoading } = useQuotation(id);
  const updateStatus = useUpdateQuotationStatus(id);
  const deleteMutation = useDeleteQuotation();
  const sendWhatsApp = useSendQuotationWhatsApp(id);
  const [sendMenuOpen, setSendMenuOpen] = useState(false);

  async function onSendWhatsApp() {
    try {
      const result = await sendWhatsApp.mutateAsync();
      toast(`Quotation sent via WhatsApp to ${result.sentTo}`, 'success');
    } catch (err: any) {
      toast(err.message ?? 'Could not send via WhatsApp', 'error');
    }
  }

  function onOpenWhatsAppWeb() {
    if (!quotation) return;
    const phone = (quotation.customer_phone || quotation.lead_phone || '').replace(/\D/g, '');
    if (!phone) { toast('No phone number on this quotation', 'error'); return; }
    const link = `${process.env.NEXT_PUBLIC_APP_URL || 'https://errances.socialmm.in'}/q/${quotation.public_share_token}`;
    const name = quotation.customer_name || quotation.lead_customer_name || 'there';
    const amount = formatCurrency(quotation.final_amount || 0);
    const text = `Hi ${name}! Here's your Errances Voyages quotation *${quotation.quotation_number}*${quotation.destination ? ` for ${quotation.destination}` : ''} — total *${amount}*.\n\nView full details: ${link}`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
    setSendMenuOpen(false);
  }

  async function onStatusChange(status: string) {
    try {
      await updateStatus.mutateAsync(status);
      toast('Status updated', 'success');
    } catch (err: any) {
      toast(err.message || 'Failed to update status', 'error');
    }
  }

  async function onDelete() {
    const ok = await confirm({
      title: 'Delete this quotation?',
      description: 'This is a soft delete — it can be restored by a super admin.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    });
    if (!ok) return;
    await deleteMutation.mutateAsync(id);
    toast('Quotation deleted', 'success');
    router.push('/quotations');
  }

  if (isLoading) return <Skeleton className="h-64 w-full max-w-3xl" />;
  if (!quotation) return <p>Quotation not found.</p>;

  const customerName = quotation.customer_name ?? quotation.lead_customer_name ?? '—';
  const customerPhone = quotation.customer_phone ?? quotation.lead_phone ?? '—';

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-navy dark:text-white">{quotation.quotation_number}</h1>
          <p className="text-sm text-muted-foreground">{quotation.destination ?? 'No destination set'}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className={selectClass}
            value={quotation.status}
            onChange={(e) => onStatusChange(e.target.value)}
            disabled={updateStatus.isPending}
          >
            {QUOTATION_STATUSES.map((s) => (
              <option key={s} value={s}>{QUOTATION_STATUS_LABELS[s]}</option>
            ))}
          </select>
          <PermissionGuard permission={PERMISSIONS.QUOTATIONS_EDIT}>
            <Link href={`/quotations/${id}/edit`}>
              <Button variant="outline" size="sm">Edit</Button>
            </Link>
          </PermissionGuard>
          <PermissionGuard permission={PERMISSIONS.QUOTATIONS_DELETE}>
            <Button variant="destructive" size="sm" onClick={onDelete}>Delete</Button>
          </PermissionGuard>
        </div>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-4">
          <div>
            <p className="text-xs text-muted-foreground">Customer</p>
            <p className="text-sm font-medium">{customerName}</p>
            <p className="text-xs text-muted-foreground">{customerPhone}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Travel Dates</p>
            <p className="text-sm font-medium">
              {quotation.travel_from ? `${quotation.travel_from} → ${quotation.travel_to ?? '—'}` : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Travelers</p>
            <p className="text-sm font-medium">{quotation.adults} Adults{quotation.children > 0 ? `, ${quotation.children} Children` : ''}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Valid Until</p>
            <p className="text-sm font-medium">{quotation.valid_until ?? '—'}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <h2 className="text-sm font-semibold text-muted-foreground">Line Items</h2>
          {(quotation.items ?? []).length === 0 && <p className="text-sm text-muted-foreground">No items added.</p>}
          {(quotation.items ?? []).map((item) => (
            <div key={item.id} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
              <div>
                <span className="rounded-full bg-navy-50 px-2 py-0.5 text-xs font-medium capitalize text-navy dark:bg-navy-800 dark:text-gold">
                  {item.category ?? item.item_type ?? 'other'}
                </span>
                <span className="ml-2">{item.description}</span>
                <span className="ml-2 text-xs text-muted-foreground">× {item.quantity}</span>
              </div>
              <span>{formatCurrency(item.total_price)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <h2 className="text-sm font-semibold text-muted-foreground">Price Breakdown</h2>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(quotation.base_amount)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Discount</span><span>-{formatCurrency(quotation.discount_amount)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">GST</span><span>+{formatCurrency(quotation.gst_amount)}</span></div>
          <div className="flex justify-between text-base font-semibold"><span>Total</span><span>{formatCurrency(quotation.final_amount)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Cost</span><span>{formatCurrency(quotation.cost_amount)}</span></div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Profit Margin</span>
            <span className={marginColorClass(Number(quotation.profit_margin))}>{Number(quotation.profit_margin ?? 0).toFixed(1)}%</span>
          </div>
        </CardContent>
      </Card>

      {quotation.status === 'accepted' && (
        <PermissionGuard permission={PERMISSIONS.BOOKINGS_CREATE}>
          <Button variant="gold" onClick={() => router.push(`/bookings/new?quotation_id=${id}`)}>
            Convert to Booking
          </Button>
        </PermissionGuard>
      )}

      <PermissionGuard permission={PERMISSIONS.QUOTATIONS_EDIT}>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Button variant="outline" onClick={() => setSendMenuOpen((v) => !v)} disabled={sendWhatsApp.isPending}>
              {sendWhatsApp.isPending ? 'Sending…' : '📱 Send via WhatsApp'}
            </Button>
            {sendMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setSendMenuOpen(false)} />
                <div className="absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-xl border border-border bg-background py-1 shadow-xl">
                  <button
                    type="button"
                    onClick={() => { setSendMenuOpen(false); onSendWhatsApp(); }}
                    className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-muted/50"
                  >
                    <span><span className="block font-medium">Send via CRM WhatsApp</span><span className="block text-xs text-muted-foreground">Uses the approved template, sent from our business number</span></span>
                  </button>
                  <button
                    type="button"
                    onClick={onOpenWhatsAppWeb}
                    className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-muted/50"
                  >
                    <span><span className="block font-medium">Open WhatsApp Web</span><span className="block text-xs text-muted-foreground">Send manually from your personal number</span></span>
                  </button>
                </div>
              </>
            )}
          </div>
          <a
            href={`${process.env.NEXT_PUBLIC_APP_URL || 'https://errances.socialmm.in'}/q/${quotation.public_share_token}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-navy underline dark:text-gold"
          >
            View customer link ↗
          </a>
        </div>
      </PermissionGuard>
      {/* PDF export is still deferred — the WhatsApp send above shares a
          public link (public_share_token) instead of a PDF attachment. */}

      {(quotation.notes || quotation.internal_notes) && (
        <Card>
          <CardContent className="space-y-2 p-4">
            {quotation.notes && (
              <div>
                <p className="text-xs text-muted-foreground">Customer Notes</p>
                <p className="text-sm">{quotation.notes}</p>
              </div>
            )}
            {quotation.internal_notes && (
              <div>
                <p className="text-xs text-muted-foreground">Internal Notes</p>
                <p className="text-sm">{quotation.internal_notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
