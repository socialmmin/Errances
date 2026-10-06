'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Quotation, QuotationInput, QuotationStats } from '@/types/quotation';

interface QuotationListResponse {
  data: Quotation[];
  total: number;
}

export function useQuotations(params: { search?: string; status?: string; from?: string; to?: string; category?: string; destination?: string } = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const query = qs.toString();
  return useQuery({
    queryKey: ['quotations', params],
    queryFn: () => api.get<QuotationListResponse>(`/quotations${query ? `?${query}` : ''}`),
  });
}

export function useQuotationStats(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['quotations', 'stats'],
    queryFn: () => api.get<QuotationStats>('/quotations/stats'),
    enabled: options.enabled ?? true,
    refetchInterval: 60_000,
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

interface QuotationTemplateSettings {
  templateId: string | null;
  templateName: string | null;
  templateStatus: string | null;
  templateRejectionReason: string | null;
}

export function useQuotationTemplate() {
  return useQuery({
    queryKey: ['quotations', 'template'],
    queryFn: () => api.get<QuotationTemplateSettings>('/quotations/template'),
  });
}

export function useSubmitQuotationTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<QuotationTemplateSettings>('/quotations/template/submit', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotations', 'template'] }),
  });
}

export function useSyncQuotationTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<QuotationTemplateSettings>('/quotations/template/sync', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotations', 'template'] }),
  });
}

export function useDeleteQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/quotations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotations'] }),
  });
}
