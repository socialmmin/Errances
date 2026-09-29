'use client';

import { useState } from 'react';
import { Shield, Check } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { TableSkeleton } from '@/components/ui/skeleton';
import { useRoles } from '@/hooks/use-roles';
import { tr } from '@/i18n';

const PERMISSION_GROUPS: { label: string; prefix: string }[] = [
  { label: 'Leads', prefix: 'leads:' },
  { label: 'Customers', prefix: 'customers:' },
  { label: 'Quotations', prefix: 'quotations:' },
  { label: 'Bookings', prefix: 'bookings:' },
  { label: 'Finance', prefix: 'finance:' },
  { label: 'Vendors', prefix: 'vendors:' },
  { label: 'Packages', prefix: 'packages:' },
  { label: 'Tasks', prefix: 'tasks:' },
  { label: 'Masters', prefix: 'masters:' },
  { label: 'Operations', prefix: 'operations:' },
  { label: 'Reports', prefix: 'reports:' },
  { label: 'Settings', prefix: 'settings:' },
  { label: 'HR', prefix: 'hr:' },
];

export default function SettingsRolesPage() {
  const { data, isLoading } = useRoles();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const roles = data?.data ?? [];
  const activeRole = roles.find((r) => r.id === selectedId);
  const activePerms = new Set(activeRole?.permissions ?? []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-navy dark:text-white">{tr("Role Management")}</h1>
        <p className="text-sm text-muted-foreground">{tr("View role permissions matrix")}</p>
      </div>

      {isLoading ? <TableSkeleton /> : (
        <div className="grid gap-4 lg:grid-cols-4">
          <div className="space-y-2">
            {roles.map((role) => (
              <button
                key={role.id}
                onClick={() => setSelectedId(role.id)}
                className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                  selectedId === role.id ? 'border-gold bg-gold/5 shadow-sm' : 'hover:border-gold/50'
                }`}
              >
                <Shield className={`h-4 w-4 ${selectedId === role.id ? 'text-gold' : 'text-muted-foreground'}`} />
                <div>
                  <p className="text-sm font-medium capitalize">{tr(role.name.replace(/_/g, ' '))}</p>
                  {role.description && <p className="line-clamp-1 text-xs text-muted-foreground">{tr(role.description)}</p>}
                </div>
              </button>
            ))}
          </div>

          <div className="lg:col-span-3">
            {!selectedId ? (
              <Card><CardContent className="flex h-64 items-center justify-center p-4 text-sm text-muted-foreground">{tr("Select a role to view its permissions")}</CardContent></Card>
            ) : (
              <Card>
                <CardContent className="p-4">
                  <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold capitalize text-navy dark:text-white">
                    <Shield className="h-5 w-5 text-gold" />
                    {tr(activeRole?.name.replace(/_/g, ' '))}{' '}{tr("— Permissions")}
                  </h2>
                  <div className="space-y-4">
                    {PERMISSION_GROUPS.map((group) => {
                      const perms = Array.from(activePerms).filter((p) => p.startsWith(group.prefix));
                      const allInGroup = Array.from(new Set([...perms])); // group has perms only if role includes any with this prefix
                      if (!allInGroup.length) return null;
                      return (
                        <div key={group.label}>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{tr(group.label)}</p>
                          <div className="flex flex-wrap gap-2">
                            {allInGroup.map((p) => (
                              <div key={p} className="flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                <Check className="h-3 w-3" />
                                {tr(p.split(':')[1]?.replace(/_/g, ' '))}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
