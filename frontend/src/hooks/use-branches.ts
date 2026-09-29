'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Branch } from '@/types/settings';

interface ListResponse<T> {
  data: T[];
  total: number;
}

export function useBranches() {
  return useQuery({
    queryKey: ['branches'],
    queryFn: () => api.get<ListResponse<Branch>>('/branches'),
  });
}

export function useCreateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; city?: string; country?: string; phone?: string; email?: string }) =>
      api.post<Branch>('/branches', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['branches'] }),
  });
}

export function useUpdateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; isActive?: boolean; name?: string; city?: string; country?: string; phone?: string; email?: string }) =>
      api.patch<Branch>(`/branches/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['branches'] }),
  });
}

export function useDeleteBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/branches/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['branches'] }),
  });
}
