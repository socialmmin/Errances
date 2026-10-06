'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface FunnelRow {
  campaign: string; leads: number; valid: number; good: number; bad: number; neutral: number; qualified: number; quotation: number; advance: number; booked: number; revenue: number;
  spend: number | null; cpl: number | null; costPerValid: number | null; costPerGood: number | null; costPerQualified: number | null; costPerBooking: number | null; roas: number | null;
}

export function useMetaFunnel() {
  return useQuery({ queryKey: ['meta', 'funnel'], queryFn: () => api.get<{ data: FunnelRow[]; spendWithoutCrmLeads: number; spendError: string | null }>('/integrations/meta/funnel'), staleTime: 60_000 });
}

export function useMetaIdCoverage() {
  return useQuery({ queryKey: ['meta', 'id-coverage'], queryFn: () => api.get<{ meta_leads: number; with_lead_id: number; missing_lead_id: number; with_campaign: number; with_adset: number; with_ad: number; with_form: number }>('/integrations/meta/id-coverage') });
}

export interface CapiStatus {
  mode: 'off' | 'test' | 'live'; datasetId: string | null; testEventCode: string | null;
  events: { event_name: string; status: string; n: number }[];
  recentErrors: { event_name: string; response: string; created_at: string }[];
}
export function useCapiStatus() {
  return useQuery({ queryKey: ['meta', 'capi'], queryFn: () => api.get<CapiStatus>('/integrations/meta/capi'), refetchInterval: 20000 });
}
export function useSetCapiMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { mode: string; testEventCode?: string }) => api.post<CapiStatus>('/integrations/meta/capi/mode', v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meta', 'capi'] }),
  });
}
export function useBackfillMetaIds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ candidates: number; filled: number; failed: number }>('/integrations/meta/backfill-ids', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meta', 'id-coverage'] }),
  });
}
export function useAudienceCounts() {
  return useQuery({ queryKey: ['meta', 'audiences'], queryFn: () => api.get<Record<string, number>>('/integrations/meta/audiences') });
}

export interface MetaEventLogRow {
  id: string; lead_id: string; customer_name: string; lead_number: string; crm_status: string; campaign_name: string;
  event_name: string; send_status: 'pending' | 'sent' | 'test_sent' | 'failed' | 'skipped';
  response: string | null; sent_at: string | null; created_at: string;
}
export function useMetaEventLog(filter?: 'received' | 'not_received') {
  return useQuery({
    queryKey: ['meta', 'capi', 'events', filter ?? 'all'],
    queryFn: () => api.get<{ data: MetaEventLogRow[] }>(`/integrations/meta/capi/events${filter ? `?filter=${filter}` : ''}`),
    refetchInterval: 20000,
  });
}
export function useRetryMetaEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => api.post(`/integrations/meta/capi/events/${eventId}/retry`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meta', 'capi'] }),
  });
}
