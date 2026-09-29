'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useCreateLead, useUpdateLead } from '@/hooks/use-leads';
import { Lead, LeadInput } from '@/types/lead';
import { useAuthStore } from '@/store/auth-store';
import { LEAD_STATUSES } from '@/lib/lead-statuses';
import { tr } from '@/i18n';

const TRAVEL_TYPES = ['family', 'couple', 'solo', 'group', 'corporate', 'honeymoon'];
const SOURCES = ['website', 'referral', 'walk_in', 'social_media', 'phone', 'whatsapp', 'agent', 'meta_ads', 'other'];

const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground';

export function LeadForm({ lead }: { lead?: Lead }) {
  const router = useRouter();
  const { toast } = useToast();
  const branchId = useAuthStore((s) => s.user?.branchId) ?? '';
  const isEdit = !!lead;

  const [form, setForm] = useState<LeadInput>({
    customerName: lead?.customer_name ?? '',
    phone: lead?.phone ?? '',
    whatsappNumber: lead?.whatsapp_number ?? '',
    email: lead?.email ?? '',
    nationality: lead?.nationality ?? '',
    destination: lead?.destination ?? '',
    travelFrom: lead?.travel_from ?? '',
    travelTo: lead?.travel_to ?? '',
    adults: lead?.adults ?? 1,
    children: lead?.children ?? 0,
    infants: lead?.infants ?? 0,
    budget: lead?.budget ?? undefined,
    travelType: lead?.travel_type ?? undefined,
    source: lead?.source ?? undefined,
    status: lead?.status ?? 'new',
    priority: lead?.priority ?? 'cold',
    expectedRevenue: lead?.expected_revenue ?? undefined,
    remarks: lead?.remarks ?? '',
    branchId: lead?.branch_id ?? branchId,
  });

  const createMutation = useCreateLead();
  const updateMutation = useUpdateLead(lead?.id ?? '');
  const saving = createMutation.isPending || updateMutation.isPending;

  function set<K extends keyof LeadInput>(key: K, value: LeadInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // branchId in `form` was captured on first render, before the persisted
    // auth store finished hydrating from localStorage — always prefer the
    // live store value (falls back to the lead's own branch when editing).
    const payload = { ...form, branchId: lead?.branch_id ?? branchId ?? form.branchId };
    try {
      if (isEdit) {
        await updateMutation.mutateAsync(payload);
        toast(tr("Lead updated"), 'success');
      } else {
        await createMutation.mutateAsync(payload);
        toast(tr("Lead created"), 'success');
      }
      router.push('/leads');
    } catch (err: any) {
      toast(err.message || tr("Failed to save lead"), 'error');
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-6">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">{tr("Customer details")}</h2>
        <div className="space-y-1">
          <Label htmlFor="customerName">{tr("Customer Name")}</Label>
          <Input id="customerName" required value={form.customerName} onChange={(e) => set('customerName', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="phone">{tr("Phone")}</Label>
            <Input id="phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="whatsappNumber">{tr("WhatsApp Number")}</Label>
            <Input id="whatsappNumber" value={form.whatsappNumber} onChange={(e) => set('whatsappNumber', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="email">{tr("Email")}</Label>
            <Input id="email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="nationality">{tr("Nationality")}</Label>
            <Input id="nationality" value={form.nationality} onChange={(e) => set('nationality', e.target.value)} />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">{tr("Trip details")}</h2>
        <div className="space-y-1">
          <Label htmlFor="destination">{tr("Destination")}</Label>
          <Input id="destination" value={form.destination} onChange={(e) => set('destination', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="travelFrom">{tr("Travel From")}</Label>
            <Input id="travelFrom" type="date" value={form.travelFrom} onChange={(e) => set('travelFrom', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="travelTo">{tr("Travel To")}</Label>
            <Input id="travelTo" type="date" value={form.travelTo} onChange={(e) => set('travelTo', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label htmlFor="adults">{tr("Adults")}</Label>
            <Input id="adults" type="number" min={0} value={form.adults} onChange={(e) => set('adults', Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="children">{tr("Children")}</Label>
            <Input id="children" type="number" min={0} value={form.children} onChange={(e) => set('children', Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="infants">{tr("Infants")}</Label>
            <Input id="infants" type="number" min={0} value={form.infants} onChange={(e) => set('infants', Number(e.target.value))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="travelType">{tr("Travel Type")}</Label>
            <select id="travelType" className={selectClass} value={form.travelType ?? ''} onChange={(e) => set('travelType', e.target.value || undefined)}>
              <option value="">{tr("Select…")}</option>
              {TRAVEL_TYPES.map((t) => (
                <option key={t} value={t}>{tr(t.replace(/_/g, ' '))}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="budget">{tr("Budget (₹)")}</Label>
            <Input id="budget" type="number" min={0} value={form.budget ?? ''} onChange={(e) => set('budget', e.target.value ? Number(e.target.value) : undefined)} />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">{tr("Lead management")}</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="source">{tr("Source")}</Label>
            <select id="source" className={selectClass} value={form.source ?? ''} onChange={(e) => set('source', e.target.value || undefined)}>
              <option value="">{tr("Select…")}</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{tr(s.replace(/_/g, ' '))}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="expectedRevenue">{tr("Expected Revenue (₹)")}</Label>
            <Input id="expectedRevenue" type="number" min={0} value={form.expectedRevenue ?? ''} onChange={(e) => set('expectedRevenue', e.target.value ? Number(e.target.value) : undefined)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="status">{tr("Status")}</Label>
            <select id="status" className={selectClass} value={form.status} onChange={(e) => set('status', e.target.value)}>
              {LEAD_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{tr(s.label)}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="remarks">{tr("Remarks")}</Label>
          <textarea
            id="remarks"
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
            value={form.remarks}
            onChange={(e) => set('remarks', e.target.value)}
          />
        </div>
      </section>

      <div className="flex gap-2">
        <Button type="submit" variant="gold" disabled={saving}>
          {saving ? tr("Saving…") : isEdit ? tr("Save changes") : tr("Create lead")}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push('/leads')}>
          {tr("Cancel")}
        </Button>
      </div>
    </form>
  );
}
