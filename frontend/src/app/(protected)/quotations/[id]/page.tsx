'use client';

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
import { tr, locale } from '@/i18n';

const selectClass = 'h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground';

function formatCurrency(n: number) {
  return new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
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

  async function onSendWhatsApp() {
    try {
      const result = await sendWhatsApp.mutateAsync();
      toast(tr("Quotation sent via WhatsApp to {sentTo}", { sentTo: result.sentTo }), 'success');
    } catch (err: any) {
      toast(err.message ?? tr("Could not send via WhatsApp"), 'error');
    }
  }

  async function onStatusChange(status: string) {
    try {
      await updateStatus.mutateAsync(status);
      toast(tr("Status updated"), 'success');
    } catch (err: any) {
      toast(err.message || tr("Failed to update status"), 'error');
    }
  }

  async function onDelete() {
    const ok = await confirm({
      title: tr("Delete this quotation?"),
      description: tr("This is a soft delete — it can be restored by a super admin."),
      confirmLabel: tr("Delete"),
      variant: 'destructive',
    });
    if (!ok) return;
    await deleteMutation.mutateAsync(id);
    toast(tr("Quotation deleted"), 'success');
    router.push('/quotations');
  }

  if (isLoading) return <Skeleton className="h-64 w-full max-w-3xl" />;
  if (!quotation) return <p>{tr("Quotation not found.")}</p>;

  const customerName = quotation.customer_name ?? quotation.lead_customer_name ?? '—';
  const customerPhone = quotation.customer_phone ?? quotation.lead_phone ?? '—';

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-navy dark:text-white">{quotation.quotation_number}</h1>
          <p className="text-sm text-muted-foreground">{quotation.destination ?? tr("No destination set")}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className={selectClass}
            value={quotation.status}
            onChange={(e) => onStatusChange(e.target.value)}
            disabled={updateStatus.isPending}
          >
            {QUOTATION_STATUSES.map((s) => (
              <option key={s} value={s}>{tr(QUOTATION_STATUS_LABELS[s])}</option>
            ))}
          </select>
          <PermissionGuard permission={PERMISSIONS.QUOTATIONS_EDIT}>
            <Link href={`/quotations/${id}/edit`}>
              <Button variant="outline" size="sm">{tr("Edit")}</Button>
            </Link>
          </PermissionGuard>
          <PermissionGuard permission={PERMISSIONS.QUOTATIONS_DELETE}>
            <Button variant="destructive" size="sm" onClick={onDelete}>{tr("Delete")}</Button>
          </PermissionGuard>
        </div>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-4">
          <div>
            <p className="text-xs text-muted-foreground">{tr("Customer")}</p>
            <p className="text-sm font-medium">{customerName}</p>
            <p className="text-xs text-muted-foreground">{customerPhone}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{tr("Travel Dates")}</p>
            <p className="text-sm font-medium">
              {quotation.travel_from ? `${quotation.travel_from} → ${quotation.travel_to ?? '—'}` : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{tr("Travelers")}</p>
            <p className="text-sm font-medium">{quotation.adults}{' '}{tr("Adults")}{quotation.children > 0 ? tr(", {children} Children", { children: quotation.children }) : ''}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{tr("Valid Until")}</p>
            <p className="text-sm font-medium">{quotation.valid_until ?? '—'}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <h2 className="text-sm font-semibold text-muted-foreground">{tr("Line Items")}</h2>
          {(quotation.items ?? []).length === 0 && <p className="text-sm text-muted-foreground">{tr("No items added.")}</p>}
          {(quotation.items ?? []).map((item) => (
            <div key={item.id} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
              <div>
                <span className="rounded-full bg-navy-50 px-2 py-0.5 text-xs font-medium capitalize text-navy dark:bg-navy-800 dark:text-gold">
                  {item.category ?? item.item_type ?? 'other'}
                </span>
                <span className="ml-2">{tr(item.description)}</span>
                <span className="ml-2 text-xs text-muted-foreground">× {item.quantity}</span>
              </div>
              <span>{formatCurrency(item.total_price)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <h2 className="text-sm font-semibold text-muted-foreground">{tr("Price Breakdown")}</h2>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">{tr("Subtotal")}</span><span>{formatCurrency(quotation.base_amount)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">{tr("Discount")}</span><span>-{formatCurrency(quotation.discount_amount)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">{tr("GST")}</span><span>+{formatCurrency(quotation.gst_amount)}</span></div>
          <div className="flex justify-between text-base font-semibold"><span>{tr("Total")}</span><span>{formatCurrency(quotation.final_amount)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">{tr("Cost")}</span><span>{formatCurrency(quotation.cost_amount)}</span></div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{tr("Profit Margin")}</span>
            <span className={marginColorClass(quotation.profit_margin)}>{quotation.profit_margin.toFixed(1)}%</span>
          </div>
        </CardContent>
      </Card>

      {quotation.status === 'accepted' && (
        <PermissionGuard permission={PERMISSIONS.BOOKINGS_CREATE}>
          <Button variant="gold" onClick={() => router.push(`/bookings/new?quotation_id=${id}`)}>
            {tr("Convert to Booking")}
          </Button>
        </PermissionGuard>
      )}

      <PermissionGuard permission={PERMISSIONS.QUOTATIONS_EDIT}>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onSendWhatsApp} disabled={sendWhatsApp.isPending}>
            {sendWhatsApp.isPending ? tr("Sending…") : tr("📱 Send via WhatsApp")}
          </Button>
          <a
            href={`${process.env.NEXT_PUBLIC_APP_URL || 'https://errances.socialmm.in'}/q/${quotation.public_share_token}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-navy underline dark:text-gold"
          >
            {tr("View customer link ↗")}
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
                <p className="text-xs text-muted-foreground">{tr("Customer Notes")}</p>
                <p className="text-sm">{quotation.notes}</p>
              </div>
            )}
            {quotation.internal_notes && (
              <div>
                <p className="text-xs text-muted-foreground">{tr("Internal Notes")}</p>
                <p className="text-sm">{quotation.internal_notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
