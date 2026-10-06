'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface FollowUp {
  id: string;
  lead_id: string;
  due_at: string;
  note: string | null;
  status: 'pending' | 'done' | 'cancelled';
  outcome: string | null;
  follow_up_type: string | null;
  priority: string | null;
  created_by: string | null;
  created_by_name?: string | null;
  completed_at: string | null;
  created_at: string;
  // present only on the global list
  customer_name?: string;
  phone?: string | null;
  whatsapp_number?: string | null;
  destination?: string | null;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
}

export function useLeadFollowUps(leadId?: string) {
  return useQuery({
    queryKey: ['follow-ups', 'lead', leadId],
    queryFn: () => api.get<{ data: FollowUp[] }>(`/leads/${leadId}/follow-ups`),
    enabled: !!leadId,
  });
}

export function useCreateFollowUp(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { dueAt: string; note?: string; followUpType?: string; priority?: string }) => api.post<FollowUp>(`/leads/${leadId}/follow-ups`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['follow-ups', 'lead', leadId] });
      qc.invalidateQueries({ queryKey: ['follow-ups', 'all'] });
      qc.invalidateQueries({ queryKey: ['lead', leadId] });
    },
  });
}

export function useUpdateFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; dueAt?: string; note?: string; status?: 'pending' | 'done' | 'cancelled'; outcome?: string; nextFollowUpAt?: string }) =>
      api.patch<FollowUp>(`/follow-ups/${id}`, input),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['follow-ups', 'lead', updated.lead_id] });
      qc.invalidateQueries({ queryKey: ['follow-ups', 'all'] });
      qc.invalidateQueries({ queryKey: ['lead-notes-feed'] });
    },
  });
}

export interface FollowUpStats { pending: number; done: number; cancelled: number; total: number; overdue: number; today: number; upcoming: number }
export function useFollowUpStats() {
  // pending/done/cancelled/total, plus overdue/today/upcoming (pending split by due time, IST day)
  return useQuery({ queryKey: ['follow-ups', 'stats'], queryFn: () => api.get<FollowUpStats>('/follow-ups/stats'), refetchInterval: 60000 });
}

export function useAllFollowUps(params: { status?: string; assignedTo?: string; search?: string } = {}, opts: { enabled?: boolean } = {}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.assignedTo) qs.set('assignedTo', params.assignedTo);
  if (params.search) qs.set('search', params.search);
  const query = qs.toString();
  return useQuery({
    enabled: opts.enabled ?? true,
    queryKey: ['follow-ups', 'all', params],
    queryFn: () => api.get<{ data: FollowUp[] }>(`/follow-ups${query ? `?${query}` : ''}`),
    refetchInterval: 60000,
  });
}
