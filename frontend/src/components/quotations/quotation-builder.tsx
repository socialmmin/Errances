'use client';
import { waNumber } from '@/lib/utils';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useCreateQuotation, useUpdateQuotation } from '@/hooks/use-quotations';
import { useItemSuggestions, useCreateItemSuggestion, useUpdateItemSuggestion, useDeleteItemSuggestion } from '@/hooks/use-item-suggestions';
import { useLeads } from '@/hooks/use-leads';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useCustomers } from '@/hooks/use-customers';
import { Quotation, QuotationItemInput, QUOTATION_ITEM_CATEGORIES, LEAD_SOURCES } from '@/types/quotation';
import { useAuthStore } from '@/store/auth-store';
import { SendWhatsAppDialog, quotationMessage } from '@/components/quotations/send-whatsapp-dialog';
import { TripVendors } from '@/components/vendors/trip-vendors';

const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground';
const smallSelectClass = 'h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground';

// The API sends dates as full timestamps; a date box only accepts yyyy-mm-dd.
function toDateInput(v?: string | null): string {
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const tenDigits = (v: string) => { const d = v.replace(/\D/g, ''); return d.length > 10 && d.startsWith('91') ? d.slice(-10) : d; };
const bad = 'border-red-500 ring-2 ring-red-200 focus-visible:ring-red-300';
function FieldError({ msg }: { msg?: string }) {
  return msg ? <p role="alert" className="text-xs font-semibold text-red-600">{msg}</p> : null;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
}

interface LineItemForm {
  id: string;
  category: string;
  customCategory: string;
  description: string;
  unitCost: number;
  quantity: number;
  markupPct: number;
}

function newLineItem(): LineItemForm {
  return { id: crypto.randomUUID(), category: 'hotel', customCategory: '', description: '', unitCost: 0, quantity: 1, markupPct: 15 };
}

// Type a lead's name, phone, destination or campaign and pick from the matches -- searches the
// actual database (debounced, server-side -- see useLeads' `search` param) rather than
// filtering whatever small default page happened to load client-side, which is what silently
// made leads outside that page unfindable here even though the main Leads page found them fine.
// Picking one auto-fills destination, travel dates and traveller counts (see onSelectLead).
function LeadPicker({ selectedLead, onSelect }: { selectedLead: { id: string; customer_name: string; phone?: string | null; lead_number?: string | null } | null; onSelect: (lead: any | null) => void }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  const enabled = open && !!debounced;
  const { data, isFetching, isLoading } = useLeads({ search: debounced || undefined, pageSize: 30, enabled });
  const results = data?.data ?? [];
  // Only trust "No matching lead" once a fetch for the CURRENT debounced text has actually
  // completed -- otherwise there's a brief window right after typing/pasting (or right after
  // reopening on an already-picked lead, before the 300ms debounce even fires) where isFetching
  // is still false and data is stale from the previous search, which was rendering a false
  // "No matching lead" the instant the box opened.
  const searching = enabled && (isFetching || isLoading || data === undefined);
  return (
    <div className="space-y-1">
      <Label htmlFor="lead">Lead</Label>
      <div className="relative">
        <Input
          id="lead"
          value={open ? query : (selectedLead ? `${selectedLead.customer_name} · ${selectedLead.phone ?? selectedLead.lead_number ?? ''}` : '')}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onPaste={(e) => { const pasted = e.clipboardData.getData('text'); if (pasted) { setQuery(pasted); setOpen(true); } }}
          onFocus={() => { setQuery(''); setDebounced(''); setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search by name, phone, destination or campaign…"
        />
        {selectedLead && !open && <button type="button" onClick={() => { onSelect(null); setQuery(''); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-red-600" aria-label="Clear lead">✕</button>}
        {open && (
          <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-input bg-background shadow-lg">
            {searching ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
            ) : results.length ? results.map((l: any) => (
              <button key={l.id} type="button" onMouseDown={() => { onSelect(l); setQuery(''); setOpen(false); }} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gold/10">
                <span className="truncate font-medium">{l.customer_name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{l.phone || l.lead_number}{l.destination ? ` · ${l.destination}` : ''}</span>
              </button>
            )) : <div className="px-3 py-2 text-xs text-muted-foreground">{debounced ? 'No matching lead' : 'Type a name, phone, destination or campaign to search'}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// A per-category remembered-items dropdown for the cost tables -- type to filter, pick one, or
// add a brand-new one (saved server-side so it shows up as a suggestion in every future
// quotation, not just this one). Each saved entry has a ⋮ menu to rename or remove it, so the
// list stays useful instead of accumulating one-off typos forever.
function ItemCombobox({ category, value, onChange, placeholder }: { category: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [menuForId, setMenuForId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const { data } = useItemSuggestions(category);
  const suggestions = data?.data ?? [];
  const createSuggestion = useCreateItemSuggestion();
  const updateSuggestion = useUpdateItemSuggestion();
  const deleteSuggestion = useDeleteItemSuggestion();

  const query = value.trim().toLowerCase();
  const filtered = query ? suggestions.filter((s) => s.label.toLowerCase().includes(query)) : suggestions;
  const exactMatch = suggestions.some((s) => s.label.toLowerCase() === query);

  async function addNew() {
    const label = value.trim();
    if (!label) return;
    await createSuggestion.mutateAsync({ category, label });
    setOpen(false);
  }

  return (
    <div className="relative col-span-5">
      <Input
        className="h-8 text-sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-56 w-64 overflow-y-auto rounded-md border border-input bg-background shadow-lg">
          {filtered.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-1 px-1 hover:bg-gold/10">
              {editingId === s.id ? (
                <>
                  <Input
                    autoFocus
                    className="my-1 h-7 flex-1 text-xs"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onMouseDown={(e) => e.stopPropagation()}
                  />
                  <button
                    type="button"
                    onMouseDown={async (e) => { e.preventDefault(); if (editLabel.trim()) await updateSuggestion.mutateAsync({ id: s.id, label: editLabel.trim() }); setEditingId(null); }}
                    className="shrink-0 px-2 text-xs font-semibold text-emerald-600"
                  >
                    Save
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onMouseDown={() => { onChange(s.label); setOpen(false); }} className="flex-1 truncate py-2 text-left text-sm">
                    {s.label}
                  </button>
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); setMenuForId((v) => (v === s.id ? null : s.id)); }}
                      className="px-2 py-1 text-muted-foreground hover:text-foreground"
                      aria-label="Options"
                    >
                      ⋮
                    </button>
                    {menuForId === s.id && (
                      <div className="absolute right-0 z-30 mt-1 w-28 overflow-hidden rounded-md border border-input bg-background shadow-lg">
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); setEditingId(s.id); setEditLabel(s.label); setMenuForId(null); }}
                          className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted/50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onMouseDown={async (e) => { e.preventDefault(); await deleteSuggestion.mutateAsync(s.id); setMenuForId(null); }}
                          className="block w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
          {!filtered.length && <div className="px-3 py-2 text-xs text-muted-foreground">No saved items yet</div>}
          {value.trim() && !exactMatch && (
            <button type="button" onMouseDown={addNew} className="block w-full border-t border-border px-3 py-2 text-left text-xs font-semibold text-gold hover:bg-gold/10">
              + Add "{value.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function QuotationBuilder({ quotation }: { quotation?: Quotation }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const branchId = useAuthStore((s) => s.user?.branchId) ?? '';
  const isEdit = !!quotation;

  const { data: customersData } = useCustomers();
  const customers = customersData?.data ?? [];

  const [leadId, setLeadId] = useState(quotation?.lead_id ?? '');
  const [selectedLead, setSelectedLead] = useState<{ id: string; customer_name: string; phone?: string | null; lead_number?: string | null } | null>(
    quotation?.lead_id ? { id: quotation.lead_id, customer_name: quotation.lead_customer_name ?? '', phone: quotation.lead_phone } : null,
  );
  // Arrived here with ?lead_id=... (e.g. from a callback outcome or a lead's own page) -- fetch
  // just that one lead (not the whole list) and pre-select it as soon as it loads.
  const urlLeadId = !isEdit ? searchParams.get('lead_id') : null;
  const { data: urlLeadData } = useLeads({ ids: urlLeadId ? [urlLeadId] : [], enabled: !!urlLeadId });
  // A customer who isn't a lead yet -- typed in directly instead of picked. The server looks
  // them up by phone before creating anything (see resolveOrCreateLead), so filling this in for
  // someone who's actually already a lead just links to that existing record, never duplicates it.
  const [newCustomerName, setNewCustomerName] = useState(quotation?.lead_customer_name ?? quotation?.customer_name ?? '');
  const [newCustomerPhone, setNewCustomerPhone] = useState(tenDigits(quotation?.lead_phone ?? quotation?.customer_phone ?? ''));
  const [newCustomerEmail, setNewCustomerEmail] = useState(quotation?.lead_email ?? quotation?.customer_email ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Which of this customer's requirements the quotation is for. A customer with quotations
  // already is asked: another quotation for an existing requirement, or a new requirement?
  const [requirementNo, setRequirementNo] = useState<number>(Number(quotation?.requirement_no ?? 1));
  const [askRequirement, setAskRequirement] = useState(false);
  const [askedFor, setAskedFor] = useState('');
  const clearError = (key: string) => setErrors((e) => { if (!e[key]) return e; const next = { ...e }; delete next[key]; return next; });
  const [newCustomerSource, setNewCustomerSource] = useState('meta_ads');
  const [customerId, setCustomerId] = useState(quotation?.customer_id ?? '');
  const [destination, setDestination] = useState(quotation?.destination ?? '');
  const [travelFrom, setTravelFrom] = useState(toDateInput(quotation?.travel_from));
  const [travelTo, setTravelTo] = useState(toDateInput(quotation?.travel_to));
  const [adults, setAdults] = useState(Number(quotation?.adults ?? 2));
  const [children, setChildren] = useState(Number(quotation?.children ?? 0));
  const [infants, setInfants] = useState(Number(quotation?.infants ?? 0));
  const [validUntil, setValidUntil] = useState(toDateInput(quotation?.valid_until));
  const [notes, setNotes] = useState(quotation?.notes ?? '');
  const [internalNotes, setInternalNotes] = useState(quotation?.internal_notes ?? '');
  const [notesOpen, setNotesOpen] = useState(!!quotation?.notes);
  const [internalNotesOpen, setInternalNotesOpen] = useState(!!quotation?.internal_notes);
  // New quotations autosave as a draft while typing (debounced) instead of only saving on
  // submit -- draftId holds the id once the first autosave lands, so later autosaves (and
  // the eventual explicit submit) update that same row instead of creating duplicates. The
  // server enforces "one draft per lead" itself (see quotations.repository.ts create()), so
  // starting a fresh quotation for a lead who already has a draft just replaces it.
  const [draftId, setDraftId] = useState('');
  const [savedToken, setSavedToken] = useState(quotation?.public_share_token ?? '');
  const effectiveId = quotation?.id || draftId;
  const [autoSaving, setAutoSaving] = useState(false);

  const qBase = Number(quotation?.base_amount ?? 0), qDiscount = Number(quotation?.discount_amount ?? 0), qGst = Number(quotation?.gst_amount ?? 0);
  const initialDiscountPct = quotation && qBase > 0 ? Math.round((qDiscount / qBase) * 10000) / 100 : 0;
  const initialGstPct = quotation && qBase - qDiscount > 0 ? Math.round((qGst / (qBase - qDiscount)) * 10000) / 100 : 5;
  const [discountPct, setDiscountPct] = useState(initialDiscountPct);
  const [gstPct, setGstPct] = useState(initialGstPct);

  // Approved / invoiced / paid: what was agreed is frozen. Those lines, the discount and the GST
  // can't be changed; new services can still be added underneath.
  const locked = !!quotation && (['accepted', 'converted'].includes(quotation.status) || !!quotation.invoice_id);
  const agreedIds = new Set(locked ? (quotation?.items ?? []).map((i) => i.id) : []);
  const [lineItems, setLineItems] = useState<LineItemForm[]>(
    quotation?.items?.length
      ? quotation.items.map((item) => {
          const raw = item.category ?? item.item_type ?? 'other';
          // A quotation saved earlier may have a free-typed category (e.g. "Souvenir shopping")
          // stored directly in this column -- anything not one of the fixed options is really
          // an "other" pick with that custom text, so the dropdown + text field round-trip it correctly.
          const known = (QUOTATION_ITEM_CATEGORIES as readonly string[]).includes(raw);
          return {
            id: item.id,
            category: known ? raw : 'other',
            customCategory: known ? '' : raw,
            description: item.description ?? '',
            unitCost: Number(item.unit_cost ?? 0) || 0,
            quantity: Number(item.quantity ?? 1) || 1,
            markupPct: Number(item.markup_pct ?? 0) || 0,
          };
        })
      : [newLineItem()],
  );

  // Package cost & per-person pricing calculator -- each cost type (Hotel, Transport, Flight/Train,
  // Activities, Other) gets its own small table of rows (item, qty, unit price -- total auto-fills),
  // instead of one lumped-together box. New rows default their quantity to adults+children (the
  // usual "per traveller" cost pattern) but it's editable per row. The grand total across every
  // table then splits across travellers by weight (adult = 1 unit, kid = 0.5 unit, infant = free),
  // and a flat margin per person is added on top. "Apply to Line Items" turns every row into a real
  // line item (plus one Margin line) so the existing discount/GST math downstream works unchanged.
  interface CostRow { id: string; label: string; qty: number; unitPrice: number }
  const COST_TABLES: { key: string; title: string; category: string; placeholder: string }[] = [
    { key: 'hotel', title: 'Hotel', category: 'hotel', placeholder: 'e.g. Deluxe room (2N)' },
    { key: 'transport', title: 'Transport', category: 'transport', placeholder: 'e.g. AC cab, Chennai–Ooty' },
    { key: 'flight', title: 'Flight / Train', category: 'flight', placeholder: 'e.g. Chennai–Kochi flight' },
    { key: 'activity', title: 'Activities', category: 'activity', placeholder: 'e.g. Campfire, DJ night' },
    { key: 'other', title: 'Other', category: 'other', placeholder: 'e.g. Guide fee' },
  ];
  const [costRows, setCostRows] = useState<Record<string, CostRow[]>>({ hotel: [], transport: [], flight: [], activity: [], other: [] });
  const [marginPerPerson, setMarginPerPerson] = useState(0);

  function addCostRow(key: string) {
    setCostRows((rows) => ({ ...rows, [key]: [...rows[key], { id: crypto.randomUUID(), label: '', qty: adults + children || 1, unitPrice: 0 }] }));
  }
  function updateCostRow(key: string, id: string, patch: Partial<CostRow>) {
    setCostRows((rows) => ({ ...rows, [key]: rows[key].map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  }
  function removeCostRow(key: string, id: string) {
    setCostRows((rows) => ({ ...rows, [key]: rows[key].filter((r) => r.id !== id) }));
  }

  const costCalc = useMemo(() => {
    const tableTotals = COST_TABLES.map((t) => ({
      ...t,
      rows: costRows[t.key],
      total: costRows[t.key].reduce((s, r) => s + r.qty * r.unitPrice, 0),
    }));
    const totalCost = tableTotals.reduce((s, t) => s + t.total, 0);
    // Infants ride free in this split -- only adults and children carry a share of the cost.
    const units = adults + children * 0.5;
    const perUnitCost = units > 0 ? totalCost / units : 0;
    const perAdultCost = perUnitCost;
    const perKidCost = perUnitCost * 0.5;
    const perAdultPrice = perAdultCost + marginPerPerson;
    const perKidPrice = perKidCost + marginPerPerson;
    const totalMargin = marginPerPerson * (adults + children);
    const totalSellPrice = adults * perAdultPrice + children * perKidPrice;
    return { tableTotals, totalCost, units, perAdultCost, perKidCost, perAdultPrice, perKidPrice, totalMargin, totalSellPrice };
  }, [costRows, marginPerPerson, adults, children]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyCostCalcToLineItems() {
    const items: LineItemForm[] = [];
    for (const t of costCalc.tableTotals) {
      for (const r of t.rows) {
        if (r.unitPrice > 0 && r.qty > 0) {
          items.push({ id: crypto.randomUUID(), category: t.category, customCategory: t.category === 'other' ? (r.label || 'Other') : '', description: r.label || t.title, unitCost: r.unitPrice, quantity: r.qty, markupPct: 0 });
        }
      }
    }
    if (costCalc.totalMargin > 0) items.push({ id: crypto.randomUUID(), category: 'other', customCategory: 'Margin', description: `Margin -- ₹${marginPerPerson}/person × ${adults + children} travellers`, unitCost: costCalc.totalMargin, quantity: 1, markupPct: 0 });
    if (!items.length) { toast('Enter at least one cost first', 'error'); return; }
    setLineItems(items);
    toast('Applied to Line Items below -- adjust further if needed', 'success');
  }

  // Package mode -- for a fixed-price package instead of itemised costs: tick what's included,
  // then either type one all-in price, or (optional) the real expense + margin so they add up to
  // the same price. Produces a single 'package' line item whose description lists the inclusions.
  const [packageMode, setPackageMode] = useState(false);
  const [pkgIncHotel, setPkgIncHotel] = useState(true);
  const [pkgIncTransport, setPkgIncTransport] = useState(true);
  const [pkgIncBreakfast, setPkgIncBreakfast] = useState(true);
  const [pkgIncDinner, setPkgIncDinner] = useState(false);
  const [pkgIncFlightTrain, setPkgIncFlightTrain] = useState(false);
  const [pkgIncActivities, setPkgIncActivities] = useState('');
  const [pkgIncOther, setPkgIncOther] = useState('');
  const [pkgPriceMode, setPkgPriceMode] = useState<'single' | 'breakdown'>('single');
  const [pkgPrice, setPkgPrice] = useState(0);
  const [pkgExpense, setPkgExpense] = useState(0);
  const [pkgMargin, setPkgMargin] = useState(0);

  const pkgInclusionsText = useMemo(() => {
    const parts: string[] = [];
    if (pkgIncHotel) parts.push('Hotel');
    if (pkgIncTransport) parts.push('Transport');
    if (pkgIncBreakfast) parts.push('Breakfast');
    if (pkgIncDinner) parts.push('Dinner');
    if (pkgIncFlightTrain) parts.push('Flight/Train');
    if (pkgIncActivities.trim()) parts.push(pkgIncActivities.trim());
    if (pkgIncOther.trim()) parts.push(pkgIncOther.trim());
    return parts.join(', ');
  }, [pkgIncHotel, pkgIncTransport, pkgIncBreakfast, pkgIncDinner, pkgIncFlightTrain, pkgIncActivities, pkgIncOther]);

  const pkgTotalPrice = pkgPriceMode === 'single' ? pkgPrice : pkgExpense + pkgMargin;

  function applyPackageToLineItems() {
    if (pkgTotalPrice <= 0) { toast('Enter a package price first', 'error'); return; }
    const unitCost = pkgPriceMode === 'breakdown' ? pkgExpense : pkgTotalPrice;
    const markupPct = pkgPriceMode === 'breakdown' && pkgExpense > 0 ? (pkgMargin / pkgExpense) * 100 : 0;
    setLineItems([{
      id: crypto.randomUUID(),
      category: 'package',
      customCategory: '',
      description: pkgInclusionsText ? `Package -- includes ${pkgInclusionsText}` : 'Package',
      unitCost,
      quantity: 1,
      markupPct,
    }]);
    toast('Applied to Line Items below -- adjust further if needed', 'success');
  }

  const { data: reqData } = useQuery({ queryKey: ['quotations', 'requirements', leadId], queryFn: () => api.get<{ data: { requirement_no: number; quotations: number; destination: string | null; approved: boolean; closed: boolean; used: number }[]; next: number; openRequirement: number | null }>(`/quotations/requirements?leadId=${leadId}`), enabled: !!leadId });
  // R1 stays the customer's requirement until one of its quotations is paid in full; only then
  // does a new trip become R2. So a new requirement is offered only when none is still open.
  const openRequirement = reqData?.openRequirement ?? null;
  const canStartNew = openRequirement === null;
  const quotationNo = isEdit ? Number(quotation?.option_no ?? 1) : ((reqData?.data ?? []).find((r) => r.requirement_no === requirementNo)?.used ?? 0) + 1;
  const requirements = reqData?.data ?? [];
  const nextRequirement = reqData?.next ?? 1;
  // ask once per chosen customer, only when starting a new quotation
  useEffect(() => {
    if (isEdit || !leadId || !reqData || askedFor === leadId) return;
    setAskedFor(leadId);
    if (!reqData.data.length) { setRequirementNo(1); return; }
    // every earlier requirement is paid and closed: this is simply the next one
    if (reqData.openRequirement === null) { setRequirementNo(reqData.next); setAskRequirement(true); return; }
    setRequirementNo(reqData.openRequirement); setAskRequirement(true);
  }, [isEdit, leadId, reqData, askedFor]);

  const createMutation = useCreateQuotation();
  const updateMutation = useUpdateQuotation(effectiveId);
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

  // "Our margin" in rupees: typing it spreads the same mark-up over every line that is not
  // locked, so the total becomes cost + margin (then discount and GST as usual).
  function setMarginAmount(amount: number) {
    setLineItems((items) => {
      const free = items.filter((i) => !agreedIds.has(i.id));
      const freeCost = free.reduce((n, i) => n + i.unitCost * i.quantity, 0);
      const lockedMargin = items.filter((i) => agreedIds.has(i.id)).reduce((n, i) => n + i.unitCost * i.quantity * (i.markupPct / 100), 0);
      if (freeCost <= 0) return items;
      const pct = Math.max(0, ((amount - lockedMargin) / freeCost) * 100);
      return items.map((i) => (agreedIds.has(i.id) ? i : { ...i, markupPct: Math.round(pct * 10000) / 10000 }));
    });
  }

  function addLineItem() {
    setLineItems((items) => [...items, newLineItem()]);
  }
  function updateLineItem(id: string, patch: Partial<LineItemForm>) {
    setLineItems((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }
  function removeLineItem(id: string) {
    setLineItems((items) => items.filter((item) => item.id !== id));
  }

  function onSelectLead(lead: any | null) {
    if (!lead && !isEdit) { setRequirementNo(1); setAskedFor(''); }
    setLeadId(lead?.id ?? '');
    setSelectedLead(lead);
    if (lead) {
      setNewCustomerName(lead.customer_name ?? ''); setNewCustomerPhone(tenDigits(lead.phone ?? '')); setNewCustomerEmail(lead.email ?? '');
      setErrors({});
      setDestination(lead.destination ?? '');
      setTravelFrom(toDateInput(lead.travel_from));
      setTravelTo(toDateInput(lead.travel_to));
      setAdults(lead.adults ?? 2);
      setChildren(lead.children ?? 0);
      setInfants(lead.infants ?? 0);
    }
  }

  // Arrived here with ?lead_id=... (e.g. from a callback outcome or a lead's own page) --
  // pre-select that lead as soon as it loads, instead of making the person pick it again.
  useEffect(() => {
    if (isEdit || !urlLeadId || leadId) return;
    const lead = urlLeadData?.data?.[0];
    if (lead) onSelectLead(lead);
  }, [urlLeadData, isEdit, urlLeadId, leadId]); // eslint-disable-line react-hooks/exhaustive-deps

  function buildPayload() {
    const items: QuotationItemInput[] = lineItems
      .filter((item) => item.description.trim().length > 0 || item.unitCost > 0)
      .map((item) => ({
        category: item.category === 'other' && item.customCategory.trim() ? item.customCategory.trim() : item.category,
        description: item.description || undefined,
        quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
        unitCost: Number(item.unitCost) || 0,
        markupPct: Number(item.markupPct) || 0,
      }));
    return {
      leadId: leadId || null,
      requirementNo,
      customerId: customerId || null,
      newCustomerName: !leadId ? newCustomerName.trim() || undefined : undefined,
      newCustomerPhone: !leadId ? newCustomerPhone.trim() || undefined : undefined,
      newCustomerEmail: newCustomerEmail.trim() || undefined,
      newCustomerSource: !leadId ? newCustomerSource : undefined,
      destination: destination || undefined,
      travelFrom: travelFrom || undefined,
      travelTo: travelTo || undefined,
      adults: Math.round(Number(adults) || 0),
      children: Math.round(Number(children) || 0),
      infants: Math.round(Number(infants) || 0),
      discountPct: Number(discountPct) || 0,
      gstPct: Number(gstPct) || 0,
      validUntil: validUntil || undefined,
      notes: notes || undefined,
      internalNotes: internalNotes || undefined,
      branchId: quotation?.branch_id ?? branchId,
      items,
    };
  }

  // Minimum fields for a quotation to be worth saving at all -- same gate the explicit submit
  // uses, so autosave never creates a near-empty draft just because someone typed a destination.
  function hasMinimumFields() {
    const hasCustomer = !!leadId || (newCustomerName.trim().length > 0 && !!waNumber(newCustomerPhone));
    return hasCustomer && destination.trim().length > 0 && !!travelFrom && !!travelTo && adults > 0;
  }

  // Autosave a draft while typing (debounced) -- only for a brand-new quotation (editing an
  // existing one already has its own explicit Save Changes). First fire creates the draft and
  // remembers its id; every fire after that updates the same row silently (no toast/redirect).
  useEffect(() => {
    if (isEdit) return;
    if (!hasMinimumFields()) return;
    const t = setTimeout(async () => {
      setAutoSaving(true);
      try {
        const payload = buildPayload();
        if (effectiveId) {
          await updateMutation.mutateAsync(payload);
        } else {
          const created = await createMutation.mutateAsync(payload);
          setDraftId(created.id);
        }
      } catch {
        // Silent -- autosave failures shouldn't interrupt typing; the explicit submit button
        // still reports errors normally.
      } finally {
        setAutoSaving(false);
      }
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, leadId, newCustomerName, newCustomerPhone, newCustomerEmail, newCustomerSource, destination, travelFrom, travelTo, adults, children, infants, discountPct, gstPct, validUntil, notes, internalNotes, lineItems]);

  // Shared by both "Save" and "Save & Send via WhatsApp" -- validates, saves (create or
  // update the same draft), and returns the id to send/navigate against. Returns null on
  // validation failure so callers can bail out without duplicating the checks/toasts.
  async function saveQuotation(): Promise<{ id: string; token: string } | null> {
    // Every compulsory field is checked together: each missing one turns red with its own note,
    // and the page moves to the first of them.
    const found: Record<string, string> = {};
    if (!newCustomerName.trim()) found.newCustomerName = 'Customer name is compulsory';
    if (leadId ? !newCustomerPhone.trim() : !waNumber(newCustomerPhone)) found.newCustomerPhone = newCustomerPhone.trim() ? 'Enter a valid mobile number, e.g. 06 12 34 56 78 or +33 6 12 34 56 78' : 'Mobile number is compulsory';
    if (newCustomerEmail.trim() && !/^\S+@\S+\.\S+$/.test(newCustomerEmail.trim())) found.newCustomerEmail = 'This email address does not look right';
    if (!destination.trim()) found.destination = 'Destination is compulsory';
    if (!travelFrom) found.travelFrom = 'Check-in date is compulsory';
    if (!travelTo) found.travelTo = 'Check-out date is compulsory';
    else if (travelFrom && travelTo < travelFrom) found.travelTo = 'Check-out cannot be before check-in';
    if (!adults || adults < 1) found.adults = 'At least 1 adult is needed';
    setErrors(found);
    const first = ['newCustomerName', 'newCustomerPhone', 'newCustomerEmail', 'destination', 'travelFrom', 'travelTo', 'adults'].find((k) => found[k]);
    if (first) {
      const el = document.getElementById(first);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => el?.focus({ preventScroll: true }), 350);
      const n = Object.keys(found).length;
      toast(n === 1 ? found[first] : `${n} compulsory fields need attention — they are marked in red`, 'error');
      return null;
    }

    const payload = buildPayload();
    if (effectiveId) {
      const updated = await updateMutation.mutateAsync(payload);
      const token = updated?.public_share_token || savedToken;
      if (token) setSavedToken(token);
      return { id: effectiveId, token };
    }
    const created = await createMutation.mutateAsync(payload);
    setDraftId(created.id);
    if (created.public_share_token) setSavedToken(created.public_share_token);
    return { id: created.id, token: created.public_share_token || '' };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const result = await saveQuotation();
      if (!result) return;
      toast(isEdit ? 'Quotation updated' : 'Quotation saved', 'success');
      router.push('/quotations');
    } catch (err: any) {
      toast(err.message || 'Failed to save quotation', 'error');
    }
  }

  // "Send via WhatsApp" saves first (so there's a real id/link to share), then opens a review
  // modal with the message pre-filled -- editable before it actually goes out, rather than
  // firing silently. Matches the reference flow: save, review/edit the text, then send.
  const [sendingAfterSave, setSendingAfterSave] = useState(false);
  const [waModalOpen, setWaModalOpen] = useState(false);
  const [waText, setWaText] = useState('');
  const [waPhone, setWaPhone] = useState('');
  const [waId, setWaId] = useState('');

  async function onOpenSendModal(e: React.FormEvent) {
    e.preventDefault();
    setSendingAfterSave(true);
    try {
      const result = await saveQuotation();
      if (!result) return;
      const phone = (selectedLead?.phone || newCustomerPhone || '').replace(/\D/g, '');
      if (!phone) { toast('No phone number on this quotation', 'error'); return; }
      setWaId(result.id);
      setWaPhone(phone);
      setWaText(quotationMessage({ customerName: selectedLead?.customer_name || newCustomerName, quotationNumber: quotation?.quotation_number, destination, travelFrom, travelTo, adults, children, infants, total: pricing.total, token: result.token }));
      setWaModalOpen(true);
    } catch (err: any) {
      toast(err.message || 'Failed to save quotation', 'error');
    } finally {
      setSendingAfterSave(false);
    }
  }


  // Download and Copy Link both need a real saved quotation first -- save silently if this is
  // still a brand-new one, then act on the id/token that comes back.
  const [downloading, setDownloading] = useState(false);
  async function onDownload(e: React.FormEvent) {
    e.preventDefault();
    setDownloading(true);
    try {
      const result = await saveQuotation();
      if (!result) return;
      window.open(`${process.env.NEXT_PUBLIC_APP_URL || 'https://errances.socialmm.in'}/q/${result.token}?print=1`, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      toast(err.message || 'Failed to save quotation', 'error');
    } finally {
      setDownloading(false);
    }
  }

  const [copyingLink, setCopyingLink] = useState(false);
  async function onCopyLink(e: React.FormEvent) {
    e.preventDefault();
    setCopyingLink(true);
    try {
      const result = await saveQuotation();
      if (!result) return;
      const link = `${process.env.NEXT_PUBLIC_APP_URL || 'https://errances.socialmm.in'}/q/${result.token}`;
      await navigator.clipboard.writeText(link);
      toast('Link copied to clipboard', 'success');
    } catch (err: any) {
      toast(err.message || 'Failed to save quotation', 'error');
    } finally {
      setCopyingLink(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-4xl space-y-6">
      {locked && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-bold">This quotation is approved{quotation?.invoice_number ? ` — invoice ${quotation.invoice_number}` : ''}{Number(quotation?.paid_amount) > 0 ? ` · ₹${Math.round(Number(quotation?.paid_amount)).toLocaleString('en-IN')} paid` : ''}</p>
          <p className="mt-0.5 text-xs">The agreed items, discount and GST are locked and can't be edited. If the customer wants something extra, use <b>+ Add Item</b> — it is added to the same quotation and invoice.</p>
        </div>
      )}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Customer &amp; Travel</h2>
        <LeadPicker selectedLead={selectedLead} onSelect={onSelectLead} />

        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-navy/20 bg-navy/5 p-3">
          <span className="rounded-full bg-navy px-3 py-1 text-sm font-extrabold text-white">R{requirementNo} · Q{quotationNo}</span>
          <span className="text-sm font-semibold text-navy">Requirement {requirementNo}, quotation {quotationNo}</span>
          {!isEdit && leadId && requirements.length > 0 && <button type="button" onClick={() => setAskRequirement(true)} className="text-xs font-semibold text-sky-700 hover:underline">Change</button>}
          <span className="text-xs text-muted-foreground">A requirement stays open until one of its quotations is paid in full; the other quotations for it then move to the Trash, and the customer's next trip becomes the next requirement.</span>
        </div>

        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs font-semibold text-foreground">{leadId ? 'Customer details — taken from the lead. To use a different customer, clear the lead above.' : "Customer details — not a lead yet? Type them here. We check the mobile number against existing leads first, so this never creates a duplicate."}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="newCustomerName">Customer name <span className="text-red-600">*</span></Label><Input id="newCustomerName" value={newCustomerName} readOnly={!!leadId} aria-invalid={!!errors.newCustomerName} className={errors.newCustomerName ? bad : leadId ? 'bg-muted' : ''} onChange={(e) => { setNewCustomerName(e.target.value); clearError('newCustomerName'); }} placeholder="Customer name" /><FieldError msg={errors.newCustomerName} /></div>
            <div className="space-y-1"><Label htmlFor="newCustomerPhone">Mobile number <span className="text-red-600">*</span></Label><Input id="newCustomerPhone" value={newCustomerPhone} readOnly={!!leadId} aria-invalid={!!errors.newCustomerPhone} className={errors.newCustomerPhone ? bad : leadId ? 'bg-muted' : ''} onChange={(e) => { setNewCustomerPhone(e.target.value.replace(/[^\d+ ]/g, '')); clearError('newCustomerPhone'); }} placeholder="e.g. 06 12 34 56 78 or +33 6 12 34 56 78" inputMode="tel" maxLength={20} /><FieldError msg={errors.newCustomerPhone} /></div>
            <div className="space-y-1"><Label htmlFor="newCustomerEmail">Email <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="newCustomerEmail" type="email" value={newCustomerEmail} aria-invalid={!!errors.newCustomerEmail} className={errors.newCustomerEmail ? bad : ''} onChange={(e) => { setNewCustomerEmail(e.target.value); clearError('newCustomerEmail'); }} placeholder="name@example.com" /><FieldError msg={errors.newCustomerEmail} /></div>
            {!leadId && (
              <div className="space-y-1">
                <Label htmlFor="newCustomerSource">Source</Label>
                <select id="newCustomerSource" className={selectClass} value={newCustomerSource} onChange={(e) => setNewCustomerSource(e.target.value)}>
                  {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="destination">Destination <span className="text-red-600">*</span></Label>
          <Input id="destination" value={destination} aria-invalid={!!errors.destination} className={errors.destination ? bad : ''} onChange={(e) => { setDestination(e.target.value); clearError('destination'); }} placeholder="e.g. Vietnam" />
          <FieldError msg={errors.destination} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="travelFrom">Check-in (Travel From) <span className="text-red-600">*</span></Label>
            <Input id="travelFrom" type="date" value={travelFrom} aria-invalid={!!errors.travelFrom} className={errors.travelFrom ? bad : ''} onChange={(e) => { setTravelFrom(e.target.value); clearError('travelFrom'); }} />
            <FieldError msg={errors.travelFrom} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="travelTo">Check-out (Travel To) <span className="text-red-600">*</span></Label>
            <Input id="travelTo" type="date" value={travelTo} min={travelFrom || undefined} aria-invalid={!!errors.travelTo} className={errors.travelTo ? bad : ''} onChange={(e) => { setTravelTo(e.target.value); clearError('travelTo'); }} />
            <FieldError msg={errors.travelTo} />
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <div className="space-y-1">
            <Label htmlFor="adults">Adults <span className="text-red-600">*</span></Label>
            <Input id="adults" type="number" min={1} value={adults} aria-invalid={!!errors.adults} className={errors.adults ? bad : ''} onChange={(e) => { setAdults(Number(e.target.value)); clearError('adults'); }} />
            <FieldError msg={errors.adults} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="children">Children</Label>
            <Input id="children" type="number" min={0} value={children} onChange={(e) => setChildren(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="infants">Infants</Label>
            <Input id="infants" type="number" min={0} value={infants} onChange={(e) => setInfants(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="validUntil">Valid Until</Label>
            <Input id="validUntil" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{packageMode ? 'Package Mode' : 'Package Cost & Per-Person Pricing'}</h2>
            <p className="text-xs text-muted-foreground">
              {packageMode
                ? 'Tick what\'s included and set one package price -- quote it as a single bundle instead of itemised costs.'
                : 'Enter the actual cost; the total splits across travellers (adult = 1 share, kid = half share, infants free), then your margin per person is added on top.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={packageMode}
            onClick={() => setPackageMode((v) => !v)}
            className="flex shrink-0 items-center gap-2 rounded-full border border-input bg-background px-3 py-1.5"
          >
            <span className="text-xs font-semibold text-foreground">Package mode</span>
            <span className={`relative h-5 w-9 rounded-full transition-colors ${packageMode ? 'bg-emerald-500' : 'bg-slate-300'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${packageMode ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </span>
          </button>
        </div>

        {packageMode ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-border bg-background p-3">
              {[
                { label: 'Hotel', checked: pkgIncHotel, set: setPkgIncHotel },
                { label: 'Transport', checked: pkgIncTransport, set: setPkgIncTransport },
                { label: 'Breakfast', checked: pkgIncBreakfast, set: setPkgIncBreakfast },
                { label: 'Dinner', checked: pkgIncDinner, set: setPkgIncDinner },
                { label: 'Flight / Train', checked: pkgIncFlightTrain, set: setPkgIncFlightTrain },
              ].map((c) => (
                <label key={c.label} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={c.checked} onChange={(e) => c.set(e.target.checked)} className="h-4 w-4 rounded border-input accent-navy" />
                  {c.label}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Activities (if any -- type and write)</Label><Input className="h-9" placeholder="e.g. Campfire, DJ night" value={pkgIncActivities} onChange={(e) => setPkgIncActivities(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Other inclusions (type and write)</Label><Input className="h-9" placeholder="e.g. Guide, sightseeing entry" value={pkgIncOther} onChange={(e) => setPkgIncOther(e.target.value)} /></div>
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={() => setPkgPriceMode('single')} className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${pkgPriceMode === 'single' ? 'border-navy bg-muted text-foreground' : 'border-input text-muted-foreground'}`}>Mention overall package price only</button>
              <button type="button" onClick={() => setPkgPriceMode('breakdown')} className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${pkgPriceMode === 'breakdown' ? 'border-navy bg-muted text-foreground' : 'border-input text-muted-foreground'}`}>Differentiate expense & margin</button>
            </div>

            {pkgPriceMode === 'single' ? (
              <div className="space-y-1 max-w-xs"><Label className="text-xs">Overall package price (₹)</Label><Input className="h-9" type="number" min={0} value={pkgPrice} onChange={(e) => setPkgPrice(Number(e.target.value))} /></div>
            ) : (
              <div className="grid grid-cols-2 gap-3 max-w-md">
                <div className="space-y-1"><Label className="text-xs">Total expense (₹)</Label><Input className="h-9" type="number" min={0} value={pkgExpense} onChange={(e) => setPkgExpense(Number(e.target.value))} /></div>
                <div className="space-y-1"><Label className="text-xs">Our margin (₹)</Label><Input className="h-9" type="number" min={0} value={pkgMargin} onChange={(e) => setPkgMargin(Number(e.target.value))} /></div>
              </div>
            )}

            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
              {pkgPriceMode === 'breakdown' && (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">Expense</span><span>{formatCurrency(pkgExpense)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Margin</span><span>{formatCurrency(pkgMargin)}</span></div>
                </>
              )}
              <div className="mt-1 flex justify-between border-t border-emerald-200 pt-1 text-base font-bold"><span>Total package price</span><span>{formatCurrency(pkgTotalPrice)}</span></div>
            </div>

            <Button type="button" variant="gold" size="sm" onClick={applyPackageToLineItems}>Apply to Line Items</Button>
          </div>
        ) : (
        <div className="space-y-4">
          <div className="space-y-4">
          {costCalc.tableTotals.map((t) => (
            <div key={t.key} className="overflow-hidden rounded-lg border border-border bg-background">
              <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5">
                <span className="text-xs font-semibold text-navy dark:text-white">{t.title}</span>
                <span className="text-xs font-semibold text-muted-foreground">{formatCurrency(t.total)}</span>
              </div>
              {t.rows.length > 0 && (
                <div className="grid grid-cols-12 gap-2 px-3 pt-2 text-[10px] font-semibold uppercase text-muted-foreground">
                  <span className="col-span-5">Item</span>
                  <span className="col-span-2">Qty</span>
                  <span className="col-span-2">Unit price (₹)</span>
                  <span className="col-span-2">Total</span>
                </div>
              )}
              <div className="space-y-1.5 p-3 pt-1">
                {t.rows.map((r) => (
                  <div key={r.id} className="grid grid-cols-12 items-center gap-2">
                    <ItemCombobox category={t.key} placeholder={t.placeholder} value={r.label} onChange={(v) => updateCostRow(t.key, r.id, { label: v })} />
                    <Input className="col-span-2 h-8 text-sm" type="number" min={0} value={r.qty} onChange={(e) => updateCostRow(t.key, r.id, { qty: Number(e.target.value) })} />
                    <Input className="col-span-2 h-8 text-sm" type="number" min={0} value={r.unitPrice} onChange={(e) => updateCostRow(t.key, r.id, { unitPrice: Number(e.target.value) })} />
                    <span className="col-span-2 text-sm font-medium">{formatCurrency(r.qty * r.unitPrice)}</span>
                    <button type="button" onClick={() => removeCostRow(t.key, r.id)} className="col-span-1 text-xs font-semibold text-red-500 hover:text-red-700">✕</button>
                  </div>
                ))}
                <button type="button" onClick={() => addCostRow(t.key)} className="text-xs font-semibold text-gold hover:underline">+ Add item</button>
              </div>
            </div>
          ))}

        <div className="rounded-lg border border-border bg-background p-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Total cost</span><span className="font-semibold">{formatCurrency(costCalc.totalCost)}</span></div>
          <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>Split across {adults} adult{adults !== 1 ? 's' : ''}{children ? ` + ${children} kid${children !== 1 ? 's' : ''} (half share)` : ''}{infants ? ` + ${infants} infant${infants !== 1 ? 's' : ''} (free)` : ''} = {costCalc.units} share{costCalc.units !== 1 ? 's' : ''}</span></div>
          <div className="mt-2 flex justify-between"><span className="text-muted-foreground">Cost per adult</span><span>{formatCurrency(costCalc.perAdultCost)}</span></div>
          {children > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Cost per kid</span><span>{formatCurrency(costCalc.perKidCost)}</span></div>}
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Margin per person (₹)</Label>
          <Input className="h-9 max-w-[12rem]" type="number" min={0} value={marginPerPerson} onChange={(e) => setMarginPerPerson(Number(e.target.value))} />
        </div>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
          <div className="flex justify-between"><span className="text-muted-foreground">Final price per adult</span><span className="font-semibold text-emerald-700">{formatCurrency(costCalc.perAdultPrice)}</span></div>
          {children > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Final price per kid</span><span className="font-semibold text-emerald-700">{formatCurrency(costCalc.perKidPrice)}</span></div>}
          <div className="mt-1 flex justify-between border-t border-emerald-200 pt-1 text-base font-bold"><span>Total selling price</span><span>{formatCurrency(costCalc.totalSellPrice)}</span></div>
        </div>

        <Button type="button" variant="gold" size="sm" onClick={applyCostCalcToLineItems}>Apply to Line Items</Button>
          </div>
        </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Line Items</h2>
          <Button type="button" variant="outline" size="sm" onClick={addLineItem}>+ Add Item</Button>
        </div>

        <div className="space-y-2">
          {lineItems.map((item) => (
            <fieldset key={item.id} disabled={agreedIds.has(item.id)} title={agreedIds.has(item.id) ? 'Agreed item — locked' : undefined} className={`grid grid-cols-12 items-end gap-2 rounded-md border p-3 ${agreedIds.has(item.id) ? 'border-emerald-200 bg-emerald-50/50 opacity-80' : 'border-border'}`}>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Category</Label>
                <select
                  className={smallSelectClass}
                  value={item.category}
                  onChange={(e) => updateLineItem(item.id, { category: e.target.value })}
                >
                  {QUOTATION_ITEM_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {item.category === 'other' && (
                  <Input
                    className="h-8 text-xs"
                    placeholder="Type the category…"
                    value={item.customCategory}
                    onChange={(e) => updateLineItem(item.id, { customCategory: e.target.value })}
                  />
                )}
              </div>
              <div className="col-span-4 space-y-1">
                <Label className="text-xs">Description{item.category === 'package' ? ' & Inclusions' : ''}</Label>
                <Input
                  className="h-8 text-sm"
                  placeholder={item.category === 'package' ? 'e.g. 3N/4D package -- includes transport, breakfast & dinner' : undefined}
                  value={item.description}
                  onChange={(e) => updateLineItem(item.id, { description: e.target.value })}
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Unit Cost (₹)</Label>
                <Input
                  className="h-8 text-sm"
                  type="number"
                  min={0}
                  value={item.unitCost}
                  onChange={(e) => updateLineItem(item.id, { unitCost: Number(e.target.value) })}
                />
              </div>
              <div className="col-span-1 space-y-1">
                <Label className="text-xs">Qty</Label>
                <Input
                  className="h-8 text-sm"
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={(e) => updateLineItem(item.id, { quantity: Number(e.target.value) })}
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Markup %</Label>
                <Input
                  className="h-8 text-sm"
                  type="number"
                  min={0}
                  value={item.markupPct}
                  onChange={(e) => updateLineItem(item.id, { markupPct: Number(e.target.value) })}
                />
              </div>
              <div className="col-span-1">
                {agreedIds.has(item.id) ? <span className="text-[10px] font-bold uppercase text-emerald-700">Agreed</span> : <Button type="button" variant="ghost" size="sm" onClick={() => removeLineItem(item.id)}>Remove</Button>}
              </div>
            </fieldset>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label htmlFor="marginAmount">Our margin (₹)</Label>
            <Input id="marginAmount" type="number" min={0} value={Math.round(pricing.subtotal - pricing.costTotal)} disabled={pricing.costTotal <= 0} onChange={(e) => setMarginAmount(Number(e.target.value) || 0)} />
            <p className="text-[11px] text-muted-foreground">{pricing.costTotal > 0 ? `Cost ${formatCurrency(pricing.costTotal)} + margin = ${formatCurrency(pricing.subtotal)}. Not shown to the customer.` : 'Enter the costs first.'}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="discountPct">Discount %</Label>
            <Input id="discountPct" type="number" min={0} value={discountPct} disabled={locked} onChange={(e) => setDiscountPct(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gstPct">GST %</Label>
            <Input id="gstPct" type="number" min={0} value={gstPct} disabled={locked} onChange={(e) => setGstPct(Number(e.target.value))} />
          </div>
        </div>

        <div className="space-y-1.5 rounded-xl border border-navy/20 bg-gradient-to-br from-navy to-navy-800 p-4 text-sm text-white shadow-sm">
          <div className="flex justify-between"><span className="text-white/70">Subtotal</span><span>{formatCurrency(pricing.subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-white/70">Discount</span><span>-{formatCurrency(pricing.discount)}</span></div>
          <div className="flex justify-between"><span className="text-white/70">GST</span><span>+{formatCurrency(pricing.gst)}</span></div>
          <div className="flex justify-between border-t border-white/20 pt-1.5 text-lg font-bold text-gold"><span>Total</span><span>{formatCurrency(pricing.total)}</span></div>
          <div className="flex justify-between pt-1 text-white/70"><span>Cost</span><span>{formatCurrency(pricing.costTotal)}</span></div>
          <div className="flex justify-between"><span className="text-white/70">Our margin</span><span className="font-semibold text-emerald-400">{formatCurrency(pricing.subtotal - pricing.discount - pricing.costTotal)}</span></div>
          <div className="flex justify-between">
            <span className="text-white/70">Profit Margin</span>
            <span className={`font-semibold ${pricing.margin < 0 ? 'text-red-400' : pricing.margin < 15 ? 'text-amber-400' : 'text-emerald-400'}`}>{pricing.margin.toFixed(1)}%</span>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <button type="button" onClick={() => setNotesOpen((v) => !v)} className="text-sm font-semibold text-muted-foreground hover:text-foreground">
          {notesOpen ? '▾' : '▸'} Customer Notes {notes ? '(filled)' : '(optional)'}
        </button>
        {notesOpen && <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}

        <button type="button" onClick={() => setInternalNotesOpen((v) => !v)} className="text-sm font-semibold text-muted-foreground hover:text-foreground">
          {internalNotesOpen ? '▾' : '▸'} Internal Notes {internalNotes ? '(filled)' : '(optional)'}
        </button>
        {internalNotesOpen && <Textarea id="internalNotes" rows={3} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} />}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" variant="outline" disabled={saving || sendingAfterSave}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save as Draft'}
          </Button>
          <Button type="button" variant="outline" disabled={downloading} onClick={onDownload}>
            {downloading ? 'Preparing…' : '⬇ Download'}
          </Button>
          <Button type="button" variant="outline" disabled={copyingLink} onClick={onCopyLink}>
            {copyingLink ? 'Copying…' : '🔗 Copy Link'}
          </Button>
          {!isEdit && (autoSaving ? (
            <span className="text-xs text-muted-foreground">Saving draft…</span>
          ) : draftId ? (
            <span className="text-xs text-emerald-600">Draft saved</span>
          ) : null)}
        </div>
        <Button type="button" className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={saving || sendingAfterSave} onClick={onOpenSendModal}>
          {sendingAfterSave ? 'Saving…' : '💬 Send via WhatsApp'}
        </Button>
      </div>

      {effectiveId
        ? <TripVendors quotationId={effectiveId} destination={destination} />
        : <p className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">Vendors for this trip (hotel, transport, activities, tickets) can be marked here as soon as the quotation is saved.</p>}

      {askRequirement && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-bold text-navy">Which requirement is this quotation for?</h3>
            <p className="mt-1 text-xs text-slate-500">{selectedLead?.customer_name || 'This customer'} already has quotations. A requirement stays the same until it is paid in full, even if the dates or the plan change.</p>
            <div className="mt-4 space-y-2">
              {requirements.filter((r) => !r.closed).map((r) => (
                <button key={r.requirement_no} type="button" onClick={() => { setRequirementNo(r.requirement_no); setAskRequirement(false); }} className="flex w-full items-center justify-between gap-3 rounded-xl border-2 border-gold bg-gold/10 px-4 py-3 text-left hover:bg-gold/20">
                  <span><b className="text-navy">R{r.requirement_no} · Q{r.used + 1}</b><span className="block text-xs text-slate-500">Requirement {r.requirement_no} is still open — {r.used} quotation{r.used === 1 ? '' : 's'} so far{r.destination ? ` · ${r.destination}` : ''}{r.approved ? ' · one approved, not fully paid' : ''}</span></span>
                  <span className="text-xs font-bold text-navy">Create Q{r.used + 1}</span>
                </button>
              ))}
              {requirements.filter((r) => r.closed).map((r) => (
                <div key={r.requirement_no} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-left">
                  <span><b className="text-slate-600">R{r.requirement_no}</b><span className="block text-xs text-slate-500">Paid in full — closed{r.destination ? ` · ${r.destination}` : ''}</span></span>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Closed</span>
                </div>
              ))}
              <button type="button" disabled={!canStartNew} onClick={() => { setRequirementNo(nextRequirement); setAskRequirement(false); }} className={`flex w-full items-center justify-between gap-3 rounded-xl border-2 border-dashed px-4 py-3 text-left ${canStartNew ? 'border-gold bg-gold/10 hover:bg-gold/20' : 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-70'}`}>
                <span><b className="text-navy">R{nextRequirement} · Q1</b><span className="block text-xs text-slate-500">{canStartNew ? 'A new trip for this customer' : `Available once Requirement ${openRequirement} is paid in full`}</span></span>
                <span className="text-xs font-bold text-navy">{canStartNew ? 'New requirement' : 'Locked'}</span>
              </button>
            </div>
            <div className="mt-4 flex justify-end border-t pt-3">
              <Button type="button" variant="outline" onClick={() => { setAskRequirement(false); router.back(); }}>Cancel — go back</Button>
            </div>
          </div>
        </div>
      )}

      {waModalOpen && (
        <SendWhatsAppDialog
          quotationId={waId}
          phone={waPhone}
          customerName={selectedLead?.customer_name || newCustomerName}
          defaultText={waText}
          onClose={() => setWaModalOpen(false)}
          onSent={() => router.push('/quotations')}
        />
      )}
    </form>
  );
}
