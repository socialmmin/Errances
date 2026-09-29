'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Customer, CustomerInput } from '@/types/customer';

interface CustomerListResponse {
  data: Customer[];
  total: number;
}

export function useCustomers(params: { search?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  const query = qs.toString();
  return useQuery({
    queryKey: ['customers', params],
    queryFn: () => api.get<CustomerListResponse>(`/customers${query ? `?${query}` : ''}`),
  });
}

export function useCustomer(id: string) {
  return useQuery({
    queryKey: ['customers', id],
    queryFn: () => api.get<Customer>(`/customers/${id}`),
    enabled: !!id,
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerInput) => api.post<Customer>('/customers', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  });
}

export function useUpdateCustomer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CustomerInput>) => api.patch<Customer>(`/customers/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customers', id] });
    },
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/customers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  });
}
