'use client';

import { useParams } from 'next/navigation';
import { BookingDetail } from '@/components/bookings/booking-detail';

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <BookingDetail id={id} />;
}
