'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface CallbackRequest {
  id: string; lead_id: string | null; customer_name: string; phone: string; destination: string | null;
  requested_at: string; called_at: string | null; called_by: string | null; called_by_name: string | null;
  outcome: string | null; note: string | null;
}

export function useCallbackRequests(opts: { enabled?: boolean } = {}) {
  return useQuery({
    enabled: opts.enabled ?? true,
    queryKey: ['callback-requests'],
    queryFn: () => api.get<{ data: CallbackRequest[] }>('/callback-requests'),
    refetchInterval: 30000,
  });
}

export type CallbackOutcome = 'busy' | 'quotation' | 'itinerary' | 'converted' | 'not_interested';

export function useMarkCallbackCalled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note, outcome, nextFollowUpAt }: { id: string; note?: string; outcome?: CallbackOutcome; nextFollowUpAt?: string }) =>
      api.patch<CallbackRequest & { outcome: CallbackOutcome | null }>(`/callback-requests/${id}/mark-called`, { note, outcome, nextFollowUpAt }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['callback-requests'] });
      qc.invalidateQueries({ queryKey: ['lead-notes-feed'] });
      qc.invalidateQueries({ queryKey: ['follow-ups'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['lead'] });
    },
  });
}
