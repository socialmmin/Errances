'use client';

import { useRouter } from 'next/navigation';
import { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/shared/data-table';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { PERMISSIONS } from '@/lib/permissions';
import { useTodayPtaCollections, useVerifyPayment, useRejectPayment } from '@/hooks/use-finance';
import { PtaCollection } from '@/types/finance';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  completed: { label: 'Verified', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  failed: { label: 'Rejected', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
};

export default function PtaCollectionsPage() {
  const router = useRouter();
  const { data, isLoading, isError, error } = useTodayPtaCollections();
  const verify = useVerifyPayment();
  const reject = useRejectPayment();
  const confirm = useConfirm();

  const collections = data ?? [];
  const pendingCount = collections.filter((c) => c.status === 'pending').length;
  const totalToday = collections
    .filter((c) => c.status !== 'failed')
    .reduce((sum, c) => sum + Number(c.amount), 0);

  const columns: ColumnDef<PtaCollection>[] = [
    { id: 'pta', header: 'PTA', cell: ({ row }) => row.original.pta_name },
    { id: 'customer', header: 'Guest / Customer', cell: ({ row }) => row.original.customer_name ?? '—' },
    { id: 'booking', header: 'Booking', cell: ({ row }) => row.original.booking_number ?? '—' },
    { accessorKey: 'amount', header: 'Amount', cell: ({ getValue }) => formatCurrency(Number(getValue() ?? 0)) },
    {
      id: 'method',
      header: 'Method',
      cell: ({ row }) => row.original.method ? row.original.method.replace(/_/g, ' ') : '—',
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => {
        const status = String(getValue() ?? 'pending');
        const badge = STATUS_BADGE[status] ?? { label: status, cls: 'bg-muted' };
        return <span className={`rounded-full px-2 py-1 text-xs font-medium ${badge.cls}`}>{badge.label}</span>;
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const c = row.original;
        return (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                if (c.booking_id) router.push(`/bookings/${c.booking_id}`);
              }}
            >
              View
            </Button>
            {c.status === 'pending' && (
              <PermissionGuard permission={PERMISSIONS.FINANCE_APPROVE_REFUND}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-green-600"
                  disabled={verify.isPending}
                  onClick={async (e) => {
                    e.stopPropagation();
                    const ok = await confirm({
                      title: 'Verify this payment?',
                      description: `Confirms ${c.pta_name} actually collected ${formatCurrency(Number(c.amount))} for ${c.booking_number ?? 'this booking'}. This updates the booking's Received/Balance immediately.`,
                      confirmLabel: 'Verify',
                    });
                    if (ok) verify.mutate(c.id);
                  }}
                >
                  Verify
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600"
                  disabled={reject.isPending}
                  onClick={async (e) => {
                    e.stopPropagation();
                    const ok = await confirm({
                      title: 'Reject this payment?',
                      description: `Reject this collection reported by ${c.pta_name}? The booking ledger will not be affected.`,
                      confirmLabel: 'Reject',
                      variant: 'destructive',
                    });
                    if (ok) reject.mutate({ id: c.id });
                  }}
                >
                  Reject
                </Button>
              </PermissionGuard>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-navy dark:text-white">Accountant Dashboard</h1>
      <p className="text-sm text-muted-foreground">Real-time verification queue for payments collected in the field by PTAs.</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Collections Today</p>
          <p className="text-2xl font-semibold text-navy dark:text-white">{collections.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Pending Verification</p>
          <p className="text-2xl font-semibold text-amber-600">{pendingCount}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total Collected Today</p>
          <p className="text-2xl font-semibold text-navy dark:text-white">{formatCurrency(totalToday)}</p>
        </CardContent></Card>
      </div>

      {isError && (
        <p className="text-sm text-red-500">
          Failed to load collections: {(error as Error)?.message ?? 'unknown error'}
        </p>
      )}

      <DataTable
        columns={columns}
        data={collections}
        isLoading={isLoading}
        emptyMessage="No PTA collections today."
      />

      <p className="text-xs text-muted-foreground">
        Receipt upload and bank reconciliation are not part of this workflow yet (matching Hala).
      </p>
    </div>
  );
}
