'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HandCoins, IndianRupee, Plus, Trash2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { api } from '@/lib/api-client';
import { ADD_NAME, VENDOR_TABS, Vendor, TripLine, LINE_STATUS, categoryLabel, rupees, dateTime, VendorDialog, VendorMoneyDialog } from '@/components/vendors/vendor-book';

interface TripData {
  trip: { id: string; quotation_number: string; destination: string | null; cancelled: boolean; invoice_number: string | null };
  costs: TripLine[]; credits: TripLine[];
  payments: { id: string; cost_id: string; kind: string; amount: number; method: string | null; reference: string | null; note: string | null; paid_at: string; by_name: string | null; source_customer: string | null; source_quotation: string | null }[];
  statement: { quoted: number; taxable: number; received: number; refunded: number; kept: number; vendorAgreed: number; vendorPaid: number; vendorOutstanding: number; vendorCredit: number; margin: number };
}

// The vendors of one trip: who is doing what, what was agreed, what has been paid (advance or
// full) and what is still to pay -- plus the trip's own statement and margin. Shown on the
// quotation and on its invoice; it is the same record in both places and in each vendor's account.
export function TripVendors({ quotationId, destination }: { quotationId: string; destination?: string | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({ queryKey: ['vendor-book', 'trip', quotationId], queryFn: () => api.get<TripData>(`/vendor-book/trips/${quotationId}`), enabled: !!quotationId });
  const dest = destination ?? data?.trip.destination ?? '';
  const [category, setCategory] = useState('hotel');
  const [everywhere, setEverywhere] = useState(false);
  const { data: vendorList } = useQuery({ queryKey: ['vendor-book', 'vendors', category, everywhere ? '' : dest], queryFn: () => api.get<{ data: Vendor[] }>(`/vendor-book/vendors?category=${category}${!everywhere && dest ? `&destination=${encodeURIComponent(dest)}` : ''}`) });
  const vendors = vendorList?.data ?? [];
  const [vendorId, setVendorId] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [adding, setAdding] = useState(false);
  const [newVendor, setNewVendor] = useState(false);
  const [money, setMoney] = useState<null | { line: TripLine; mode: 'payment' | 'vendor_refund' | 'credit' }>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['vendor-book'] });

  async function add() {
    if (!vendorId) { toast('Choose the vendor', 'error'); return; }
    if (!(Number(amount) > 0)) { toast('Enter the amount agreed with the vendor', 'error'); return; }
    setAdding(true);
    try { await api.post(`/vendor-book/trips/${quotationId}/costs`, { vendorId, description, agreedAmount: Number(amount) }); toast('Vendor added to this trip', 'success'); setVendorId(''); setDescription(''); setAmount(''); refresh(); }
    catch (e: any) { toast(e.message || 'Could not add the vendor', 'error'); }
    finally { setAdding(false); }
  }
  async function removeLine(l: TripLine) {
    const ok = await confirm({ title: `Remove ${l.vendor_name} from this trip?`, confirmLabel: 'Remove', variant: 'destructive' });
    if (!ok) return;
    try { await api.delete(`/vendor-book/costs/${l.id}`); refresh(); } catch (e: any) { toast(e.message || 'Could not remove', 'error'); }
  }
  async function removePayment(id: string) {
    const ok = await confirm({ title: 'Remove this entry?', description: 'Use this when it was entered by mistake.', confirmLabel: 'Remove', variant: 'destructive' });
    if (!ok) return;
    try { await api.delete(`/vendor-book/payments/${id}`); refresh(); } catch (e: any) { toast(e.message || 'Could not remove', 'error'); }
  }

  const s = data?.statement;
  const icon = 'grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white hover:border-gold disabled:opacity-40';
  const th = 'whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider';
  const creditsFor = (l: TripLine) => (data?.credits ?? []).filter((c) => c.vendor_id === l.vendor_id);
  const tiles: [string, string, string][] = s ? [
    ['Received from customer', rupees(s.kept), 'text-emerald-300'], ['Vendor cost agreed', rupees(s.vendorAgreed), 'text-white'], ['Paid to vendors', rupees(s.vendorPaid), 'text-sky-300'],
    ['Still to pay vendors', rupees(s.vendorOutstanding), s.vendorOutstanding ? 'text-rose-300' : 'text-slate-300'], ['Credit with vendors', rupees(s.vendorCredit), s.vendorCredit ? 'text-amber-300' : 'text-slate-300'], [data?.trip.cancelled ? 'Kept after cancellation' : 'Margin on this trip', rupees(s.margin), s.margin >= 0 ? 'text-gold' : 'text-rose-300'],
  ] : [];

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="bg-gradient-to-br from-navy to-slate-900 p-5 text-white">
        <p className="text-xs font-bold uppercase tracking-widest text-gold">Vendors &amp; trip account</p>
        <p className="mt-0.5 text-sm text-slate-300">Who is doing what for this trip, what was agreed, what has been paid and what is left. Not shown to the customer.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {tiles.map(([label, value, cls]) => <div key={label} className="rounded-xl bg-white/5 p-3"><p className={`truncate text-lg font-bold tabular-nums ${cls}`}>{value}</p><p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-400">{label}</p></div>)}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead className="bg-navy text-white"><tr>{['S.No', 'Vendor', 'For', 'Agreed', 'Paid', 'Still to pay', 'Status', 'Actions'].map((h) => <th key={h} className={`${th} ${h === 'Actions' ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>
            {(data?.costs ?? []).map((l, i) => (
              <tr key={l.id} className={`border-t border-border/60 ${i % 2 ? 'bg-slate-50/60' : ''}`}>
                <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2.5"><Link href={`/vendors/${l.vendor_id}`} className="font-semibold text-navy hover:underline">{l.vendor_name}</Link><p className="text-[11px] text-muted-foreground">{categoryLabel(l.category)}{l.vendor_phone ? ` · ${l.vendor_phone}` : ''}</p></td>
                <td className="px-3 py-2.5 text-xs text-slate-600">{l.description || '—'}</td>
                <td className="px-3 py-2.5 font-semibold tabular-nums">{rupees(l.agreed)}</td>
                <td className="px-3 py-2.5"><span className="tabular-nums text-emerald-700">{rupees(l.paid)}</span>{l.paid_from_credit > 0 && <p className="text-[11px] text-indigo-700">{rupees(l.paid_from_credit)} from credit</p>}</td>
                <td className="px-3 py-2.5 font-bold tabular-nums text-red-600">{l.cancelled ? '—' : rupees(l.outstanding)}</td>
                <td className="px-3 py-2.5"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${LINE_STATUS[l.status]?.cls}`}>{LINE_STATUS[l.status]?.text}</span>{l.credit > 0 && <p className="mt-0.5 text-[11px] font-semibold text-indigo-700">{rupees(l.credit)} held for a future trip</p>}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1.5">
                    {!l.cancelled && <button type="button" className="grid h-8 w-8 place-items-center rounded-lg bg-gold text-navy hover:brightness-95 disabled:opacity-40" title="Pay the vendor (advance or the rest)" aria-label="Pay the vendor" disabled={l.outstanding <= 0} onClick={() => setMoney({ line: l, mode: 'payment' })}><IndianRupee className="h-4 w-4" /></button>}
                    {!l.cancelled && creditsFor(l).length > 0 && l.outstanding > 0 && <button type="button" className={`${icon} text-indigo-700`} title="Use credit this vendor holds from a cancelled trip" aria-label="Use vendor credit" onClick={() => setMoney({ line: l, mode: 'credit' })}><HandCoins className="h-4 w-4" /></button>}
                    {l.cancelled && l.credit > 0 && <button type="button" className={`${icon} text-emerald-700`} title="The vendor returned this money to us" aria-label="Vendor returned money" onClick={() => setMoney({ line: l, mode: 'vendor_refund' })}><Undo2 className="h-4 w-4" /></button>}
                    <button type="button" className={`${icon} text-red-600`} title={l.paid > 0 ? 'Payments are recorded — remove those first' : 'Remove this vendor from the trip'} aria-label="Remove vendor from trip" disabled={l.paid > 0} onClick={() => removeLine(l)}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
            {!data?.costs.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-muted-foreground">{isLoading ? 'Loading…' : 'No vendor marked for this trip yet. Add one below.'}</td></tr>}
          </tbody>
        </table>
      </div>

      {!data?.trip.cancelled && (
        <div className="flex flex-wrap items-end gap-2 border-t bg-muted/30 p-3">
          <label className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Kind</span>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setVendorId(''); }} className="h-10 w-44 rounded-md border border-input bg-background px-3 text-sm">{VENDOR_TABS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
          <label className="min-w-[14rem] flex-1 space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Vendor{dest && !everywhere ? ` for ${dest}` : ''}</span>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="">{vendors.length ? 'Choose a vendor' : 'No vendor listed here yet'}</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.phone ? ` · ${v.phone}` : ''}{v.category === 'transport' && v.seaters.length ? ` · ${v.seaters.join('/')} seater` : ''}{v.credit ? ` · credit ${rupees(v.credit)}` : ''}</option>)}
            </select></label>
          <label className="min-w-[12rem] flex-1 space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">For</span><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={category === 'hotel' ? 'e.g. 2 rooms, 3 nights' : category === 'transport' ? 'e.g. 7 seater, 4 days' : 'What it is for'} /></label>
          <label className="space-y-1"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Agreed amount (₹)</span><Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-36" /></label>
          <Button type="button" variant="gold" disabled={adding} onClick={add}><Plus className="mr-1 h-4 w-4" />{adding ? 'Adding…' : 'Add to trip'}</Button>
          <div className="flex w-full flex-wrap items-center gap-3 text-xs">
            {dest && <label className="flex items-center gap-1.5 text-slate-600"><input type="checkbox" checked={everywhere} onChange={(e) => { setEverywhere(e.target.checked); setVendorId(''); }} className="h-3.5 w-3.5 accent-navy" />Show vendors of every destination</label>}
            <button type="button" onClick={() => setNewVendor(true)} className="font-semibold text-sky-700 hover:underline">+ Add a new {ADD_NAME[category] ?? 'vendor'}</button>
          </div>
        </div>
      )}

      {!!data?.payments.length && (
        <div className="border-t p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Vendor payments on this trip</p>
          <ul className="mt-2 divide-y divide-border text-sm">
            {data.payments.map((p) => { const l = data.costs.find((c) => c.id === p.cost_id); return (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <div><p className="font-medium text-navy">{p.kind === 'vendor_refund' ? '+ ' : ''}{rupees(p.amount)} <span className="font-normal text-slate-500">· {l?.vendor_name ?? 'Vendor'} · {p.kind === 'credit_applied' ? `credit from ${p.source_customer || 'a cancelled trip'}${p.source_quotation ? ` (${p.source_quotation})` : ''}` : p.kind === 'vendor_refund' ? 'returned by the vendor' : (p.method || 'payment').replace(/_/g, ' ')}</span></p>
                  <p className="text-xs text-muted-foreground">{dateTime(p.paid_at)}{p.by_name ? ` · by ${p.by_name}` : ''}{p.reference ? ` · ${p.reference}` : ''}{p.note && p.kind !== 'credit_applied' ? ` · ${p.note}` : ''}</p></div>
                <button type="button" className={`${icon} text-red-600`} title="Remove this entry (entered by mistake)" aria-label="Remove entry" onClick={() => removePayment(p.id)}><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ); })}
          </ul>
        </div>
      )}

      {newVendor && <VendorDialog category={category} destination={dest} onClose={() => setNewVendor(false)} onSaved={(id) => { setNewVendor(false); refresh(); setVendorId(id); }} />}
      {money && <VendorMoneyDialog line={money.line} mode={money.mode} credits={creditsFor(money.line)} onClose={() => setMoney(null)} onSaved={() => { setMoney(null); refresh(); }} />}
    </section>
  );
}
