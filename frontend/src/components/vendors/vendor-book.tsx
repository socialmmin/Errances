'use client';
import { waNumber } from '@/lib/utils';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BedDouble, Building2, CarFront, CheckCircle2, Circle, Landmark, Mail, MapPin, MapPinned, Phone, Plane, Plus, ReceiptText, StickyNote, Store, Tent, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { PLACES } from '@/lib/places';

// Shared pieces of the vendor book: the categories (the tabs), the vendor record, money
// formatting, and the pop-ups to add/edit a vendor and to record money against a trip.

export const VENDOR_TABS: { key: string; label: string; hint: string }[] = [
  { key: 'hotel', label: 'Hotels', hint: 'Hotels, resorts, homestays' },
  { key: 'transport', label: 'Transport', hint: 'Cabs and vans by seats' },
  { key: 'activity', label: 'Activities', hint: 'Bungee jumping, campfire, sightseeing…' },
  { key: 'travel', label: 'Flight · Train · Bus', hint: 'Ticketing' },
  { key: 'other', label: 'Others', hint: 'Guides and anything else' },
];
export const categoryLabel = (k?: string | null) => VENDOR_TABS.find((t) => t.key === k)?.label ?? 'Other';
export const rupees = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n) || 0);
export const dateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
export const dateOnly = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export interface Vendor {
  id: string; name: string; category: string; phone: string | null; email: string | null; address: string | null; gst_number: string | null;
  destinations: string[]; seaters: number[]; travel_modes: string[]; contact_person: string | null; notes: string | null; bank_details: string | null;
  trips?: number; agreed?: number; paid?: number; outstanding?: number; credit?: number;
}
export interface TripLine {
  id: string; quotation_id: string; vendor_id: string; category: string | null; description: string | null; agreed: number; paid: number; paid_from_credit: number; vendor_refunded: number; credit_used: number;
  outstanding: number; credit: number; status: 'not_paid' | 'part_paid' | 'paid' | 'credit' | 'cancelled'; cancelled: boolean; created_at: string; last_paid_at: string | null;
  vendor_name: string; vendor_phone: string | null; vendor_category: string | null;
  quotation_number: string; requirement_no: number; destination: string | null; travel_from: string | null; travel_to: string | null; lead_id: string | null;
  customer_name: string | null; customer_phone: string | null; invoice_id: string | null; invoice_number: string | null;
}
export const LINE_STATUS: Record<string, { text: string; cls: string }> = {
  not_paid: { text: 'Not paid', cls: 'bg-red-100 text-red-700' },
  part_paid: { text: 'Advance paid', cls: 'bg-amber-100 text-amber-800' },
  paid: { text: 'Paid in full', cls: 'bg-emerald-100 text-emerald-700' },
  credit: { text: 'Cancelled · credit with vendor', cls: 'bg-indigo-100 text-indigo-800' },
  cancelled: { text: 'Cancelled', cls: 'bg-slate-100 text-slate-600' },
};

// The pop-up adds one kind of vendor only: the kind of the tab (or the kind chosen on the trip).
export const ADD_NAME: Record<string, string> = { hotel: 'hotel', transport: 'transport vendor', activity: 'activity vendor', travel: 'flight / train / bus vendor', other: 'vendor' };
const SEATS = [2, 4, 5, 7, 10, 12, 17, 20, 26, 35, 45];
const MODES = ['flight', 'train', 'bus'];
const chip = (on: boolean) => `rounded-full border px-2.5 py-1 text-xs font-semibold ${on ? 'border-navy bg-navy text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-gold'}`;

