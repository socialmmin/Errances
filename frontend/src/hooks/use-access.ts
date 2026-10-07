'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';

export interface AccessItem { key: string; label: string; parent?: string; sensitive?: boolean }
export type AccessMap = Record<string, boolean>;
export interface AccessUserProfile { id: string; full_name: string; email: string | null; phone: string | null; is_active: boolean; participate_round_robin: boolean; last_login_at: string | null; role_description: string | null; assigned_leads: number }

// Which access key each page path belongs to. Anything not listed (Settings, lead detail pages,
// etc.) isn't controlled by the access panel.
export const PATH_ACCESS: { prefix: string; key: string }[] = [
  { prefix: '/dashboard', key: 'dashboard' },
  { prefix: '/leads', key: 'leads' },
  { prefix: '/followups', key: 'followups' },
  { prefix: '/callback-requests', key: 'callbacks' },
  { prefix: '/failed-whatsapp', key: 'failed_whatsapp' },
  { prefix: '/packages', key: 'packages' },
  { prefix: '/quotations', key: 'quotations' },
  { prefix: '/finance/invoices', key: 'invoices' },
  { prefix: '/payment-reminders', key: 'invoices' },
  { prefix: '/vendors', key: 'invoices' },
  { prefix: '/finance/report', key: 'invoices' },
  { prefix: '/whatsapp', key: 'whatsapp' },
  { prefix: '/bulk-whatsapp', key: 'whatsapp_broadcast' },
  { prefix: '/reports', key: 'reports' },
  { prefix: '/meta-quality', key: 'meta_quality' },
];

export function accessKeyForPath(pathname: string | null): string | null {
  if (!pathname) return null;
  return PATH_ACCESS.find((p) => pathname === p.prefix || pathname.startsWith(`${p.prefix}/`))?.key ?? null;
}

// What the logged-in person can see. The server enforces the same rules on every request; this
// only decides what to show, so nothing is offered that would just fail.
export function useMyAccess() {
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.roleName === 'super_admin';
  const query = useQuery({
    queryKey: ['my-access', user?.id],
    queryFn: () => api.get<{ catalog: AccessItem[]; access: AccessMap }>('/users/me/access'),
    enabled: !!user && !isSuperAdmin,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const loaded = isSuperAdmin || !!query.data;
  // Until loaded, deny -- briefly hiding a link is better than flashing something they can't open.
  const can = (...keys: string[]) => isSuperAdmin || keys.some((k) => !!query.data?.access[k]);
  return { can, loaded, isSuperAdmin };
}

export function useUserAccess(userId: string | null) {
  return useQuery({
    queryKey: ['user-access', userId],
    queryFn: () => api.get<{ catalog: AccessItem[]; roleName: string; user: AccessUserProfile; defaults: AccessMap; access: AccessMap }>(`/users/${userId}/access`),
    enabled: !!userId,
  });
}

export function useSaveUserAccess(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (access: AccessMap) => api.put<{ access: AccessMap }>(`/users/${userId}/access`, { access }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-access', userId] });
      qc.invalidateQueries({ queryKey: ['my-access'] });
    },
  });
}
