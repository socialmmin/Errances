'use client';

import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useVendor, useDeleteVendor } from '@/hooks/use-vendors';
import { VendorForm } from '@/components/vendors/vendor-form';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { PERMISSIONS } from '@/lib/permissions';
import { Skeleton } from '@/components/ui/skeleton';
import { tr } from '@/i18n';

export default function VendorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data: vendor, isLoading } = useVendor(id);
  const deleteMutation = useDeleteVendor();

  async function onDelete() {
    const ok = await confirm({
      title: tr("Delete this vendor?"),
      description: tr("This is a soft delete — it can be restored by a super admin."),
      confirmLabel: tr("Delete"),
      variant: 'destructive',
    });
    if (!ok) return;
    await deleteMutation.mutateAsync(id);
    toast(tr("Vendor deleted"), 'success');
    router.push('/vendors');
  }

  if (isLoading) return <Skeleton className="h-64 w-full max-w-xl" />;
  if (!vendor) return <p>{tr("Vendor not found.")}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-navy dark:text-white">{vendor.name}</h1>
        <PermissionGuard permission={PERMISSIONS.VENDORS_EDIT}>
          <Button variant="destructive" size="sm" onClick={onDelete}>
            {tr("Delete")}
          </Button>
        </PermissionGuard>
      </div>
      <VendorForm vendor={vendor} />
    </div>
  );
}
