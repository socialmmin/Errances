'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useAuthStore } from '@/store/auth-store';
import { useCreateBooking, useCreateBookingFromQuotation } from '@/hooks/use-bookings';
import { tr } from '@/i18n';

// Booking creation is normally reached by converting an approved quotation
// (quotation_id passed as a query param, see quotations/[id]/page.tsx's
// "Convert to Booking" button). A plain customer id can also be supplied
// directly for a booking with no quotation behind it.
export default function NewBookingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const branchId = useAuthStore((s) => s.user?.branchId);
  const quotationId = searchParams.get('quotation_id') ?? undefined;

  const [customerId, setCustomerId] = useState('');
  const createFromQuotation = useCreateBookingFromQuotation();
  const createBooking = useCreateBooking();

  async function onSubmit() {
    if (!customerId || !branchId) return;
    try {
      const booking = quotationId
        ? await createFromQuotation.mutateAsync({ quotationId, customerId, branchId })
        : await createBooking.mutateAsync({ customerId, branchId });
      toast(tr("Booking created"), 'success');
      router.push(`/bookings/${booking.id}`);
    } catch (err: any) {
      toast(err.message || tr("Failed to create booking"), 'error');
    }
  }

  const pending = createFromQuotation.isPending || createBooking.isPending;

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-2xl font-semibold text-navy dark:text-white">{tr("New Booking")}</h1>
      <Card>
        <CardContent className="space-y-4 p-4">
          {quotationId && <p className="text-xs text-muted-foreground">{tr("Converting quotation")}{' '}{quotationId}</p>}
          <div>
            <Label>{tr("Customer ID *")}</Label>
            <Input className="mt-1.5" value={customerId} onChange={(e) => setCustomerId(e.target.value)} placeholder={tr("customer uuid")} />
          </div>
          <Button disabled={!customerId || pending} onClick={onSubmit}>
            {pending ? tr("Creating…") : tr("Create Booking")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
