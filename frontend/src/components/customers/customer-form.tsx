'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useCreateCustomer, useUpdateCustomer } from '@/hooks/use-customers';
import { Customer, CustomerInput } from '@/types/customer';
import { useAuthStore } from '@/store/auth-store';
import { tr } from '@/i18n';

export function CustomerForm({ customer }: { customer?: Customer }) {
  const router = useRouter();
  const { toast } = useToast();
  const branchId = useAuthStore((s) => s.user?.branchId) ?? '';
  const isEdit = !!customer;

  const [form, setForm] = useState<CustomerInput>({
    fullName: customer?.full_name ?? '',
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    city: customer?.city ?? '',
    country: customer?.country ?? '',
    type: customer?.type ?? 'individual',
    branchId: customer?.branch_id ?? branchId,
  });

  const createMutation = useCreateCustomer();
  const updateMutation = useUpdateCustomer(customer?.id ?? '');
  const saving = createMutation.isPending || updateMutation.isPending;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // branchId in `form` was captured on first render, before the persisted
    // auth store finished hydrating from localStorage — always prefer the
    // live store value (falls back to the customer's own branch when editing).
    const payload = { ...form, branchId: customer?.branch_id ?? branchId ?? form.branchId };
    try {
      if (isEdit) {
        await updateMutation.mutateAsync(payload);
        toast(tr("Customer updated"), 'success');
      } else {
        await createMutation.mutateAsync(payload);
        toast(tr("Customer created"), 'success');
      }
      router.push('/customers');
    } catch (err: any) {
      toast(err.message || tr("Failed to save customer"), 'error');
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4">
      <div className="space-y-1">
        <Label htmlFor="fullName">{tr("Full Name")}</Label>
        <Input
          id="fullName"
          required
          value={form.fullName}
          onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="phone">{tr("Phone")}</Label>
          <Input
            id="phone"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="email">{tr("Email")}</Label>
          <Input
            id="email"
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="city">{tr("City")}</Label>
          <Input
            id="city"
            value={form.city}
            onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="country">{tr("Country")}</Label>
          <Input
            id="country"
            value={form.country}
            onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="type">{tr("Type")}</Label>
        <select
          id="type"
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={form.type}
          onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
        >
          {['individual', 'corporate', 'agent'].map((t) => (
            <option key={t} value={t}>{tr(t)}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <Button type="submit" variant="gold" disabled={saving}>
          {saving ? tr("Saving…") : isEdit ? tr("Save changes") : tr("Create customer")}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push('/customers')}>
          {tr("Cancel")}
        </Button>
      </div>
    </form>
  );
}
