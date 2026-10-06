'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBooking, useRecordPayment, useToggleChecklistItem } from '@/hooks/use-bookings';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
}

// Simplified port of hala-audit/frontend/src/pages/bookings/today-tour.tsx.
// The reference page drives a per-day / per-stop itinerary activity tracker
// (ActivityStatus per stop) sourced from a day-by-day itinerary table our
// schema doesn't have yet (bookings.itinerary_snapshot is a single jsonb
// blob captured at conversion, not per-day/per-stop rows) — so the "Today's
// Plan" stop tracker is deferred (TODO) pending that schema. This page
// covers the parts our schema does support: payment status + collection,
// and the operational checklist (reusing booking_checklist instead of the
// reference's separate daily_pta_checklist table).
export default function TodaysTourPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: booking, isLoading } = useBooking(id);
  const toggleChecklist = useToggleChecklistItem();
  const recordPayment = useRecordPayment();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!booking) return <p className="text-sm text-muted-foreground">Booking not found.</p>;

  const balance = Math.max(booking.total_amount - booking.paid_amount, 0);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push(`/bookings/${id}`)}>← Back to Booking</Button>

      <div className="rounded-2xl bg-gradient-to-br from-navy to-navy-800 p-6 text-white">
        <p className="text-sm text-white/80">{booking.customer_name}</p>
        <h1 className="mt-1 text-2xl font-bold">{booking.booking_number}</h1>
        <p className="text-sm text-white/80">{booking.travel_from ?? '—'} → {booking.travel_to ?? '—'}</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Payment Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><p className="text-lg font-bold">{formatCurrency(booking.total_amount)}</p><p className="text-xs text-muted-foreground">Total</p></div>
            <div><p className="text-lg font-bold text-green-600">{formatCurrency(booking.paid_amount)}</p><p className="text-xs text-muted-foreground">Received</p></div>
            <div><p className={`text-lg font-bold ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(balance)}</p><p className="text-xs text-muted-foreground">Balance</p></div>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <Label>Amount</Label>
              <Input type="number" className="mt-1.5 w-32" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label>Method</Label>
              <select className="mt-1.5 h-9 rounded-md border bg-background px-2 text-sm" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="card">Card</option>
              </select>
            </div>
            <Button
              disabled={!amount || recordPayment.isPending}
              onClick={() => { recordPayment.mutate({ bookingId: id, amount: parseFloat(amount), method }); setAmount(''); }}
            >
              Collect Payment
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Operational Checklist</CardTitle></CardHeader>
        <CardContent className="space-y-1.5">
          {(booking.checklist ?? []).map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={item.is_done}
                onChange={(e) => toggleChecklist.mutate({ bookingId: id, itemId: item.id, isDone: e.target.checked })}
              />
              <span className={item.is_done ? 'text-muted-foreground line-through' : ''}>{item.item}</span>
            </label>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