// Destinations a vendor serves: chosen from the destinations the CRM already has (leads,
// itineraries, quotations), found by typing a letter or two, or a new one typed in.
function DestinationPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['vendor-book', 'destinations'], queryFn: () => api.get<{ data: { name: string; leads: number }[] }>('/vendor-book/destinations'), staleTime: 60_000 });
  const has = (name: string) => value.some((v) => v.toLowerCase() === name.toLowerCase());
  const q = text.trim().toLowerCase();
  // The CRM's own destinations first (they have leads), then well-known places, so typing
  // "ch" offers Chennai, Chidambaram, Chandigarh... Names starting with what was typed come first.
  const own = data?.data ?? [];
  const known = new Set(own.map((d) => d.name.toLowerCase()));
  const all = [...own, ...PLACES.filter((p) => !known.has(p.toLowerCase())).map((name) => ({ name, leads: 0 }))];
  const rank = (name: string) => { const n = name.toLowerCase(); return n.startsWith(q) ? 0 : n.split(/[\s-]+/).some((w) => w.startsWith(q)) ? 1 : 2; };
  const options = all.filter((d) => !has(d.name) && (q ? d.name.toLowerCase().includes(q) : d.leads > 0))
    .sort((a, b) => (q ? rank(a.name) - rank(b.name) || b.leads - a.leads || a.name.localeCompare(b.name) : 0)).slice(0, 40);
  const exact = all.some((d) => d.name.toLowerCase() === q);
  const add = (name: string) => { const n = name.trim(); if (n && !has(n)) onChange([...value, n]); setText(''); };
  return (
    <div className="relative">
      <div className={`flex min-h-9 flex-wrap items-center gap-1 rounded-lg border bg-white px-2.5 py-1 transition ${open ? 'border-gold ring-2 ring-gold/20' : 'border-slate-200'}`}>
        <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
        {value.map((d) => <span key={d} className="flex items-center gap-1 rounded-full bg-navy px-2 py-0.5 text-[11px] font-semibold text-white">{d}<button type="button" aria-label={`Remove ${d}`} onClick={() => onChange(value.filter((x) => x !== d))} className="text-white/70 hover:text-white">×</button></span>)}
        <input id="v-dest" value={text} onChange={(e) => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ',') && text.trim()) { e.preventDefault(); add(options.find((o) => o.name.toLowerCase() === q)?.name ?? text); } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1)); }}
          placeholder={value.length ? 'Add another…' : 'Type a place — empty means all'} className="h-7 min-w-[7rem] flex-1 bg-transparent text-sm text-navy outline-none placeholder:text-slate-400" />
      </div>
      {open && (options.length > 0 || (q && !exact)) && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-2xl">
          {options.map((o) => <button key={o.name} type="button" onMouseDown={(e) => { e.preventDefault(); add(o.name); }} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-navy hover:bg-gold/15"><span className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-slate-400" />{o.name}</span>{o.leads > 0 && <span className="text-[11px] text-slate-500">{o.leads} lead{o.leads === 1 ? '' : 's'}</span>}</button>)}
          {q && !exact && <button type="button" onMouseDown={(e) => { e.preventDefault(); add(text); }} className="flex w-full items-center gap-2 rounded-lg border-t border-slate-100 px-3 py-2 text-left text-sm font-semibold text-sky-700 hover:bg-sky-50"><Plus className="h-3.5 w-3.5" />Add “{text.trim()}” as a new destination</button>}
        </div>
      )}
    </div>
  );
}

const sectionTitle = 'flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-navy';
const fieldLabel = 'mb-1 block text-xs font-semibold text-slate-600';
const fieldInput = 'h-9 w-full min-w-0 flex-1 bg-transparent text-sm text-navy outline-none placeholder:text-slate-400';
function Field({ id, label, icon: Icon, required, bad, children }: { id: string; label: string; icon: typeof MapPin; required?: boolean; bad?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={fieldLabel}>{label}{required && <span className="ml-0.5 text-red-600">*</span>}</label>
      <div className={`flex items-center gap-2 rounded-lg border bg-white px-2.5 transition focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20 ${bad ? 'border-red-500 ring-2 ring-red-200' : 'border-slate-200'}`}>
        <Icon className="h-4 w-4 shrink-0 text-slate-400" />{children}
      </div>
    </div>
  );
}

