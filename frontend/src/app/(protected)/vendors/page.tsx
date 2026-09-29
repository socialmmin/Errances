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
import { useVendors } from '@/hooks/use-vendors';
import { Vendor } from '@/types/vendor';
import { tr } from '@/i18n';

const columns: ColumnDef<Vendor>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'type', header: 'Type' },
  { accessorKey: 'phone', header: 'Phone' },
  { accessorKey: 'email', header: 'Email' },
  { accessorKey: 'gst_number', header: 'GST Number' },
];

export default function VendorsPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const { data, isLoading, isError, error } = useVendors({ search: search || undefined });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-navy dark:text-white">{tr("Vendors")}</h1>
        <PermissionGuard permission={PERMISSIONS.VENDORS_CREATE}>
          <Link href="/vendors/new">
            <Button variant="gold">{tr("+ New Vendor")}</Button>
          </Link>
        </PermissionGuard>
      </div>

      <Input
        placeholder={tr("Search by name, phone, or email…")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {isError && (
        <p className="text-sm text-red-500">
          {tr("Failed to load vendors:")}{' '}{(error as Error)?.message ?? tr("unknown error")}
        </p>
      )}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        onRowClick={(row) => router.push(`/vendors/${row.id}`)}
        emptyMessage="No vendors yet. Add hotels, transport, or guide partners to get started."
      />
    </div>
  );
}
