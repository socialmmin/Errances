'use client';

import { useAuthStore } from '@/store/auth-store';
import { hasPermission, Permission } from '@/lib/permissions';

export function usePermission() {
  const role = useAuthStore((s) => s.user?.roleName);
  return {
    role,
    can: (permission: Permission) => hasPermission(role, permission),
  };
}