export function VendorDialog({ vendor, category, destination, onClose, onSaved }: { vendor?: Vendor | null; category: string; destination?: string | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({
    category: vendor?.category ?? category, name: vendor?.name ?? '', phone: vendor?.phone ?? '', contactPerson: vendor?.contact_person ?? '',
    destinations: vendor?.destinations ?? (destination ? [destination] : []), seaters: vendor?.seaters ?? [], travelModes: vendor?.travel_modes ?? [],
    email: vendor?.email ?? '', gstNumber: vendor?.gst_number ?? '', address: vendor?.address ?? '', bankDetails: vendor?.bank_details ?? '', notes: vendor?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [bad, setBad] = useState<Record<string, boolean>>({});
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const phoneOk = !!waNumber(f.phone);

  // How much of the form is filled: the two compulsory fields count most.
  const steps: [string, boolean][] = [
    ['Name', !!f.name.trim()], ['Mobile', phoneOk], ['Destinations', f.destinations.length > 0],
    ...(f.category === 'transport' ? [['Vehicles', f.seaters.length > 0] as [string, boolean]] : []),
    ...(f.category === 'travel' ? [['Tickets', f.travelModes.length > 0] as [string, boolean]] : []),
    ['Contact person', !!f.contactPerson.trim()], ['Payment details', !!f.bankDetails.trim()], ['GST', !!f.gstNumber.trim()],
  ];
  const done = steps.filter(([, ok]) => ok).length;
  const pct = Math.round((done / steps.length) * 100);
  const ready = !!f.name.trim() && phoneOk;

  async function save() {
    const missing = { name: !f.name.trim(), phone: !phoneOk };
    setBad(missing);
    if (missing.name || missing.phone) { toast(missing.name ? 'Enter the vendor name' : 'Enter a valid mobile number, e.g. 06 12 34 56 78 or +33 6 12 34 56 78', 'error'); return; }
    setSaving(true);
    try {
      const res = vendor ? await api.patch<{ id: string }>(`/vendor-book/vendors/${vendor.id}`, f) : await api.post<{ id: string }>('/vendor-book/vendors', f);
      toast(vendor ? 'Vendor updated' : 'Vendor added', 'success');
      onSaved(res.id);
    } catch (e: any) { toast(e.message || 'Could not save the vendor', 'error'); }
    finally { setSaving(false); }
  }
  const KindIcon = f.category === 'hotel' ? BedDouble : f.category === 'transport' ? CarFront : f.category === 'activity' ? Tent : f.category === 'travel' ? Plane : Store;

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 rounded-t-2xl bg-gradient-to-br from-navy to-slate-900 px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold text-navy"><KindIcon className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1"><h3 className="text-base font-bold capitalize">{vendor ? 'Edit' : 'Add'} {ADD_NAME[f.category] ?? 'vendor'}</h3><p className="text-xs text-slate-300">Identified by mobile number, so no vendor is entered twice.</p></div>
            <span className="text-sm font-bold tabular-nums text-gold">{pct}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Form filled"><div className={`h-full rounded-full transition-all duration-300 ${ready ? 'bg-emerald-400' : 'bg-gold'}`} style={{ width: `${pct}%` }} /></div>
          <p className="mt-1.5 text-[11px] text-slate-400">{done} of {steps.length} filled{steps.some(([, ok]) => !ok) ? ` · still empty: ${steps.filter(([, ok]) => !ok).map(([l]) => l.toLowerCase()).join(', ')}` : ' · complete'}</p>
        </div>

        <div className="space-y-3 bg-slate-50 p-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <p className={sectionTitle}><Building2 className="h-3.5 w-3.5 text-gold" />Vendor</p>
            <div className="mt-3 grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2">
              <Field id="v-name" label="Vendor name" required icon={Building2} bad={bad.name}><input id="v-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={f.category === 'hotel' ? 'e.g. Hotel Lake View' : f.category === 'transport' ? 'e.g. Sri Murugan Travels' : 'Vendor name'} className={fieldInput} /></Field>
              <Field id="v-phone" label="Mobile number" required icon={Phone} bad={bad.phone}><input id="v-phone" value={f.phone} inputMode="tel" maxLength={20} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/[^\d+ ]/g, '') })} placeholder="06 12 34 56 78" className={fieldInput} /></Field>
              <Field id="v-person" label="Contact person" icon={UserRound}><input id="v-person" value={f.contactPerson} onChange={(e) => setF({ ...f, contactPerson: e.target.value })} placeholder="Optional" className={fieldInput} /></Field>
              <div><label htmlFor="v-dest" className={fieldLabel}>Destinations served</label><DestinationPicker value={f.destinations} onChange={(destinations) => setF({ ...f, destinations })} /></div>
            </div>
          </section>

          {f.category === 'transport' && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <p className={sectionTitle}><CarFront className="h-3.5 w-3.5 text-gold" />Vehicles available</p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">{SEATS.map((n) => <button key={n} type="button" onClick={() => setF({ ...f, seaters: toggle(f.seaters, n).sort((a, b) => a - b) })} className={chip(f.seaters.includes(n))}>{n} seater</button>)}</div>
            </section>
          )}
          {f.category === 'travel' && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <p className={sectionTitle}><Plane className="h-3.5 w-3.5 text-gold" />Tickets for</p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">{MODES.map((m) => <button key={m} type="button" onClick={() => setF({ ...f, travelModes: toggle(f.travelModes, m) })} className={`${chip(f.travelModes.includes(m))} capitalize`}>{m}</button>)}</div>
            </section>
          )}

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <p className={sectionTitle}><Landmark className="h-3.5 w-3.5 text-gold" />Payment and other details <span className="font-medium normal-case tracking-normal text-slate-400">· optional</span></p>
            <div className="mt-3 grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2">
              <Field id="v-bank" label="Bank / UPI for payments" icon={Landmark}><input id="v-bank" value={f.bankDetails} onChange={(e) => setF({ ...f, bankDetails: e.target.value })} placeholder="Account number, IFSC or UPI ID" className={fieldInput} /></Field>
              <Field id="v-gst" label="GST number" icon={ReceiptText}><input id="v-gst" value={f.gstNumber} onChange={(e) => setF({ ...f, gstNumber: e.target.value.toUpperCase() })} placeholder="e.g. 33ABCDE1234F1Z5" className={fieldInput} /></Field>
              <Field id="v-email" label="Email" icon={Mail}><input id="v-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@example.com" className={fieldInput} /></Field>
              <Field id="v-addr" label="Address" icon={MapPinned}><input id="v-addr" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Street, town" className={fieldInput} /></Field>
              <div className="sm:col-span-2"><Field id="v-notes" label="Notes" icon={StickyNote}><input id="v-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Rates, terms, anything to remember" className={fieldInput} /></Field></div>
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-b-2xl border-t border-slate-200 bg-white px-5 py-3">
          <p className={`flex items-center gap-1.5 text-xs font-semibold ${ready ? 'text-emerald-700' : 'text-slate-500'}`}>{ready ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}{ready ? 'Ready to save' : 'Name and mobile number are needed'}</p>
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" variant="gold" disabled={saving} onClick={save}>{saving ? 'Saving…' : vendor ? 'Save changes' : `Add ${ADD_NAME[f.category] ?? 'vendor'}`}</Button></div>
        </div>
      </div>
    </div>
  );
}

