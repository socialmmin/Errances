'use client';

import { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/shared/data-table';
import { Button } from '@/components/ui/button';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { PERMISSIONS } from '@/lib/permissions';
import { useInvoices, useDeleteInvoice } from '@/hooks/use-finance';
import { Invoice, INVOICE_TYPE_LABELS, INVOICE_STATUS_LABELS } from '@/types/finance';
import { tr, locale } from '@/i18n';

function formatCurrency(n: number) {
  return new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  partial: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  paid: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  overdue: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  refunded: 'bg-navy-50 text-navy dark:bg-navy-800 dark:text-gold',
};

export default function InvoicesPage() {
  const { data, isLoading, isError, error } = useInvoices();
  const deleteInvoice = useDeleteInvoice();
  const confirm = useConfirm();

  const columns: ColumnDef<Invoice>[] = [
    { accessorKey: 'invoice_number', header: 'Invoice #' },
    { id: 'booking', header: 'Booking', cell: ({ row }) => row.original.booking_number ?? '—' },
    { id: 'customer', header: 'Customer', cell: ({ row }) => row.original.customer_name ?? '—' },
    {
      id: 'type',
      header: 'Type',
      cell: ({ row }) => (
        <span className="rounded-full bg-navy-50 px-2 py-1 text-xs font-medium text-navy dark:bg-navy-800 dark:text-gold">
          {tr(INVOICE_TYPE_LABELS[row.original.type]) ?? row.original.type.replace(/_/g, ' ')}
        </span>
      ),
    },
    { accessorKey: 'total_amount', header: 'Total', cell: ({ getValue }) => formatCurrency(Number(getValue() ?? 0)) },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => {
        const status = String(getValue() ?? 'pending');
        return (
          <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_BADGE[status] ?? 'bg-muted'}`}>
            {tr(INVOICE_STATUS_LABELS[status]) ?? tr(status)}
          </span>
        );
      },
    },
    { id: 'due_date', header: 'Due Date', cell: ({ row }) => row.original.due_date ? new Date(row.original.due_date).toLocaleDateString(locale()) : '—' },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <PermissionGuard permission={PERMISSIONS.FINANCE_COLLECT_PAYMENT}>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-600"
            onClick={async (e) => {
              e.stopPropagation();
              const ok = await confirm({ title: tr("Delete this invoice?"), confirmLabel: tr("Delete"), variant: 'destructive' });
              if (ok) deleteInvoice.mutate(row.original.id);
            }}
          >
            {tr("Delete")}
          </Button>
        </PermissionGuard>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-navy dark:text-white">{tr("Invoices")}</h1>
          <span className="rounded-full bg-navy-50 px-2 py-1 text-xs font-medium text-navy dark:bg-navy-800 dark:text-gold">
            {data?.total ?? 0}
          </span>
        </div>
      </div>

      {isError && (
        <p className="text-sm text-red-500">
          {tr("Failed to load invoices:")}{' '}{(error as Error)?.message ?? tr("unknown error")}
        </p>
      )}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        emptyMessage="Generate invoices from bookings."
      />
    </div>
  );
}
