'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { PERMISSIONS } from '@/lib/permissions';
import {
  useBooking, useApproveBooking, useAssignPta, useToggleChecklistItem,
  useRecordPayment, useAddVendorPayment, useDeleteBooking,
} from '@/hooks/use-bookings';
import { BOOKING_STATUS_LABELS, APPROVAL_STATUS_LABELS } from '@/types/booking';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'approval', label: 'Approval' },
  { id: 'itinerary', label: 'Itinerary' },
  { id: 'travelers', label: 'Travelers' },
  { id: 'hotels', label: 'Hotels' },
  { id: 'flights', label: 'Flights' },
  { id: 'transport', label: 'Transport' },
  { id: 'payments', label: 'Payments' },
  { id: 'documents', label: 'Documents' },
  { id: 'notes', label: 'Notes' },
] as const;

const STEPS = [
  { key: 'quotation_approved', label: 'Quotation Approved' },
  { key: 'advance_paid', label: 'Advance Paid' },
  { key: 'booking_confirmed', label: 'Booking Confirmed' },
  { key: 'docs_ready', label: 'Docs Ready' },
  { key: 'tour_started', label: 'Tour Started' },
  { key: 'completed', label: 'Completed' },
] as const;

function computeStepIndex(booking: any): number {
  if (booking.status === 'completed') return 6;
  if (booking.status === 'in_progress') return 5;
  const docsReady = (booking.checklist ?? []).length > 0 && (booking.checklist ?? []).every((c: any) => c.is_done);
  if (docsReady) return 4;
  if (booking.status === 'confirmed') return 3;
  if (booking.paid_amount > 0) return 2;
  if (booking.approval_status === 'approved') return 1;
  return 0;
}