// Money against one vendor on one trip: a payment to the vendor (advance or the rest), money the
// vendor gave back, or credit from a cancelled trip used here.
export function VendorMoneyDialog({ line, mode, credits = [], onClose, onSaved }: { line: TripLine; mode: 'payment' | 'vendor_refund' | 'credit'; credits?: TripLine[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const holding = Math.max(line.paid - line.vendor_refunded - line.credit_used, 0);
  const [sourceId, setSourceId] = useState(credits[0]?.id ?? '');
  const source = credits.find((c) => c.id === sourceId);
  const limit = mode === 'payment' ? line.outstanding : mode === 'vendor_refund' ? holding : Math.min(line.outstanding, source?.credit ?? 0);
  const [amount, setAmount] = useState(String(mode === 'credit' ? Math.min(line.outstanding, credits[0]?.credit ?? 0) : limit));
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const now = new Date();
  const [paidAt, setPaidAt] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
  const [saving, setSaving] = useState(false);
  const title = mode === 'payment' ? 'Pay the vendor' : mode === 'vendor_refund' ? 'Vendor returned money' : 'Use vendor credit';

  async function save() {
    const n = Number(amount) || 0;
    if (n <= 0) { toast('Enter an amount above zero', 'error'); return; }
    setSaving(true);
    try {
      if (mode === 'credit') await api.post(`/vendor-book/costs/${line.id}/apply-credit`, { sourceCostId: sourceId, amount: n });
      else await api.post(`/vendor-book/costs/${line.id}/payments`, { kind: mode, amount: n, method, reference, note, paidAt: new Date(paidAt).toISOString() });
      toast(mode === 'payment' ? 'Payment to the vendor recorded' : mode === 'vendor_refund' ? 'Recorded' : 'Credit used on this trip', 'success');
      onSaved();
    } catch (e: any) { toast(e.message || 'Could not save', 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-navy">{title}</h3>
        <p className="text-xs text-slate-500">{line.vendor_name} · {line.customer_name || 'Customer'} · {line.destination || ''} · {line.quotation_number}</p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-xl bg-slate-50 p-2.5"><p className="font-bold uppercase tracking-wide text-slate-500">Agreed</p><p className="text-sm font-bold tabular-nums text-navy">{rupees(line.agreed)}</p></div>
          <div className="rounded-xl bg-emerald-50 p-2.5"><p className="font-bold uppercase tracking-wide text-emerald-700">Paid</p><p className="text-sm font-bold tabular-nums text-emerald-700">{rupees(line.paid)}</p></div>
          <div className="rounded-xl bg-rose-50 p-2.5"><p className="font-bold uppercase tracking-wide text-rose-700">{line.cancelled ? 'Held by vendor' : 'Still to pay'}</p><p className="text-sm font-bold tabular-nums text-rose-700">{rupees(line.cancelled ? holding : line.outstanding)}</p></div>
        </div>
        {mode === 'credit' && (
          <div className="mt-3 space-y-1"><Label htmlFor="m-src">Credit from</Label>
            <select id="m-src" value={sourceId} onChange={(e) => { setSourceId(e.target.value); const c = credits.find((x) => x.id === e.target.value); setAmount(String(Math.min(line.outstanding, c?.credit ?? 0))); }} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              {credits.map((c) => <option key={c.id} value={c.id}>{c.customer_name || 'Cancelled trip'} · {c.destination || ''} · {c.quotation_number} — {rupees(c.credit)} credit</option>)}
            </select>
            <p className="text-[11px] text-slate-500">This money was paid to the vendor for a trip that was cancelled. Using it here means that much less is paid for this trip.</p></div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label htmlFor="m-amount">Amount (₹)</Label><Input id="m-amount" type="number" min={1} max={limit} value={amount} onChange={(e) => setAmount(e.target.value)} /><p className="text-[11px] text-slate-500">Up to {rupees(limit)}</p></div>
          {mode !== 'credit' && <div className="space-y-1"><Label htmlFor="m-method">Method</Label><select id="m-method" value={method} onChange={(e) => setMethod(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{['bank_transfer', 'upi', 'cash', 'card', 'cheque'].map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}</select></div>}
          {mode !== 'credit' && <div className="space-y-1"><Label htmlFor="m-date">Date and time</Label><Input id="m-date" type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></div>}
          {mode !== 'credit' && <div className="space-y-1"><Label htmlFor="m-ref">Reference</Label><Input id="m-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction ID (optional)" /></div>}
          {mode !== 'credit' && <div className="col-span-2 space-y-1"><Label htmlFor="m-note">Note</Label><Input id="m-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'payment' ? 'e.g. Advance for 2 rooms' : 'Optional'} /></div>}
        </div>
        <div className="mt-5 flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" variant="gold" disabled={saving || limit <= 0} onClick={save}>{saving ? 'Saving…' : title}</Button></div>
      </div>
    </div>
  );
}
