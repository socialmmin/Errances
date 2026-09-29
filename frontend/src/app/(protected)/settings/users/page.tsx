'use client';

import { useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { DataTable } from '@/components/shared/data-table';
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
import { useBranches } from '@/hooks/use-branches';
import { UserRow } from '@/types/settings';
import { tr } from '@/i18n';

function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let pw = '';
  for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

function AddUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const create = useCreateSettingsUser();
  const { data: rolesData } = useRoles();
  const { data: branchesData } = useBranches();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState(genPassword());
  const [roleId, setRoleId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [created, setCreated] = useState<{ login: string; password: string } | null>(null);

  const roles = rolesData?.data ?? [];
  const branches = branchesData?.data ?? [];

  if (!open) return null;

  function reset() {
    setFullName(''); setEmail(''); setPhone(''); setPassword(genPassword());
    setRoleId(''); setBranchId(''); setEmployeeCode(''); setCreated(null);
  }

  async function submit() {
    try {
      await create.mutateAsync({ email: email.trim() || undefined, fullName: fullName.trim(), password, phone: phone.trim() || undefined, employeeCode: employeeCode.trim() || undefined, roleId, branchId });
      toast(tr("Employee created"), 'success');
      setCreated({ login: email.trim() || phone.trim(), password });
    } catch (error: any) {
      toast(error.message || tr("Could not create the employee"), 'error');
    }
  }

  if (created) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { reset(); onClose(); }}>
        <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
          <CardContent className="space-y-3 p-5">
            <h2 className="text-lg font-semibold text-navy dark:text-white">{tr("Employee Created")}</h2>
            <p className="text-sm text-muted-foreground">{tr("Share these login credentials — this password won't be shown again.")}</p>
            <div className="rounded-lg border bg-muted/30 p-3 font-mono text-sm">
              <p>{tr("Login ID:")}{' '}{created.login}</p>
              <p>{tr("Password:")}{' '}{created.password}</p>
            </div>
            <Button className="w-full" onClick={() => { reset(); onClose(); }}>{tr("Done")}</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="max-h-[85vh] w-full max-w-md overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <CardContent className="space-y-3 p-5">
          <h2 className="text-lg font-semibold text-navy dark:text-white">{tr("Add Employee")}</h2>
          <div><Label>{tr("Full Name *")}</Label><Input className="mt-1" value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
          <div><Label>{tr("Email")}</Label><Input className="mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><Label>{tr("Mobile number")}</Label><Input className="mt-1" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /><p className="mt-1 text-xs text-muted-foreground">{tr("Employees can sign in with their mobile number or email. Enter at least one.")}</p></div>
          <div><Label>{tr("Employee Code")}</Label><Input className="mt-1" value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} /></div>
          <div>
            <Label>{tr("Temporary Password *")}</Label>
            <div className="mt-1 flex gap-2">
              <Input className="font-mono" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button type="button" variant="outline" onClick={() => setPassword(genPassword())}>{tr("Regenerate")}</Button>
            </div>
          </div>
          <div>
            <Label>{tr("Role *")}</Label>
            <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">{tr("Select role")}</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{tr(r.name.replace(/_/g, ' '))}</option>)}
            </select>
          </div>
          <div>
            <Label>{tr("Branch *")}</Label>
            <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">{tr("Select branch")}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>{tr("Cancel")}</Button>
            <Button disabled={!fullName || (!email&&!phone) || !password || !roleId || !branchId || create.isPending} onClick={submit}>{tr("Create Employee")}</Button>
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
  const [resetUser, setResetUser] = useState<UserRow|null>(null);
  const [resetPassword, setResetPassword] = useState(genPassword());

  const users = data?.data ?? [];

  async function onDelete(u: UserRow) {
    const ok = await confirm({
      title: tr("Remove \"{full_name}\"?", { full_name: u.full_name }),
      description: tr("This deactivates their login and removes them from every list. Their history is preserved, not deleted."),
      confirmLabel: tr("Remove"),
      variant: 'destructive',
    });
    if (!ok) return;
    await remove.mutateAsync(u.id);
    toast(tr("Employee removed"), 'success');
  }

  const columns = useMemo<ColumnDef<UserRow, any>[]>(() => [
    {
      accessorKey: 'full_name', header: 'Name',
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.full_name}</p>
          <p className="text-xs text-muted-foreground">{row.original.employee_code ?? '—'}</p>
        </div>
      ),
    },
    { accessorKey: 'email', header: 'Email' },
    { accessorKey: 'phone', header: 'Mobile', cell:({row})=>row.original.phone||'—' },
    {
      accessorKey: 'participate_round_robin', header: 'Round robin',
      cell: ({ row }) => row.original.role_name==='super_admin'?'—':<Switch checked={row.original.participate_round_robin} onCheckedChange={(v)=>update.mutate({id:row.original.id,participateRoundRobin:v})}/>,
    },
    {
      id: 'role', header: 'Role',
      cell: ({ row }) => <span className="capitalize">{tr((row.original.role_name ?? '—').replace(/_/g, ' '))}</span>,
    },
    { id: 'branch', header: 'Branch', cell: ({ row }) => row.original.branch_name ?? '—' },
    {
      accessorKey: 'is_active', header: 'Status',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Switch checked={row.original.is_active} onCheckedChange={(v) => update.mutate({ id: row.original.id, isActive: v })} />
          <span className="text-xs">{row.original.is_active ? tr("Active") : tr("Inactive")}</span>
        </div>
      ),
    },
    {
      id: 'actions', header: '',
      cell: ({ row }) => (
        <PermissionGuard permission={PERMISSIONS.SETTINGS_USERS}>
          <div className="flex gap-1"><Button variant="ghost" size="sm" onClick={(e)=>{e.stopPropagation();setResetPassword(genPassword());setResetUser(row.original);}}>{tr("Reset password")}</Button><Button variant="ghost" size="sm" className="text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(row.original); }}>{tr("Remove")}</Button></div>
        </PermissionGuard>
      ),
    },
  ], [update]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-navy dark:text-white">{tr("User Management")}</h1>
          <p className="text-sm text-muted-foreground">{tr("Manage team members, roles and branch assignment")}</p>
        </div>
        <PermissionGuard permission={PERMISSIONS.SETTINGS_USERS}>
          <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" />{' '}{tr("Add Employee")}</Button>
        </PermissionGuard>
      </div>

      <DataTable columns={columns} data={users} isLoading={isLoading} emptyMessage="No employees found" />

      <AddUserDialog open={addOpen} onClose={() => setAddOpen(false)} />
      {resetUser&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={()=>setResetUser(null)}><Card className="w-full max-w-sm" onClick={e=>e.stopPropagation()}><CardContent className="space-y-4 p-5"><div><h2 className="font-semibold">{tr("Reset password")}</h2><p className="text-sm text-muted-foreground">{tr("Create a temporary password for")}{' '}{resetUser.full_name}{tr(". It is shown only now.")}</p></div><Input className="font-mono" value={resetPassword} onChange={e=>setResetPassword(e.target.value)}/><div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setResetUser(null)}>{tr("Cancel")}</Button><Button disabled={resetPassword.length<6} onClick={()=>update.mutateAsync({id:resetUser.id,password:resetPassword}).then(()=>toast(tr("Password reset: {resetPassword}", { resetPassword: resetPassword }),'success')).then(()=>setResetUser(null))}>{tr("Reset password")}</Button></div></CardContent></Card></div>}
    </div>
  );
}
