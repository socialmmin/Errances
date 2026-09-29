'use client';

import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useCustomer, useDeleteCustomer } from '@/hooks/use-customers';
import { CustomerForm } from '@/components/customers/customer-form';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { PERMISSIONS } from '@/lib/permissions';
import { Skeleton } from '@/components/ui/skeleton';
import { tr } from '@/i18n';

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data: customer, isLoading } = useCustomer(id);
  const deleteMutation = useDeleteCustomer();

  async function onDelete() {
    const ok = await confirm({
      title: tr("Delete this customer?"),
      description: tr("This is a soft delete — it can be restored by a super admin."),
      confirmLabel: tr("Delete"),
      variant: 'destructive',
    });
    if (!ok) return;
    await deleteMutation.mutateAsync(id);
    toast(tr("Customer deleted"), 'success');
    router.push('/customers');
  }

  if (isLoading) return <Skeleton className="h-64 w-full max-w-xl" />;
  if (!customer) return <p>{tr("Customer not found.")}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-navy dark:text-white">
          {customer.full_name} <span className="text-muted-foreground">· {customer.customer_code}</span>
        </h1>
        <PermissionGuard permission={PERMISSIONS.CUSTOMERS_DELETE}>
          <Button variant="destructive" size="sm" onClick={onDelete}>
            {tr("Delete")}
          </Button>
        </PermissionGuard>
      </div>
      <CustomerForm customer={customer} />
    </div>
  );
}
