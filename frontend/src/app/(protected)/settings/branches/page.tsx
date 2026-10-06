'use client';

import { useState } from 'react';
import { Plus, MapPin, Phone } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TableSkeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { PERMISSIONS } from '@/lib/permissions';
import { useBranches, useCreateBranch, useUpdateBranch, useDeleteBranch } from '@/hooks/use-branches';

function AddBranchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const create = useCreateBranch();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('India');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  if (!open) return null;

  function reset() {
    setName(''); setCity(''); setCountry('India'); setPhone(''); setEmail('');
  }

  async function submit() {
    if (!name.trim()) return;
    await create.mutateAsync({ name, city: city || undefined, country: country || undefined, phone: phone || undefined, email: email || undefined });
    toast('Branch created', 'success');
    reset();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <CardContent className="space-y-3 p-5">
          <h2 className="text-lg font-semibold text-navy dark:text-white">Add Branch</h2>
          <div><Label>Name *</Label><Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>City</Label><Input className="mt-1" value={city} onChange={(e) => setCity(e.target.value)} /></div>
            <div><Label>Country</Label><Input className="mt-1" value={country} onChange={(e) => setCountry(e.target.value)} /></div>
          </div>
          <div><Label>Phone</Label><Input className="mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div><Label>Email</Label><Input className="mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={!name.trim() || create.isPending} onClick={submit}>Create Branch</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsBranchesPage() {
  const { data, isLoading } = useBranches();
  const update = useUpdateBranch();
  const remove = useDeleteBranch();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [addOpen, setAddOpen] = useState(false);

  const branches = data?.data ?? [];

  async function onDelete(id: string, name: string) {
    const ok = await confirm({
      title: `Delete "${name}"?`,
      description: 'This is a soft delete — it can be restored later.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    });
    if (!ok) return;
    await remove.mutateAsync(id);
    toast('Branch deleted', 'success');
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-navy dark:text-white">Settings — Branches</h1>
          <p className="text-sm text-muted-foreground">Manage office locations</p>
        </div>
        <PermissionGuard permission={PERMISSIONS.SETTINGS_BRANCHES}>
          <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add Branch</Button>
        </PermissionGuard>
      </div>

      {isLoading ? <TableSkeleton /> : !branches.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No branches yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map((b) => (
            <Card key={b.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-navy dark:text-white">{b.name}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" /> {b.city ?? '—'}{b.country ? `, ${b.country}` : ''}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${b.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}>
                    {b.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                {b.phone && <p className="flex items-center gap-1 text-xs text-muted-foreground"><Phone className="h-3 w-3" /> {b.phone}</p>}
                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-2">
                    <Switch checked={b.is_active} onCheckedChange={(v) => update.mutate({ id: b.id, isActive: v })} />
                    <span className="text-xs text-muted-foreground">Active</span>
                  </div>
                  <PermissionGuard permission={PERMISSIONS.SETTINGS_BRANCHES}>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => onDelete(b.id, b.name)}>Delete</Button>
                  </PermissionGuard>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AddBranchDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
