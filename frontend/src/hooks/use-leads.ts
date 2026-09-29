'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Lead, LeadInput } from '@/types/lead';

interface LeadListResponse {
  data: Lead[];
  total: number;
}

export function useLeads(
  params: { search?: string; status?: string; campaignName?: string; noPhone?: boolean; itineraryStatus?: 'read' | 'delivered' | 'sent' | 'unconfirmed' | 'failed' | 'none'; source?: string; assignedTo?: string; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number; sortBy?: 'lead_date' | 'activity'; ids?: string[]; enabled?: boolean } = {},
) {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.status) qs.set('status', params.status);
  if (params.campaignName) qs.set('campaignName', params.campaignName);
  if (params.noPhone) qs.set('noPhone', 'true');
  if (params.itineraryStatus) qs.set('itineraryStatus', params.itineraryStatus);
  if (params.source) qs.set('source', params.source);
  if (params.assignedTo) qs.set('assignedTo', params.assignedTo);
  if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
  if (params.dateTo) qs.set('dateTo', params.dateTo);
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params.sortBy) qs.set('sortBy', params.sortBy);
  if (params.ids?.length) qs.set('ids', params.ids.join(','));
  const query = qs.toString();
  return useQuery({
    queryKey: ['leads', params],
    queryFn: () => api.get<LeadListResponse>(`/leads${query ? `?${query}` : ''}`),
    enabled: params.enabled ?? true,
  });
}

export interface LeadStats {
  total: number;
  new_leads: number;
  hot: number;
  unassigned: number;
  meta_ads: number;
  today: number;
}

export function useLeadStats() {
  return useQuery({
    queryKey: ['leads', 'stats'],
    queryFn: () => api.get<LeadStats>('/leads/stats'),
  });
}

export interface CampaignOption {
  campaign_name: string;
  lead_count: number;
}

export function useLeadCampaigns() {
  return useQuery({
    queryKey: ['leads', 'campaigns'],
    queryFn: () => api.get<CampaignOption[]>('/leads/campaigns'),
  });
}

export interface CampaignSummary { campaign: string; total: number; sent: number; notSent: number }

export function useCampaignSummary(campaign: string) {
  return useQuery({
    queryKey: ['leads', 'campaign-summary', campaign],
    queryFn: () => api.get<CampaignSummary>(`/leads/campaign-summary?campaign=${encodeURIComponent(campaign)}`),
    enabled: !!campaign,
  });
}

export interface AssignableUser {
  id: string;
  full_name: string;
  employee_code: string | null;
}

export function useAssignableUsers(enabled = true) {
  return useQuery({
    queryKey: ['users', 'assignable'],
    queryFn: () => api.get<{ data: AssignableUser[] }>('/users/assignable'),
    enabled,
  });
}

export function useBulkAssignLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { leadIds: string[]; assignedTo: string }) =>
      api.patch<{ updated: number }>('/leads/bulk-assign', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export function useLead(id: string) {
  return useQuery({
    queryKey: ['leads', id],
    queryFn: () => api.get<Lead>(`/leads/${id}`),
    enabled: !!id,
  });
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LeadInput) => api.post<Lead>('/leads', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export function useUpdateLead(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<LeadInput>) => api.patch<Lead>(`/leads/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['leads', id] });
    },
  });
}

export function useSetLeadCollaborators(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) => api.patch<Lead>(`/leads/${id}/collaborators`, { userIds }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leads'] }); qc.invalidateQueries({ queryKey: ['leads', id] }); },
  });
}

export function useQuickUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<LeadInput> }) => api.patch<Lead>(`/leads/${id}`, input),
    onSuccess: (_lead, variables) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['leads', variables.id] });
    },
  });
}

export function useAddLeadRequirement(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => api.post(`/leads/${id}/requirements`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['leads', id] });
    },
  });
}

export function useDeleteLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/leads/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}
