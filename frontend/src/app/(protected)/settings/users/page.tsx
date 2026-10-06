'use client';

import { useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Plus, Shuffle, LayoutGrid } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth-store';
import { DataTable } from '@/components/shared/data-table';
import { ErrorBoundary } from '@/components/shared/error-boundary';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { PERMISSIONS } from '@/lib/permissions';
import { useSettingsUsers, useCreateSettingsUser, useUpdateSettingsUser, useDeleteSettingsUser } from '@/hooks/use-settings-users';
import { useRoles } from '@/hooks/use-roles';
import { UserRow } from '@/types/settings';
import { displayEmail } from '@/lib/display-email';
import { PasswordButton, PasswordDialog } from '@/components/settings/password-dialog';
import { DistributeLeadsDialog, useLeadDistribution } from '@/components/settings/lead-distribution';

function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let pw = '';
  for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

// Plain-language summary of what each role can actually do -- written from the real permission
// lists in backend/src/common/rbac/role-permissions.ts, so picking a role isn't a guess.
const ROLE_GUIDE: Record<string, string> = {
  sales_executive: 'Handles leads day to day: view/add/edit leads, create quotations, follow-ups and tasks. Cannot see finance or delete anything.',
  sales_manager: 'Runs the sales team: everything a Sales Executive can do, plus assign leads, export, delete, approve and send quotations, and view reports.',
  operations_executive: 'Works on confirmed bookings: view and update bookings and operations tasks.',
  operations_manager: 'Runs operations: bookings (incl. cancel), vendors, itineraries/packages and operations reports.',
  accounts_executive: 'Collects payments and views finance. Cannot approve refunds.',
  accounts_manager: 'Full finance: payments, refund approvals, finance and business reports.',
  marketing_executive: 'Adds and views leads and sees reports. Cannot edit leads or quotations.',
  hr_executive: 'HR records only. No access to leads, sales or finance.',
  support_staff: 'Read-only across leads, customers, bookings, quotations and finance, plus their own tasks.',
  branch_manager: 'Everything except managing users and roles.',
  super_admin: 'Full access to everything, including adding/removing employees. Give this only to owners.',
};

function AddUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const create = useCreateSettingsUser();
  const { data: rolesData } = useRoles();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState('');
  const [created, setCreated] = useState<{ login: string; password: string } | null>(null);

  // super_admin last -- it's the one role that should be a deliberate choice, not a default.
  const roles = [...(rolesData?.data ?? [])].sort((a, b) => (a.name === 'super_admin' ? 1 : b.name === 'super_admin' ? -1 : a.name.localeCompare(b.name)));
  const selectedRole = roles.find((r) => r.id === roleId);
  const mobileDigits = (() => { let d = phone.replace(/\D/g, ''); if (d.length === 12 && d.startsWith('91')) d = d.slice(2); if (d.length === 11 && d.startsWith('0')) d = d.slice(1); return d; })();
  const mobileValid = /^[6-9]\d{9}$/.test(mobileDigits);

  if (!open) return null;

  function reset() {
    setFullName(''); setEmail(''); setPhone(''); setPassword(''); setRoleId(''); setCreated(null);
  }

  async function submit() {
    try {
      await create.mutateAsync({ email: email.trim() || undefined, fullName: fullName.trim(), password, phone: mobileDigits, roleId });
      toast('Employee created', 'success');
      setCreated({ login: mobileDigits, password });
    } catch (error: any) {
      toast(error.message || 'Could not create the employee', 'error');
    }
  }

  if (created) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { reset(); onClose(); }}>
        <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
          <CardContent className="space-y-3 p-5">
            <h2 className="text-lg font-semibold text-navy dark:text-white">Employee Created</h2>
            <p className="text-sm text-muted-foreground">Share these login credentials — this password won't be shown again.</p>
            <div className="rounded-lg border bg-muted/30 p-3 font-mono text-sm">
              <p>Login ID: {created.login}</p>
              <p>Password: {created.password}</p>
            </div>
            <Button className="w-full" onClick={() => { reset(); onClose(); }}>Done</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="max-h-[85vh] w-full max-w-md overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <CardContent className="space-y-3 p-5">
          <h2 className="text-lg font-semibold text-navy dark:text-white">Add Employee</h2>
          <div><Label>Full Name *</Label><Input className="mt-1" autoComplete="off" value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
          {/* autoComplete="off"/data-lpignore/data-1p-ignore discourage password managers (LastPass,
              1Password, Chrome's own) from injecting their own UI into these fields -- that
              injection fighting with React over the same DOM node is what was crashing this page
              with "Failed to execute 'removeChild'...": the extension removes/replaces a node
              React still thinks it owns, right as the dialog state updates. Not fully bulletproof
              against every extension, but removes the single biggest trigger (email+password
              together, which password managers specifically target). */}
          <div>
            <Label>Mobile number *</Label>
            <Input className="mt-1" inputMode="tel" autoComplete="one-time-code" name="employee-mobile" placeholder="e.g. 98XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
            {phone.trim() && !mobileValid
              ? <p className="mt-1 text-xs font-semibold text-red-600">Enter a valid 10-digit mobile number</p>
              : <p className="mt-1 text-xs text-muted-foreground">The employee signs in with this number.</p>}
          </div>
          <div><Label>Email (optional)</Label><Input className="mt-1" type="email" autoComplete="off" data-lpignore="true" data-1p-ignore value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div>
            <Label>Password *</Label>
            <div className="mt-1 flex gap-2">
              <Input className="font-mono" autoComplete="new-password" data-lpignore="true" data-1p-ignore placeholder="Type a password, or click Generate" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button type="button" variant="outline" onClick={() => setPassword(genPassword())}>Generate</Button>
            </div>
            {password && password.length < 5 && <p className="mt-1 text-xs font-semibold text-red-600">At least 5 characters</p>}
          </div>
          <div>
            <Label>Role *</Label>
            <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm capitalize" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">Select role</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name.replace(/_/g, ' ')}</option>)}
            </select>
            {selectedRole && (
              <p className="mt-1.5 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {ROLE_GUIDE[selectedRole.name] ?? selectedRole.description ?? ''}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={!fullName.trim() || !mobileValid || password.length < 5 || !roleId || create.isPending} onClick={submit}>Create Employee</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsUsersPage() {
  const { data, isLoading } = useSettingsUsers();
  const update = useUpdateSettingsUser();
  const remove = useDeleteSettingsUser();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [addOpen, setAddOpen] = useState(false);
  const [passwordUser, setPasswordUser] = useState<UserRow|null>(null);
  const [distributeOpen, setDistributeOpen] = useState(false);
  const router = useRouter();
  const isSuperAdmin = useAuthStore((st) => st.user?.roleName) === 'super_admin';
  const { data: distribution } = useLeadDistribution(isSuperAdmin);

  const users = data?.data ?? [];

  async function onDelete(u: UserRow) {
    const ok = await confirm({
      title: `Remove "${u.full_name}"?`,
      description: 'This deactivates their login and removes them from every list. Their history is preserved, not deleted.',
      confirmLabel: 'Remove',
      variant: 'destructive',
    });
    if (!ok) return;
    await remove.mutateAsync(u.id);
    toast('Employee removed', 'success');
  }

  // Column order the owner asked for: Name, Role, Mobile, then login ID + password hidden behind an eye.
  const columns = useMemo<ColumnDef<UserRow, any>[]>(() => [
    { id: 'sn', header: 'S.No', cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.index + 1}</span> },
    {
      accessorKey: 'full_name', header: 'Name',
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.full_name}</p>
          {displayEmail(row.original.email) && <p className="text-xs text-muted-foreground">{displayEmail(row.original.email)}</p>}
        </div>
      ),
    },
    {
      id: 'role', header: 'Role',
      cell: ({ row }) => <span className="capitalize">{(row.original.role_name ?? '—').replace(/_/g, ' ')}</span>,
    },
    { accessorKey: 'phone', header: 'Mobile', cell:({row})=>row.original.phone||'—' },
    {
      id: 'leads', header: 'Assigned leads',
      cell: ({ row }) => row.original.role_name === 'super_admin' ? '—' : <div className="leading-tight"><button type="button" onClick={(e) => { e.stopPropagation(); router.push(`/settings/users/${row.original.id}?tab=leads`); }} className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${(row.original.assigned_leads ?? 0) > 0 ? 'bg-gold/15 text-amber-800 hover:bg-gold/25' : 'bg-slate-100 text-slate-500'}`} title="See this person's leads">{row.original.assigned_leads ?? 0}</button>{(row.original.assigned_leads ?? 0) > 0 && <p className="mt-1 text-[10px] text-slate-500"><span className="font-semibold text-emerald-700">{row.original.itinerary_sent ?? 0} itinerary sent</span> · <span className="font-semibold text-red-600">{(row.original.assigned_leads ?? 0) - (row.original.itinerary_sent ?? 0)} not sent</span></p>}</div>,
    },
    {
      id: 'login', header: 'Password',
      cell: ({ row }) => isSuperAdmin ? <PasswordButton onClick={() => setPasswordUser(row.original)} /> : '—',
    },
    {
      accessorKey: 'participate_round_robin', header: 'Round robin',
      cell: ({ row }) => row.original.role_name==='super_admin'?'—':<span onClick={(e)=>e.stopPropagation()}><Switch checked={row.original.participate_round_robin} onCheckedChange={(v)=>update.mutate({id:row.original.id,participateRoundRobin:v})}/></span>,
    },
    {
      accessorKey: 'is_active', header: 'Status',
      cell: ({ row }) => (
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Switch checked={row.original.is_active} onCheckedChange={(v) => update.mutate({ id: row.original.id, isActive: v })} />
          <span className="text-xs">{row.original.is_active ? 'Active' : 'Inactive'}</span>
        </div>
      ),
    },
    {
      id: 'actions', header: '',
      cell: ({ row }) => (
        <PermissionGuard permission={PERMISSIONS.SETTINGS_USERS}>
          <Button variant="ghost" size="sm" className="text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(row.original); }}>Remove</Button>
        </PermissionGuard>
      ),
    },
  ], [update, isSuperAdmin, router]);

  return (
    <ErrorBoundary label="The Users page">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-navy dark:text-white">User Management</h1>
            <p className="text-sm text-muted-foreground">Click an employee to choose which pages and sections they can see.</p>
          </div>
          <PermissionGuard permission={PERMISSIONS.SETTINGS_USERS}>
            <div className="flex gap-2"><Button size="sm" variant="gold" className="gap-1.5" onClick={() => router.push('/settings/team-board')}><LayoutGrid className="h-4 w-4" /> Team work board</Button>{isSuperAdmin && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDistributeOpen(true)}><Shuffle className="h-4 w-4" /> Distribute leads{(distribution?.unassigned ?? 0) > 0 ? ` (${distribution?.unassigned} unassigned)` : ''}</Button>}<Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add Employee</Button></div>
          </PermissionGuard>
        </div>

        {isSuperAdmin && distribution && (() => {
          // Lead hand-out at a glance: everything adds up -- each person's count, summed, plus the
          // unassigned ones, must equal the total.
          const handlers = users.filter((u) => u.role_name !== 'super_admin' && (u.assigned_leads ?? 0) > 0);
          const assigned = users.reduce((n, u) => n + (u.assigned_leads ?? 0), 0);
          const sent = users.reduce((n, u) => n + (u.itinerary_sent ?? 0), 0);
          const tallies = assigned + distribution.unassigned === distribution.total;
          const tiles = [
            { label: 'Total leads', value: distribution.total, cls: 'text-white' },
            { label: 'Assigned', value: assigned, cls: 'text-emerald-300' },
            { label: 'Unassigned', value: distribution.unassigned, cls: distribution.unassigned ? 'text-amber-300' : 'text-slate-300' },
            { label: 'Itinerary sent', value: sent, cls: 'text-sky-300' },
            { label: 'Itinerary not sent', value: assigned - sent, cls: 'text-rose-300' },
          ];
          return (
            <section className="rounded-2xl bg-gradient-to-br from-navy to-slate-900 p-5 text-white shadow-xl">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {tiles.map((t) => <div key={t.label} className="rounded-xl bg-white/5 p-3"><p className={`text-2xl font-bold tabular-nums ${t.cls}`}>{t.value}</p><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t.label}</p></div>)}
              </div>
              <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-white/10 pt-3 text-xs text-slate-300">
                {handlers.map((u, i) => <span key={u.id}>{i > 0 && '+ '}<b className="text-white">{u.full_name}</b> {u.assigned_leads}</span>)}
                {distribution.unassigned > 0 && <span>+ <b className="text-amber-300">Unassigned</b> {distribution.unassigned}</span>}
                <span>= <b className="text-white">{assigned + distribution.unassigned}</b></span>
                <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${tallies ? 'bg-emerald-400/20 text-emerald-300' : 'bg-red-400/20 text-red-300'}`}>{tallies ? `✓ matches the ${distribution.total} total` : `✗ doesn't match the ${distribution.total} total`}</span>
              </p>
            </section>
          );
        })()}
        <ErrorBoundary label="The employee list">
          <DataTable columns={columns} data={users} isLoading={isLoading} emptyMessage="No employees found" onRowClick={(u) => router.push(`/settings/users/${u.id}`)} />
        </ErrorBoundary>

        <AddUserDialog open={addOpen} onClose={() => setAddOpen(false)} />
        {passwordUser && <PasswordDialog user={passwordUser} onClose={() => setPasswordUser(null)} />}
        {distributeOpen && <DistributeLeadsDialog onClose={() => setDistributeOpen(false)} />}
      </div>
    </ErrorBoundary>
  );
}
