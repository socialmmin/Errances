'use client';

import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { usePackage, useDeletePackage } from '@/hooks/use-packages';
import { PackageForm } from '@/components/packages/package-form';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { PERMISSIONS } from '@/lib/permissions';
import { Skeleton } from '@/components/ui/skeleton';
import { tr } from '@/i18n';

export default function PackageDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data: pkg, isLoading } = usePackage(id);
  const deleteMutation = useDeletePackage();

  async function onDelete() {
    const ok = await confirm({
      title: tr("Delete this package?"),
      description: tr("This is a soft delete — it can be restored by a super admin."),
      confirmLabel: tr("Delete"),
      variant: 'destructive',
    });
    if (!ok) return;
    await deleteMutation.mutateAsync(id);
    toast(tr("Package deleted"), 'success');
    router.push('/packages');
  }

  if (isLoading) return <Skeleton className="h-64 w-full max-w-xl" />;
  if (!pkg) return <p>{tr("Package not found.")}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-navy dark:text-white">
          {pkg.name} {pkg.package_code && <span className="text-muted-foreground">· {pkg.package_code}</span>}
        </h1>
        <PermissionGuard permission={PERMISSIONS.PACKAGES_DELETE}>
          <Button variant="destructive" size="sm" onClick={onDelete}>
            {tr("Delete")}
          </Button>
        </PermissionGuard>
      </div>
      <PackageForm pkg={pkg} />
    </div>
  );
}
