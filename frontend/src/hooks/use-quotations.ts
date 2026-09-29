'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Quotation, QuotationInput, QuotationStats } from '@/types/quotation';

interface QuotationListResponse {
  data: Quotation[];
  total: number;
}

export function useQuotations(params: { search?: string; status?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.status) qs.set('status', params.status);
  const query = qs.toString();
  return useQuery({
    queryKey: ['quotations', params],
    queryFn: () => api.get<QuotationListResponse>(`/quotations${query ? `?${query}` : ''}`),
  });
}

export function useQuotationStats() {
  return useQuery({
    queryKey: ['quotations', 'stats'],
    queryFn: () => api.get<QuotationStats>('/quotations/stats'),
  });
}

export function useQuotation(id: string) {
  return useQuery({
    queryKey: ['quotations', id],
    queryFn: () => api.get<Quotation>(`/quotations/${id}`),
    enabled: !!id,
  });
}

export function useCreateQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QuotationInput) => api.post<Quotation>('/quotations', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotations'] });
    },
  });
}

export function useUpdateQuotation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<QuotationInput>) => api.patch<Quotation>(`/quotations/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotations'] });
      qc.invalidateQueries({ queryKey: ['quotations', id] });
    },
  });
}

export function useUpdateQuotationStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: string) => api.patch<Quotation>(`/quotations/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotations'] });
      qc.invalidateQueries({ queryKey: ['quotations', id] });
    },
  });
}

export function useSendQuotationWhatsApp(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ success: boolean; sentTo: string; link: string }>(`/quotations/${id}/send-whatsapp`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotations'] });
      qc.invalidateQueries({ queryKey: ['quotations', id] });
    },
  });
}

export function useDeleteQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/quotations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotations'] }),
  });
}
