'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/shared/data-table';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useFinanceKpis, usePayments, useOverdueInstallments } from '@/hooks/use-finance';
import { Payment, OverdueInstallment, PAYMENT_STATUS_LABELS } from '@/types/finance';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
}

const METHOD_BADGE: Record<string, string> = {
  cash: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  upi: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  bank_transfer: 'bg-navy-50 text-navy dark:bg-navy-800 dark:text-gold',
  card: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const TABS = [
  { id: 'all', label: 'All Payments' },
  { id: 'overdue', label: 'Overdue' },
] as const;

const paymentColumns: ColumnDef<Payment>[] = [
  { id: 'booking', header: 'Booking', cell: ({ row }) => row.original.booking_number ?? '—' },
  { accessorKey: 'amount', header: 'Amount', cell: ({ getValue }) => formatCurrency(Number(getValue() ?? 0)) },
  {
    id: 'method',
    header: 'Method',
    cell: ({ row }) => {
      const m = row.original.method;
      if (!m) return '—';
      return (
        <span className={`rounded-full px-2 py-1 text-xs font-medium ${METHOD_BADGE[m] ?? 'bg-muted'}`}>
          {m.replace(/_/g, ' ')}
        </span>
      );
    },
  },
  { id: 'transaction_id', header: 'Transaction ID', cell: ({ row }) => row.original.transaction_id ?? row.original.reference ?? '—' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ getValue }) => {
      const status = String(getValue() ?? 'pending');
      return (
        <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_BADGE[status] ?? 'bg-muted'}`}>
          {PAYMENT_STATUS_LABELS[status] ?? status}
        </span>
      );
    },
  },
  { id: 'date', header: 'Date', cell: ({ row }) => new Date(row.original.paid_at).toLocaleDateString('en-IN') },
  { id: 'collected_by', header: 'Collected By', cell: ({ row }) => row.original.collected_by_name ?? '—' },
];

const overdueColumns: ColumnDef<OverdueInstallment>[] = [
  { id: 'booking', header: 'Booking', cell: ({ row }) => row.original.booking_number ?? '—' },
  { id: 'customer', header: 'Customer', cell: ({ row }) => row.original.customer_name ?? '—' },
  { accessorKey: 'amount', header: 'Amount', cell: ({ getValue }) => formatCurrency(Number(getValue() ?? 0)) },
  { id: 'due_date', header: 'Due Date', cell: ({ row }) => new Date(row.original.due_date).toLocaleDateString('en-IN') },
  {
    id: 'days_overdue',
    header: 'Days Overdue',
    cell: ({ row }) => {
      const days = row.original.days_overdue;
      return <span className={days > 7 ? 'font-medium text-red-600' : 'font-medium text-amber-600'}>{days}</span>;
    },
  },
  { accessorKey: 'status', header: 'Status' },
];

export default function FinancePage() {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['id']>('all');
  const { data: kpis } = useFinanceKpis();
  const { data: payments, isLoading: paymentsLoading } = usePayments();
  const { data: overdue, isLoading: overdueLoading } = useOverdueInstallments();

  const overdueCount = overdue?.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-navy dark:text-white">Finance</h1>
        <div className="flex gap-2">
          <Link href="/finance/invoices"><Button variant="outline">Invoices</Button></Link>
          <Link href="/finance/pta-collections"><Button variant="outline">PTA Collections</Button></Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Today&apos;s Collection</p>
          <p className="text-2xl font-semibold text-navy dark:text-white">{formatCurrency(kpis?.todayCollection ?? 0)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">This Month</p>
          <p className="text-2xl font-semibold text-navy dark:text-white">{formatCurrency(kpis?.monthCollection ?? 0)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Outstanding</p>
          <p className="text-2xl font-semibold text-red-600">{formatCurrency(kpis?.outstanding ?? 0)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Overdue</p>
          <p className="text-2xl font-semibold text-amber-600">{kpis?.overdueCount ?? 0}</p>
        </CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              t.id === activeTab ? 'border-gold text-navy dark:text-gold' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
            {t.id === 'overdue' && overdueCount > 0 && (
              <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                {overdueCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'all' && (
        <DataTable
          columns={paymentColumns}
          data={payments?.data ?? []}
          isLoading={paymentsLoading}
          emptyMessage="No payments recorded yet."
        />
      )}

      {activeTab === 'overdue' && (
        <DataTable
          columns={overdueColumns}
          data={overdue ?? []}
          isLoading={overdueLoading}
          emptyMessage="No overdue installments."
        />
      )}
    </div>
  );
}
