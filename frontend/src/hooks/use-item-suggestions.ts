'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface ItemSuggestion {
  id: string;
  category: string;
  label: string;
}

export function useItemSuggestions(category: string) {
  return useQuery({
    queryKey: ['item-suggestions', category],
    queryFn: () => api.get<{ data: ItemSuggestion[] }>(`/quotations/item-suggestions?category=${encodeURIComponent(category)}`),
    enabled: !!category,
  });
}

export function useCreateItemSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { category: string; label: string }) => api.post<ItemSuggestion>('/quotations/item-suggestions', input),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['item-suggestions', vars.category] }),
  });
}

export function useUpdateItemSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) => api.patch<ItemSuggestion>(`/quotations/item-suggestions/${id}`, { label }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['item-suggestions'] }),
  });
}

export function useDeleteItemSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/quotations/item-suggestions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['item-suggestions'] }),
  });
}
