'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/shared/data-table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { PERMISSIONS } from '@/lib/permissions';
import { useQuotations, useQuotationStats } from '@/hooks/use-quotations';
import { Quotation, QUOTATION_STATUS_LABELS } from '@/types/quotation';
import { tr, locale } from '@/i18n';

function formatCurrency(n: number) {
  return new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  accepted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  expired: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  converted: 'bg-navy-50 text-navy dark:bg-navy-800 dark:text-gold',
};

const columns: ColumnDef<Quotation>[] = [
  { accessorKey: 'quotation_number', header: 'Quote #' },
  {
    id: 'customer',
    header: 'Customer',
    cell: ({ row }) => row.original.customer_name ?? row.original.lead_customer_name ?? '—',
  },
  {
    id: 'travelDates',
    header: 'Travel Dates',
    cell: ({ row }) =>
      row.original.travel_from
        ? `${row.original.travel_from}${row.original.travel_to ? ` → ${row.original.travel_to}` : ''}`
        : '—',
  },
  {
    accessorKey: 'final_amount',
    header: 'Total',
    cell: ({ getValue }) => formatCurrency(Number(getValue() ?? 0)),
  },
  {
    accessorKey: 'profit_margin',
    header: 'Margin',
    cell: ({ getValue }) => `${Number(getValue() ?? 0).toFixed(1)}%`,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ getValue }) => {
      const status = String(getValue() ?? 'draft');
      return (
        <span className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${STATUS_BADGE[status] ?? 'bg-muted'}`}>
          {tr(QUOTATION_STATUS_LABELS[status]) ?? tr(status)}
        </span>
      );
    },
  },
  {
    accessorKey: 'created_at',
    header: 'Created',
    cell: ({ getValue }) => new Date(String(getValue())).toLocaleDateString(locale()),
  },
];

export default function QuotationsPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const { data, isLoading, isError, error } = useQuotations({ search: search || undefined });
  const { data: stats } = useQuotationStats();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-navy dark:text-white">{tr("Quotations")}</h1>
        <PermissionGuard permission={PERMISSIONS.QUOTATIONS_CREATE}>
          <Link href="/quotations/new">
            <Button variant="gold">{tr("+ New Quotation")}</Button>
          </Link>
        </PermissionGuard>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">{tr("Total Quotations")}</p>
          <p className="text-2xl font-semibold text-navy dark:text-white">{stats?.total_count ?? '—'}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">{tr("Total Value")}</p>
          <p className="text-2xl font-semibold text-navy dark:text-white">{formatCurrency(stats?.total_value ?? 0)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">{tr("Drafts")}</p>
          <p className="text-2xl font-semibold text-navy dark:text-white">{stats?.draft_count ?? '—'}</p>
        </CardContent></Card>
      </div>

      <Input
        placeholder={tr("Search by quote number or destination…")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {isError && (
        <p className="text-sm text-red-500">
          {tr("Failed to load quotations:")}{' '}{(error as Error)?.message ?? tr("unknown error")}
        </p>
      )}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        onRowClick={(row) => router.push(`/quotations/${row.id}`)}
        emptyMessage="No quotations yet. Create your first quotation to get started."
      />
    </div>
  );
}
