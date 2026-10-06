'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/shared/data-table';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useBookings, useBookingStats } from '@/hooks/use-bookings';
import { Booking, BOOKING_STATUS_LABELS } from '@/types/booking';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
}

const STATUS_BADGE: Record<string, string> = {
  pending_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  confirmed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  in_progress: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  completed: 'bg-navy-50 text-navy dark:bg-navy-800 dark:text-gold',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const columns: ColumnDef<Booking>[] = [
  { accessorKey: 'booking_number', header: 'Booking #' },
  { id: 'customer', header: 'Customer', cell: ({ row }) => row.original.customer_name ?? '—' },
  {
    id: 'travelDates',
    header: 'Travel Dates',
    cell: ({ row }) =>
      row.original.travel_from
        ? `${row.original.travel_from}${row.original.travel_to ? ` → ${row.original.travel_to}` : ''}`
        : '—',
  },
  { accessorKey: 'total_amount', header: 'Total', cell: ({ getValue }) => formatCurrency(Number(getValue() ?? 0)) },
  {
    id: 'balance',
    header: 'Balance',
    cell: ({ row }) => {
      const balance = row.original.balance_amount != null
        ? Number(row.original.balance_amount)
        : Number(row.original.total_amount) - Number(row.original.paid_amount);
      return <span className={balance > 0 ? 'text-red-600' : 'text-green-600'}>{formatCurrency(balance)}</span>;
    },
  },
  { id: 'ops', header: 'Ops Executive', cell: ({ row }) => row.original.ops_executive_name ?? '—' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ getValue }) => {
      const status = String(getValue() ?? 'pending_approval');
      return (
        <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_BADGE[status] ?? 'bg-muted'}`}>
          {BOOKING_STATUS_LABELS[status] ?? status}
        </span>
      );
    },
  },
];

export default function BookingsPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const { data, isLoading, isError, error } = useBookings({ search: search || undefined });
  const { data: stats } = useBookingStats();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-navy dark:text-white">Bookings & Operations</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total Bookings</p>
          <p className="text-2xl font-semibold text-navy dark:text-white">{stats?.total_bookings ?? '—'}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Balance Due</p>
          <p className="text-2xl font-semibold text-red-600">{formatCurrency(stats?.balance_due ?? 0)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">In Progress</p>
          <p className="text-2xl font-semibold text-navy dark:text-white">{stats?.in_progress_count ?? '—'}</p>
        </CardContent></Card>
      </div>

      <Input
        placeholder="Search by booking number or customer…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {isError && (
        <p className="text-sm text-red-500">
          Failed to load bookings: {(error as Error)?.message ?? 'unknown error'}
        </p>
      )}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        onRowClick={(row) => router.push(`/bookings/${row.id}`)}
        emptyMessage="No bookings yet. Convert an approved quotation to create one."
      />
    </div>
  );
}
