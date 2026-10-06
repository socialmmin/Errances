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
import { MIN_REASON, ReasonFields, joinReason, needsReason } from '@/components/leads/reason-dialog';

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

  // Closing a lead as Not Interested / Lost needs a typed reason before it can be saved.
  const [reasonCategory, setReasonCategory] = useState('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [reasonTried, setReasonTried] = useState(false);
  const askReason = needsReason(String(form.status)) && form.status !== lead?.status;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (askReason && (!reasonCategory || reasonDetail.trim().length < MIN_REASON)) { setReasonTried(true); toast('Type the reason before saving this lead as closed', 'error'); return; }
    // branchId in `form` was captured on first render, before the persisted
    // auth store finished hydrating from localStorage — always prefer the
    // live store value (falls back to the lead's own branch when editing).
    const payload = { ...form, branchId: lead?.branch_id ?? branchId ?? form.branchId, ...(askReason ? { lostReason: joinReason(reasonCategory, reasonDetail) } : {}) };
    try {
      if (isEdit) {
        await updateMutation.mutateAsync(payload);
        toast('Lead updated', 'success');
      } else {
        await createMutation.mutateAsync(payload);
        toast('Lead created', 'success');
      }
      router.push('/leads');
    } catch (err: any) {
      toast(err.message || 'Failed to save lead', 'error');
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-6">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Customer details</h2>
        <div className="space-y-1">
          <Label htmlFor="customerName">Customer Name</Label>
          <Input id="customerName" required value={form.customerName} onChange={(e) => set('customerName', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="whatsappNumber">WhatsApp Number</Label>
            <Input id="whatsappNumber" value={form.whatsappNumber} onChange={(e) => set('whatsappNumber', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="nationality">Nationality</Label>
            <Input id="nationality" value={form.nationality} onChange={(e) => set('nationality', e.target.value)} />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Trip details</h2>
        <div className="space-y-1">
          <Label htmlFor="destination">Destination</Label>
          <Input id="destination" value={form.destination} onChange={(e) => set('destination', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="travelFrom">Travel From</Label>
            <Input id="travelFrom" type="date" value={form.travelFrom} onChange={(e) => set('travelFrom', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="travelTo">Travel To</Label>
            <Input id="travelTo" type="date" value={form.travelTo} onChange={(e) => set('travelTo', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label htmlFor="adults">Adults</Label>
            <Input id="adults" type="number" min={0} value={form.adults} onChange={(e) => set('adults', Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="children">Children</Label>
            <Input id="children" type="number" min={0} value={form.children} onChange={(e) => set('children', Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="infants">Infants</Label>
            <Input id="infants" type="number" min={0} value={form.infants} onChange={(e) => set('infants', Number(e.target.value))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="travelType">Travel Type</Label>
            <select id="travelType" className={selectClass} value={form.travelType ?? ''} onChange={(e) => set('travelType', e.target.value || undefined)}>
              <option value="">Select…</option>
              {TRAVEL_TYPES.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="budget">Budget (₹)</Label>
            <Input id="budget" type="number" min={0} value={form.budget ?? ''} onChange={(e) => set('budget', e.target.value ? Number(e.target.value) : undefined)} />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Lead management</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="source">Source</Label>
            <select id="source" className={selectClass} value={form.source ?? ''} onChange={(e) => set('source', e.target.value || undefined)}>
              <option value="">Select…</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="expectedRevenue">Expected Revenue (₹)</Label>
            <Input id="expectedRevenue" type="number" min={0} value={form.expectedRevenue ?? ''} onChange={(e) => set('expectedRevenue', e.target.value ? Number(e.target.value) : undefined)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="status">Status</Label>
            <select id="status" className={selectClass} value={form.status} onChange={(e) => set('status', e.target.value)}>
              {LEAD_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
        {askReason && <div className="rounded-xl border border-red-200 bg-red-50/50 p-3"><p className="mb-2 text-sm font-semibold text-red-700">Reason needed to close this lead</p><ReasonFields category={reasonCategory} detail={reasonDetail} onCategory={setReasonCategory} onDetail={setReasonDetail} showErrors={reasonTried} /></div>}
        <div className="space-y-1">
          <Label htmlFor="remarks">Remarks</Label>
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
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create lead'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push('/leads')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
