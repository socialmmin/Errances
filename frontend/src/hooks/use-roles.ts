'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Role } from '@/types/settings';

interface ListResponse<T> {
  data: T[];
  total: number;
}

export function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<ListResponse<Role>>('/roles'),
  });
}
