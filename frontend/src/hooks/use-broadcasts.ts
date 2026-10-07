'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export type TemplateStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED';
export interface BroadcastTemplate {
  sid: string; name: string; category: string; language: string; kind: string; body: string; footer: string | null;
  hasMedia: boolean; buttons: string[]; variables: { number: number; sample: string; inBody: boolean }[];
  status: TemplateStatus; rejectionReason: string | null; createdAt: string | null;
  // Written on the Bulk WhatsApp page (so it can be deleted there).
  createdHere: boolean;
}
export interface NewTemplateInput {
  name: string; category: 'MARKETING' | 'UTILITY'; language: 'en' | 'fr'; body: string; samples: string[]; footer?: string;
  buttons?: { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url?: string; phone?: string }[];
  headerObjectKey?: string; headerFileName?: string;
}
export interface BroadcastAudience {
  statuses?: string[]; sources?: string[]; destination?: string; assignedTo?: string[]; createdFrom?: string; createdTo?: string; onlyChatted?: boolean;
}
export type BroadcastVariable = { source: 'name' | 'destination' | 'text'; value?: string };
export interface BroadcastPreview {
  count: number; matched: number; invalid: number; optedOut: number; duplicates: number;
  sample: { name: string; phone: string; destination: string }[];
  estimate: { currency: string; total: number; category: string };
  balance: { amount: number; currency: string } | null;
  dailyLimit: number | null; usedLast24h: number; provider: 'twilio' | 'meta';
}
export type BroadcastStatus = 'sending' | 'waiting' | 'paused' | 'done' | 'cancelled';
export interface BroadcastRow {
  id: string; name: string; template_name: string; status: BroadcastStatus; total: number; estimated_cost: string | null; currency: string | null;
  created_at: string; finished_at: string | null; created_by_name: string | null;
  sent: number; delivered: number; read: number; failed: number; skipped: number; queued: number;
}
export interface BroadcastDetail extends BroadcastRow {
  template_body: string | null;
  recipients: { lead_id: string | null; phone: string; name: string | null; status: string; error: string | null; sent_at: string | null }[];
}

// Every template submitted to WhatsApp. Re-read often while one is waiting for WhatsApp's
// decision, so its status changes on the page by itself.
export function useBroadcastTemplates() {
  return useQuery({
    queryKey: ['broadcasts', 'templates'],
    queryFn: () => api.get<BroadcastTemplate[]>('/broadcasts/templates'),
    staleTime: 15_000,
    refetchInterval: (q) => ((q.state.data ?? []).some((t) => t.status === 'PENDING') ? 20_000 : 120_000),
  });
}

export function useTemplateActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['broadcasts', 'templates'] });
  const create = useMutation({ mutationFn: (input: NewTemplateInput) => api.post<{ sid: string; name: string; status: TemplateStatus }>('/broadcasts/templates', input), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (sid: string) => api.delete(`/broadcasts/templates/${sid}`), onSuccess: refresh });
  return { create, remove };
}

export function useTestSend() {
  return useMutation({
    mutationFn: (input: { contentSid: string; variables: Record<string, BroadcastVariable>; phone: string }) => api.post<{ sid: string; to: string; leadId: string | null }>('/broadcasts/test', input),
  });
}

// Where a test message stands; asked every few seconds until WhatsApp delivers or refuses it.
export function useTestStatus(sid: string | null) {
  return useQuery({
    queryKey: ['broadcasts', 'test', sid],
    queryFn: () => api.get<{ status: string; error: string | null }>(`/broadcasts/test/${sid}`),
    enabled: !!sid,
    refetchInterval: (q) => (['delivered', 'read', 'failed'].includes(q.state.data?.status ?? '') || q.state.dataUpdateCount > 40 ? false : 3000),
  });
}

export function useBroadcastFilters() {
  return useQuery({
    queryKey: ['broadcasts', 'filters'],
    queryFn: () => api.get<{ statuses: { v: string; n: number }[]; sources: { v: string; n: number }[]; users: { id: string; full_name: string }[] }>('/broadcasts/filters'),
  });
}

export function useBroadcastPreview(audience: BroadcastAudience, contentSid: string) {
  return useQuery({
    queryKey: ['broadcasts', 'preview', audience, contentSid],
    queryFn: () => api.post<BroadcastPreview>('/broadcasts/preview', { audience, contentSid: contentSid || undefined }),
  });
}

// Polled while anything is still going out, so progress moves without a refresh.
export function useBroadcasts() {
  return useQuery({
    queryKey: ['broadcasts', 'list'],
    queryFn: () => api.get<BroadcastRow[]>('/broadcasts'),
    refetchInterval: (q) => ((q.state.data ?? []).some((b) => b.status === 'sending' || b.status === 'waiting') ? 4000 : 30_000),
  });
}

export function useBroadcast(id: string | null) {
  return useQuery({
    queryKey: ['broadcasts', 'detail', id],
    queryFn: () => api.get<BroadcastDetail>(`/broadcasts/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && ['sending', 'waiting'].includes(q.state.data.status) ? 4000 : false),
  });
}

export function useBroadcastActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['broadcasts'] });
  const create = useMutation({
    mutationFn: (input: { name: string; contentSid: string; variables: Record<string, BroadcastVariable>; audience: BroadcastAudience }) => api.post<BroadcastDetail>('/broadcasts', input),
    onSuccess: refresh,
  });
  const act = useMutation({ mutationFn: (v: { id: string; action: 'pause' | 'resume' | 'cancel' }) => api.post(`/broadcasts/${v.id}/${v.action}`, {}), onSuccess: refresh });
  return { create, act };
}
