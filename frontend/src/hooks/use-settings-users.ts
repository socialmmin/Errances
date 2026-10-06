'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { UserRow } from '@/types/settings';

interface ListResponse<T> {
  data: T[];
  total: number;
}

export function useSettingsUsers() {
  return useQuery({
    queryKey: ['settings-users'],
    queryFn: () => api.get<ListResponse<UserRow>>('/users'),
  });
}

export function useCreateSettingsUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      email?: string; fullName: string; password: string; phone?: string;
      employeeCode?: string; roleId: string; branchId?: string;
    }) => api.post<UserRow>('/users', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings-users'] }),
  });
}

export function useUpdateSettingsUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; fullName?: string; phone?: string; employeeCode?: string; roleId?: string; branchId?: string; isActive?: boolean; participateRoundRobin?: boolean; password?: string }) =>
      api.patch<UserRow>(`/users/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings-users'] }),
  });
}

export function useDeleteSettingsUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings-users'] }),
  });
}
