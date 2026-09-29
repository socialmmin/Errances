'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useCreateQuotation, useUpdateQuotation } from '@/hooks/use-quotations';
import { useLeads } from '@/hooks/use-leads';
import { useCustomers } from '@/hooks/use-customers';
import { Quotation, QuotationItemInput, QUOTATION_ITEM_CATEGORIES, marginColorClass } from '@/types/quotation';
import { useAuthStore } from '@/store/auth-store';
import { tr, locale } from '@/i18n';

const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground';
const smallSelectClass = 'h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground';

function formatCurrency(n: number) {
  return new Intl.NumberFormat(locale(), { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
}

interface LineItemForm {
  id: string;
  category: string;
  description: string;
  unitCost: number;
  quantity: number;
  markupPct: number;
}

function newLineItem(): LineItemForm {
  return { id: crypto.randomUUID(), category: 'hotel', description: '', unitCost: 0, quantity: 1, markupPct: 15 };
}

export function QuotationBuilder({ quotation }: { quotation?: Quotation }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const branchId = useAuthStore((s) => s.user?.branchId) ?? '';
  const isEdit = !!quotation;

  const { data: leadsData } = useLeads();
  const { data: customersData } = useCustomers();
  const leads = leadsData?.data ?? [];
  const customers = customersData?.data ?? [];

  const [leadId, setLeadId] = useState(quotation?.lead_id ?? '');
  const [customerId, setCustomerId] = useState(quotation?.customer_id ?? '');
  const [destination, setDestination] = useState(quotation?.destination ?? '');
  const [travelFrom, setTravelFrom] = useState(quotation?.travel_from ?? '');
  const [travelTo, setTravelTo] = useState(quotation?.travel_to ?? '');
  const [adults, setAdults] = useState(quotation?.adults ?? 2);
  const [children, setChildren] = useState(quotation?.children ?? 0);
  const [validUntil, setValidUntil] = useState(quotation?.valid_until ?? '');
  const [notes, setNotes] = useState(quotation?.notes ?? '');
  const [internalNotes, setInternalNotes] = useState(quotation?.internal_notes ?? '');

  const initialDiscountPct = quotation && quotation.base_amount > 0
    ? Math.round((quotation.discount_amount / quotation.base_amount) * 10000) / 100
    : 0;
  const initialGstPct = quotation && quotation.base_amount - quotation.discount_amount > 0
    ? Math.round((quotation.gst_amount / (quotation.base_amount - quotation.discount_amount)) * 10000) / 100
    : 5;
  const [discountPct, setDiscountPct] = useState(initialDiscountPct);
  const [gstPct, setGstPct] = useState(initialGstPct);

  const [lineItems, setLineItems] = useState<LineItemForm[]>(
    quotation?.items?.length
      ? quotation.items.map((item) => ({
          id: item.id,
          category: item.category ?? item.item_type ?? 'other',
          description: item.description ?? '',
          unitCost: item.unit_cost ?? 0,
          quantity: item.quantity,
          markupPct: item.markup_pct ?? 0,
        }))
      : [newLineItem()],
  );

  const createMutation = useCreateQuotation();
  const updateMutation = useUpdateQuotation(quotation?.id ?? '');
  const saving = createMutation.isPending || updateMutation.isPending;

  // Client-side preview of the same pricing formula the server computes
  // authoritatively — server always recomputes on save, this is display only.
  const pricing = useMemo(() => {
    const subtotal = lineItems.reduce((sum, item) => {
      const selling = item.unitCost * (1 + item.markupPct / 100);
      return sum + selling * item.quantity;
    }, 0);
    const discount = subtotal * (discountPct / 100);
    const taxable = subtotal - discount;
    const gst = taxable * (gstPct / 100);
    const total = taxable + gst;
    const costTotal = lineItems.reduce((sum, item) => sum + item.unitCost * item.quantity, 0);
    const profit = total - costTotal;
    const margin = total > 0 ? (profit / total) * 100 : 0;
    return { subtotal, discount, gst, total, costTotal, profit, margin };
  }, [lineItems, discountPct, gstPct]);

  function addLineItem() {
    setLineItems((items) => [...items, newLineItem()]);
  }
  function updateLineItem(id: string, patch: Partial<LineItemForm>) {
    setLineItems((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }
  function removeLineItem(id: string) {
    setLineItems((items) => items.filter((item) => item.id !== id));
  }

  function onSelectLead(id: string) {
    setLeadId(id);
    const lead = leads.find((l) => l.id === id);
    if (lead) {
      setDestination(lead.destination ?? '');
      setTravelFrom(lead.travel_from ?? '');
      setTravelTo(lead.travel_to ?? '');
      setAdults(lead.adults ?? 2);
      setChildren(lead.children ?? 0);
    }
  }

  // Arrived here with ?lead_id=... (e.g. from a callback outcome or a lead's own page) --
  // pre-select that lead as soon as the lead list has loaded, instead of making the person pick it again.
  useEffect(() => {
    if (isEdit) return;
    const fromUrl = searchParams.get('lead_id');
    if (fromUrl && !leadId && leads.some((l) => l.id === fromUrl)) onSelectLead(fromUrl);
  }, [searchParams, leads, isEdit, leadId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const items: QuotationItemInput[] = lineItems
      .filter((item) => item.description.trim().length > 0 || item.unitCost > 0)
      .map((item) => ({
        category: item.category,
        description: item.description || undefined,
        quantity: item.quantity,
        unitCost: item.unitCost,
        markupPct: item.markupPct,
      }));

    const payload = {
      leadId: leadId || null,
      customerId: customerId || null,
      destination: destination || undefined,
      travelFrom: travelFrom || undefined,
      travelTo: travelTo || undefined,
      adults,
      children,
      discountPct,
      gstPct,
      validUntil: validUntil || undefined,
      notes: notes || undefined,
      internalNotes: internalNotes || undefined,
      branchId: quotation?.branch_id ?? branchId,
      items,
    };

    try {
      if (isEdit) {
        await updateMutation.mutateAsync(payload);
        toast(tr("Quotation updated"), 'success');
        router.push(`/quotations/${quotation.id}`);
      } else {
        const created = await createMutation.mutateAsync(payload);
        toast(tr("Quotation created"), 'success');
        router.push(`/quotations/${created.id}`);
      }
    } catch (err: any) {
      toast(err.message || tr("Failed to save quotation"), 'error');
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-4xl space-y-6">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">{tr("Customer & Travel")}</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="lead">{tr("Lead")}</Label>
            <select id="lead" className={selectClass} value={leadId} onChange={(e) => onSelectLead(e.target.value)}>
              <option value="">{tr("— None —")}</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>{l.customer_name} ({l.lead_number})</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="customer">{tr("Customer")}</Label>
            <select id="customer" className={selectClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">{tr("— None —")}</option>
              {customers.map((c: any) => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="destination">{tr("Destination")}</Label>
          <Input id="destination" value={destination} onChange={(e) => setDestination(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="travelFrom">{tr("Travel From")}</Label>
            <Input id="travelFrom" type="date" value={travelFrom} onChange={(e) => setTravelFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="travelTo">{tr("Travel To")}</Label>
            <Input id="travelTo" type="date" value={travelTo} onChange={(e) => setTravelTo(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label htmlFor="adults">{tr("Adults")}</Label>
            <Input id="adults" type="number" min={0} value={adults} onChange={(e) => setAdults(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="children">{tr("Children")}</Label>
            <Input id="children" type="number" min={0} value={children} onChange={(e) => setChildren(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="validUntil">{tr("Valid Until")}</Label>
            <Input id="validUntil" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">{tr("Line Items")}</h2>
          <Button type="button" variant="outline" size="sm" onClick={addLineItem}>{tr("+ Add Item")}</Button>
        </div>

        <div className="space-y-2">
          {lineItems.map((item) => (
            <div key={item.id} className="grid grid-cols-12 items-end gap-2 rounded-md border border-border p-3">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">{tr("Category")}</Label>
                <select
                  className={smallSelectClass}
                  value={item.category}
                  onChange={(e) => updateLineItem(item.id, { category: e.target.value })}
                >
                  {QUOTATION_ITEM_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{tr(c)}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-4 space-y-1">
                <Label className="text-xs">{tr("Description")}</Label>
                <Input
                  className="h-8 text-sm"
                  value={item.description}
                  onChange={(e) => updateLineItem(item.id, { description: e.target.value })}
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">{tr("Unit Cost (₹)")}</Label>
                <Input
                  className="h-8 text-sm"
                  type="number"
                  min={0}
                  value={item.unitCost}
                  onChange={(e) => updateLineItem(item.id, { unitCost: Number(e.target.value) })}
                />
              </div>
              <div className="col-span-1 space-y-1">
                <Label className="text-xs">{tr("Qty")}</Label>
                <Input
                  className="h-8 text-sm"
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={(e) => updateLineItem(item.id, { quantity: Number(e.target.value) })}
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">{tr("Markup %")}</Label>
                <Input
                  className="h-8 text-sm"
                  type="number"
                  min={0}
                  value={item.markupPct}
                  onChange={(e) => updateLineItem(item.id, { markupPct: Number(e.target.value) })}
                />
              </div>
              <div className="col-span-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => removeLineItem(item.id)}>{tr("Remove")}</Button>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="discountPct">{tr("Discount %")}</Label>
            <Input id="discountPct" type="number" min={0} value={discountPct} onChange={(e) => setDiscountPct(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gstPct">{tr("GST %")}</Label>
            <Input id="gstPct" type="number" min={0} value={gstPct} onChange={(e) => setGstPct(Number(e.target.value))} />
          </div>
        </div>
      </section>

      <section className="space-y-2 rounded-md border border-border bg-muted/30 p-4">
        <h2 className="text-sm font-semibold text-muted-foreground">{tr("Price Breakdown (preview)")}</h2>
        <div className="flex justify-between text-sm"><span className="text-muted-foreground">{tr("Subtotal")}</span><span>{formatCurrency(pricing.subtotal)}</span></div>
        <div className="flex justify-between text-sm"><span className="text-muted-foreground">{tr("Discount")}</span><span>-{formatCurrency(pricing.discount)}</span></div>
        <div className="flex justify-between text-sm"><span className="text-muted-foreground">{tr("GST")}</span><span>+{formatCurrency(pricing.gst)}</span></div>
        <div className="flex justify-between text-base font-semibold"><span>{tr("Total")}</span><span>{formatCurrency(pricing.total)}</span></div>
        <div className="flex justify-between text-sm"><span className="text-muted-foreground">{tr("Cost")}</span><span>{formatCurrency(pricing.costTotal)}</span></div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{tr("Profit Margin")}</span>
          <span className={marginColorClass(pricing.margin)}>{pricing.margin.toFixed(1)}%</span>
        </div>
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="notes">{tr("Customer Notes")}</Label>
          <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="internalNotes">{tr("Internal Notes")}</Label>
          <Textarea id="internalNotes" rows={3} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} />
        </div>
      </section>

      <div className="flex gap-3">
        <Button type="submit" variant="gold" disabled={saving}>
          {saving ? tr("Saving…") : isEdit ? tr("Save Changes") : tr("Create Quotation")}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>{tr("Cancel")}</Button>
      </div>
    </form>
  );
}
