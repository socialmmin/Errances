'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/shared/data-table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { PERMISSIONS } from '@/lib/permissions';
import { useCustomers } from '@/hooks/use-customers';
import { Customer } from '@/types/customer';

const columns: ColumnDef<Customer>[] = [
  { accessorKey: 'customer_code', header: 'Code' },
  { accessorKey: 'full_name', header: 'Name' },
  { accessorKey: 'phone', header: 'Phone' },
  { accessorKey: 'city', header: 'City' },
  { accessorKey: 'type', header: 'Type' },
  { accessorKey: 'loyalty_points', header: 'Loyalty Pts' },
];

export default function CustomersPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const { data, isLoading, isError, error } = useCustomers({ search: search || undefined });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-navy dark:text-white">Customers</h1>
        <PermissionGuard permission={PERMISSIONS.CUSTOMERS_CREATE}>
          <Link href="/customers/new">
            <Button variant="gold">+ New Customer</Button>
          </Link>
        </PermissionGuard>
      </div>

      <Input
        placeholder="Search by name, phone, or email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {isError && (
        <p className="text-sm text-red-500">
          Failed to load customers: {(error as Error)?.message ?? 'unknown error'}
        </p>
      )}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        onRowClick={(row) => router.push(`/customers/${row.id}`)}
        emptyMessage="No customers yet."
      />
    </div>
  );
}
