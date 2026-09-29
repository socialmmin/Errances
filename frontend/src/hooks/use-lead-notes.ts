'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface LeadNoteFeedItem {
  id: string;
  source: 'note' | 'requirement' | 'quotation' | 'followup';
  label: string;
  body: string;
  at: string;
  by: string | null;
}

export function useLeadNotesFeed(leadId?: string) {
  return useQuery({
    queryKey: ['lead-notes-feed', leadId],
    queryFn: () => api.get<{ data: LeadNoteFeedItem[]; notesOnly: number }>(`/leads/${leadId}/notes-feed`),
    enabled: !!leadId,
  });
}

export function useCreateLeadNote(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.post(`/leads/${leadId}/notes-feed`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead-notes-feed', leadId] }),
  });
}
