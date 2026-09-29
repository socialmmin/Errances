'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useCreateVendor, useUpdateVendor } from '@/hooks/use-vendors';
import { Vendor, VendorInput } from '@/types/vendor';
import { useAuthStore } from '@/store/auth-store';
import { tr } from '@/i18n';

const VENDOR_TYPES = ['hotel', 'transport', 'guide', 'restaurant', 'activity', 'other'];
const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground';

export function VendorForm({ vendor }: { vendor?: Vendor }) {
  const router = useRouter();
  const { toast } = useToast();
  const branchId = useAuthStore((s) => s.user?.branchId) ?? '';
  const isEdit = !!vendor;

  const [form, setForm] = useState<VendorInput>({
    name: vendor?.name ?? '',
    type: vendor?.type ?? undefined,
    phone: vendor?.phone ?? '',
    email: vendor?.email ?? '',
    address: vendor?.address ?? '',
    gstNumber: vendor?.gst_number ?? '',
    branchId: vendor?.branch_id ?? branchId,
  });

  const createMutation = useCreateVendor();
  const updateMutation = useUpdateVendor(vendor?.id ?? '');
  const saving = createMutation.isPending || updateMutation.isPending;

  function set<K extends keyof VendorInput>(key: K, value: VendorInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = { ...form, branchId: vendor?.branch_id ?? branchId ?? form.branchId };
    try {
      if (isEdit) {
        await updateMutation.mutateAsync(payload);
        toast(tr("Vendor updated"), 'success');
      } else {
        await createMutation.mutateAsync(payload);
        toast(tr("Vendor created"), 'success');
      }
      router.push('/vendors');
    } catch (err: any) {
      toast(err.message || tr("Failed to save vendor"), 'error');
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4">
      <div className="space-y-1">
        <Label htmlFor="name">{tr("Vendor Name")}</Label>
        <Input id="name" required value={form.name} onChange={(e) => set('name', e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="type">{tr("Type")}</Label>
          <select id="type" className={selectClass} value={form.type ?? ''} onChange={(e) => set('type', e.target.value || undefined)}>
            <option value="">{tr("Select…")}</option>
            {VENDOR_TYPES.map((t) => (
              <option key={t} value={t}>{tr(t)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="gstNumber">{tr("GST Number")}</Label>
          <Input id="gstNumber" value={form.gstNumber} onChange={(e) => set('gstNumber', e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="phone">{tr("Phone")}</Label>
          <Input id="phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="email">{tr("Email")}</Label>
          <Input id="email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="address">{tr("Address")}</Label>
        <textarea
          id="address"
          rows={2}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          value={form.address}
          onChange={(e) => set('address', e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="gold" disabled={saving}>
          {saving ? tr("Saving…") : isEdit ? tr("Save changes") : tr("Create vendor")}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push('/vendors')}>
          {tr("Cancel")}
        </Button>
      </div>
    </form>
  );
}
