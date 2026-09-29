'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Booking, BookingInput, BookingStats } from '@/types/booking';

interface BookingListResponse {
  data: Booking[];
  total: number;
}

export function useBookings(params: { search?: string; status?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.status) qs.set('status', params.status);
  const query = qs.toString();
  return useQuery({
    queryKey: ['bookings', params],
    queryFn: () => api.get<BookingListResponse>(`/bookings${query ? `?${query}` : ''}`),
  });
}

export function useBookingStats() {
  return useQuery({
    queryKey: ['bookings', 'stats'],
    queryFn: () => api.get<BookingStats>('/bookings/stats'),
  });
}

export function useBooking(id: string) {
  return useQuery({
    queryKey: ['bookings', id],
    queryFn: () => api.get<Booking>(`/bookings/${id}`),
    enabled: !!id,
  });
}

export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BookingInput) => api.post<Booking>('/bookings', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings'] }),
  });
}

export function useCreateBookingFromQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quotationId, ...input }: BookingInput & { quotationId: string }) =>
      api.post<Booking>(`/bookings/from-quotation/${quotationId}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings'] }),
  });
}

export function useUpdateBooking(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<BookingInput>) => api.patch<Booking>(`/bookings/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      qc.invalidateQueries({ queryKey: ['bookings', id] });
    },
  });
}

export function useApproveBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.patch<Booking>(`/bookings/${id}/approve`, {}),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      qc.invalidateQueries({ queryKey: ['bookings', id] });
    },
  });
}

export function useAssignPta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) =>
      api.patch<Booking>(`/bookings/${id}/assign-pta`, { userId }),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      qc.invalidateQueries({ queryKey: ['bookings', id] });
    },
  });
}

export function useUpdateBookingStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch<Booking>(`/bookings/${id}/status`, { status }),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      qc.invalidateQueries({ queryKey: ['bookings', id] });
    },
  });
}

export function useToggleChecklistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, itemId, isDone }: { bookingId: string; itemId: string; isDone: boolean }) =>
      api.post(`/bookings/${bookingId}/checklist/${itemId}/toggle`, { isDone }),
    onSuccess: (_d, { bookingId }) => qc.invalidateQueries({ queryKey: ['bookings', bookingId] }),
  });
}

export function useRecordPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, amount, method, reference }: { bookingId: string; amount: number; method?: string; reference?: string }) =>
      api.post(`/bookings/${bookingId}/payments`, { amount, method, reference }),
    onSuccess: (_d, { bookingId }) => {
      qc.invalidateQueries({ queryKey: ['bookings', bookingId] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}

export function useAddVendorPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, vendorId, amount, notes }: { bookingId: string; vendorId: string; amount: number; notes?: string }) =>
      api.post(`/bookings/${bookingId}/vendor-payments`, { vendorId, amount, notes }),
    onSuccess: (_d, { bookingId }) => qc.invalidateQueries({ queryKey: ['bookings', bookingId] }),
  });
}

export function useDeleteBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/bookings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings'] }),
  });
}
