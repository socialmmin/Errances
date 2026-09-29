'use client';

import { usePermission } from '@/hooks/use-permission';
import { Permission } from '@/lib/permissions';

interface PermissionGuardProps {
  permission: Permission;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

// Wrap any action button/section that requires a permission. Ported from
// the RBAC pattern in hala-audit (frontend/src/lib/permissions.ts consumers)
// — UI-level only; the backend PermissionsGuard is what actually enforces it.
export function PermissionGuard({ permission, fallback = null, children }: PermissionGuardProps) {
  const { can } = usePermission();
  if (!can(permission)) return <>{fallback}</>;
  return <>{children}</>;
}
