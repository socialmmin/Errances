'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Invoice, Payment, OverdueInstallment, PtaCollection, FinanceKpis } from '@/types/finance';

interface ListResponse<T> {
  data: T[];
  total: number;
}

export function useInvoices(params: { status?: string; type?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.type) qs.set('type', params.type);
  const query = qs.toString();
  return useQuery({
    queryKey: ['finance', 'invoices', params],
    queryFn: () => api.get<ListResponse<Invoice>>(`/finance/invoices${query ? `?${query}` : ''}`),
  });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { bookingId: string; type?: string; dueDate?: string }) =>
      api.post<Invoice>('/finance/invoices', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finance', 'invoices'] }),
  });
}

export function useDeleteInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/finance/invoices/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finance', 'invoices'] }),
  });
}

export function useFinanceKpis() {
  return useQuery({
    queryKey: ['finance', 'kpis'],
    queryFn: () => api.get<FinanceKpis>('/finance/kpis'),
  });
}

export function usePayments(params: { status?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  const query = qs.toString();
  return useQuery({
    queryKey: ['finance', 'payments', params],
    queryFn: () => api.get<ListResponse<Payment>>(`/finance/payments${query ? `?${query}` : ''}`),
  });
}

export function useOverdueInstallments() {
  return useQuery({
    queryKey: ['finance', 'installments', 'overdue'],
    queryFn: () => api.get<OverdueInstallment[]>('/finance/installments/overdue'),
  });
}

export function useTodayPtaCollections() {
  return useQuery({
    queryKey: ['finance', 'pta-collections', 'today'],
    queryFn: () => api.get<PtaCollection[]>('/finance/pta-collections/today'),
  });
}

export function useVerifyPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.patch<Payment>(`/finance/payments/${id}/verify`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance'] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}

export function useRejectPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.patch<Payment>(`/finance/payments/${id}/reject`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finance'] }),
  });
}