export function BookingDetail({ id }: { id: string }) {
  const router = useRouter();
  const { data: booking, isLoading } = useBooking(id);
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['id']>('overview');
  const confirm = useConfirm();
  const approve = useApproveBooking();
  const assignPta = useAssignPta();
  const toggleChecklist = useToggleChecklistItem();
  const recordPayment = useRecordPayment();
  const addVendorPayment = useAddVendorPayment();
  const remove = useDeleteBooking();

  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [vendorId, setVendorId] = useState('');
  const [vendorAmount, setVendorAmount] = useState('');
  const [vendorNotes, setVendorNotes] = useState('');
  const [ptaUserId, setPtaUserId] = useState('');

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading booking…</p>;
  if (!booking) return <p className="text-sm text-muted-foreground">Booking not found.</p>;

  const balance = Math.max(booking.total_amount - booking.paid_amount, 0);
  const stepIndex = computeStepIndex(booking);

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => router.push('/bookings')}>← Back to Bookings</Button>

      {/* Status bar */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div>
            <p className="text-lg font-semibold text-navy dark:text-white">{booking.booking_number}</p>
            <p className="text-sm text-muted-foreground">
              {booking.customer_name} · {booking.travel_from ?? '—'} → {booking.travel_to ?? '—'}
            </p>
            <p className="text-xs text-muted-foreground">
              Status: {BOOKING_STATUS_LABELS[booking.status] ?? booking.status} · Approval: {APPROVAL_STATUS_LABELS[booking.approval_status] ?? booking.approval_status}
              {booking.ops_executive_name ? ` · PTA: ${booking.ops_executive_name}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="font-semibold">{formatCurrency(booking.total_amount)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Paid</p>
              <p className="font-semibold text-green-600">{formatCurrency(booking.paid_amount)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Balance</p>
              <p className={`font-semibold ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(balance)}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => router.push(`/bookings/${id}/today-tour`)}>Today's Tour</Button>
          </div>
        </CardContent>
      </Card>

      {/* Progress tracker */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  i < stepIndex ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : i === stepIndex ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                  : 'bg-muted text-muted-foreground'
                }`}
              >
                {s.label}
              </span>
              {i < STEPS.length - 1 && <span className="text-muted-foreground">→</span>}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              t.id === activeTab ? 'border-gold text-navy dark:text-gold' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <Card><CardContent className="space-y-3 p-4">
          <p className="text-sm font-medium">Checklist</p>
          {(booking.checklist ?? []).map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={item.is_done}
                onChange={(e) => toggleChecklist.mutate({ bookingId: id, itemId: item.id, isDone: e.target.checked })}
              />
              <span className={item.is_done ? 'line-through text-muted-foreground' : ''}>{item.item}</span>
            </label>
          ))}
          <div className="pt-3">
            <Label>Assign PTA (Operations Executive user id)</Label>
            <div className="mt-1.5 flex gap-2">
              <Input value={ptaUserId} onChange={(e) => setPtaUserId(e.target.value)} placeholder="user id" />
              <Button
                size="sm"
                disabled={!ptaUserId || assignPta.isPending}
                onClick={() => assignPta.mutate({ id, userId: ptaUserId })}
              >
                Assign
              </Button>
            </div>
          </div>
        </CardContent></Card>
      )}

      {activeTab === 'approval' && (
        <Card><CardContent className="space-y-3 p-4">
          <p className="text-sm">Vendor cost entries</p>
          {(booking.vendorPayments ?? []).map((vp) => (
            <div key={vp.id} className="flex justify-between rounded border p-2 text-sm">
              <span>{vp.vendor_name ?? vp.vendor_id}</span>
              <span>{formatCurrency(vp.amount)}</span>
            </div>
          ))}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Input placeholder="Vendor ID" value={vendorId} onChange={(e) => setVendorId(e.target.value)} />
            <Input placeholder="Amount" type="number" value={vendorAmount} onChange={(e) => setVendorAmount(e.target.value)} />
            <Input placeholder="Notes" value={vendorNotes} onChange={(e) => setVendorNotes(e.target.value)} />
          </div>
          <Button
            size="sm"
            disabled={!vendorId || !vendorAmount || addVendorPayment.isPending}
            onClick={() => {
              addVendorPayment.mutate({ bookingId: id, vendorId, amount: parseFloat(vendorAmount), notes: vendorNotes || undefined });
              setVendorId(''); setVendorAmount(''); setVendorNotes('');
            }}
          >
            Add Vendor Cost
          </Button>
          <PermissionGuard permission={PERMISSIONS.FINANCE_APPROVE_REFUND}>
            <div className="pt-2">
              <Button
                disabled={booking.approval_status === 'approved' || approve.isPending}
                onClick={() => approve.mutate(id)}
              >
                {booking.approval_status === 'approved' ? 'Approved' : 'Approve Booking'}
              </Button>
            </div>
          </PermissionGuard>
        </CardContent></Card>
      )}

      {activeTab === 'itinerary' && (
        <Card><CardContent className="p-4">
          <p className="mb-2 text-xs text-muted-foreground">Snapshot captured at conversion time — not live.</p>
          <pre className="max-h-96 overflow-auto rounded bg-muted p-3 text-xs">
            {booking.itinerary_snapshot ? JSON.stringify(booking.itinerary_snapshot, null, 2) : 'No itinerary snapshot.'}
          </pre>
        </CardContent></Card>
      )}

      {activeTab === 'travelers' && (
        <Card><CardContent className="space-y-2 p-4">
          {(booking.travelers ?? []).length === 0 && <p className="text-sm text-muted-foreground">No travelers added.</p>}
          {(booking.travelers ?? []).map((t) => {
            const expiryWarning = t.passport_expiry
              ? (new Date(t.passport_expiry).getTime() - Date.now()) / 86400000 < 180
              : false;
            return (
              <div key={t.id} className="rounded border p-2 text-sm">
                <p className="font-medium">{t.full_name}{t.is_lead_traveler ? ' (Lead)' : ''}</p>
                <p className="text-xs text-muted-foreground">
                  Passport: {t.passport_number ?? '—'} {t.nationality ? `· ${t.nationality}` : ''}
                  {t.passport_expiry && (
                    <span className={expiryWarning ? 'ml-1 text-red-600' : ''}>
                      · Expiry: {t.passport_expiry}{expiryWarning ? ' (expiring soon)' : ''}
                    </span>
                  )}
                </p>
              </div>
            );
          })}
        </CardContent></Card>
      )}

      {activeTab === 'hotels' && (
        <Card><CardContent className="space-y-2 p-4">
          {(booking.hotels ?? []).length === 0 && <p className="text-sm text-muted-foreground">No hotels booked.</p>}
          {(booking.hotels ?? []).map((h) => (
            <div key={h.id} className="flex items-center justify-between rounded border p-2 text-sm">
              <div>
                <p className="font-medium">{h.hotel_name ?? '—'}</p>
                <p className="text-xs text-muted-foreground">{h.check_in} → {h.check_out} · {h.rooms} room(s) · {h.vendor_name ?? '—'}</p>
              </div>
              <div className="text-right">
                <p>{formatCurrency(h.cost)}</p>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{h.status}</span>
              </div>
            </div>
          ))}
        </CardContent></Card>
      )}

      {activeTab === 'flights' && (
        <Card><CardContent className="space-y-2 p-4">
          {(booking.flights ?? []).length === 0 && <p className="text-sm text-muted-foreground">No flights booked.</p>}
          {(booking.flights ?? []).map((f) => (
            <div key={f.id} className="flex items-center justify-between rounded border p-2 text-sm">
              <div>
                <p className="font-medium">{f.airline ?? '—'} {f.flight_number ?? ''}</p>
                <p className="text-xs text-muted-foreground">{f.departure_airport} → {f.arrival_airport} · PNR {f.pnr ?? '—'}</p>
              </div>
              <div className="text-right">
                <p>{formatCurrency(f.cost)}</p>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{f.status}</span>
              </div>
            </div>
          ))}
        </CardContent></Card>
      )}

      {activeTab === 'transport' && (
        <Card><CardContent className="space-y-2 p-4">
          {(booking.transports ?? []).length === 0 && <p className="text-sm text-muted-foreground">No transport booked.</p>}
          {(booking.transports ?? []).map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded border p-2 text-sm">
              <div>
                <p className="font-medium">{t.vendor_name ?? '—'}</p>
                <p className="text-xs text-muted-foreground">{t.from_date} → {t.to_date}</p>
              </div>
              <div className="text-right">
                <p>{formatCurrency(t.cost)}</p>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{t.status}</span>
              </div>
            </div>
          ))}
        </CardContent></Card>
      )}

      {activeTab === 'payments' && (
        <Card><CardContent className="space-y-4 p-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><p className="text-lg font-bold">{formatCurrency(booking.total_amount)}</p><p className="text-xs text-muted-foreground">Total</p></div>
            <div><p className="text-lg font-bold text-green-600">{formatCurrency(booking.paid_amount)}</p><p className="text-xs text-muted-foreground">Paid</p></div>
            <div><p className={`text-lg font-bold ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(balance)}</p><p className="text-xs text-muted-foreground">Balance</p></div>
          </div>

          <div>
            <p className="mb-1 text-sm font-medium">Installments</p>
            {(booking.installments ?? []).map((inst) => (
              <div key={inst.id} className="flex justify-between rounded border p-2 text-sm">
                <span>Due {inst.due_date}</span>
                <span>{formatCurrency(inst.amount)} · {inst.status}</span>
              </div>
            ))}
          </div>

          <div>
            <p className="mb-1 text-sm font-medium">Payment History</p>
            {(booking.payments ?? []).length === 0 && <p className="text-sm text-muted-foreground">No payments recorded.</p>}
            {(booking.payments ?? []).map((p) => (
              <div key={p.id} className="flex justify-between rounded border p-2 text-sm">
                <span>{new Date(p.paid_at).toLocaleDateString('en-IN')} · {p.method ?? '—'}</span>
                <span>{formatCurrency(p.amount)}</span>
              </div>
            ))}
          </div>

          <PermissionGuard permission={PERMISSIONS.BOOKINGS_EDIT}>
            <div className="flex items-end gap-2">
              <div>
                <Label>Amount</Label>
                <Input type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="mt-1.5 w-32" />
              </div>
              <div>
                <Label>Method</Label>
                <select
                  className="mt-1.5 h-9 rounded-md border bg-background px-2 text-sm"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                >
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="card">Card</option>
                </select>
              </div>
              <Button
                disabled={!paymentAmount || recordPayment.isPending}
                onClick={() => {
                  recordPayment.mutate({ bookingId: id, amount: parseFloat(paymentAmount), method: paymentMethod });
                  setPaymentAmount('');
                }}
              >
                Record Payment
              </Button>
            </div>
          </PermissionGuard>
        </CardContent></Card>
      )}

      {activeTab === 'documents' && (
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Documents — not yet built (placeholder, matches Hala's reference).</p></CardContent></Card>
      )}
      {activeTab === 'notes' && (
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Notes — not yet built (placeholder, matches Hala's reference).</p></CardContent></Card>
      )}

      <PermissionGuard permission={PERMISSIONS.BOOKINGS_CANCEL}>
        <Button
          variant="outline"
          className="text-red-600"
          onClick={async () => {
            const ok = await confirm({ title: 'Delete this booking?', confirmLabel: 'Delete', variant: 'destructive' });
            if (ok) remove.mutate(id, { onSuccess: () => router.push('/bookings') });
          }}
        >
          Delete Booking
        </Button>
      </PermissionGuard>
    </div>
  );
}
