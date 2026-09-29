'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Vendor, VendorInput } from '@/types/vendor';

interface VendorListResponse {
  data: Vendor[];
  total: number;
}

export function useVendors(params: { search?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  const query = qs.toString();
  return useQuery({
    queryKey: ['vendors', params],
    queryFn: () => api.get<VendorListResponse>(`/vendors${query ? `?${query}` : ''}`),
  });
}

export function useVendor(id: string) {
  return useQuery({
    queryKey: ['vendors', id],
    queryFn: () => api.get<Vendor>(`/vendors/${id}`),
    enabled: !!id,
  });
}

export function useCreateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: VendorInput) => api.post<Vendor>('/vendors', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  });
}

export function useUpdateVendor(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<VendorInput>) => api.patch<Vendor>(`/vendors/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendors'] });
      qc.invalidateQueries({ queryKey: ['vendors', id] });
    },
  });
}

export function useDeleteVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/vendors/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  });
}
