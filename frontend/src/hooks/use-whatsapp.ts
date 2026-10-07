'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { WhatsAppTemplate, WhatsAppLog, WhatsAppConfig } from '@/types/whatsapp';

interface ListResponse<T> {
  data: T[];
  total: number;
}

export function useWhatsAppTemplates() {
  return useQuery({
    queryKey: ['whatsapp', 'templates'],
    queryFn: () => api.get<ListResponse<WhatsAppTemplate>>('/whatsapp/templates'),
  });
}

export function useCreateWhatsAppTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; bodyTemplate: string; isActive?: boolean }) =>
      api.post<WhatsAppTemplate>('/whatsapp/templates', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp', 'templates'] }),
  });
}

export function useUpdateWhatsAppTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; bodyTemplate?: string; isActive?: boolean }) =>
      api.patch<WhatsAppTemplate>(`/whatsapp/templates/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp', 'templates'] }),
  });
}

export function useDeleteWhatsAppTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/whatsapp/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp', 'templates'] }),
  });
}

export function useWhatsAppLogs() {
  return useQuery({
    queryKey: ['whatsapp', 'logs'],
    queryFn: () => api.get<ListResponse<WhatsAppLog>>('/whatsapp/logs'),
  });
}

export function useWhatsAppConfig() {
  return useQuery({
    queryKey: ['whatsapp', 'config'],
    queryFn: () => api.get<WhatsAppConfig>('/whatsapp/config'),
  });
}

export function useWhatsAppAutomation() {
  return useQuery({
    queryKey: ['whatsapp', 'automation'],
    queryFn: () => api.get<{ live_mode: boolean; test_numbers: string[]; updated_at?: string }>('/whatsapp/automation'),
  });
}

export interface WhatsAppBusinessProfile { name: string; phone: string | null; pictureUrl: string | null }

// Business name and logo as customers see them in WhatsApp (used by the itinerary preview).
export function useWhatsAppProfile() {
  return useQuery({
    queryKey: ['whatsapp', 'profile'],
    queryFn: () => api.get<WhatsAppBusinessProfile>('/integrations/whatsapp/profile'),
    staleTime: 10 * 60 * 1000,
  });
}

export function useSendTestItinerary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { to: string; packageId: string }) => api.post('/integrations/whatsapp/test-itinerary', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp', 'logs'] }),
  });
}

export function useSubmitItineraryTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (packageId: string) => api.post<import('@/types/package').TourPackage>(`/integrations/whatsapp/packages/${packageId}/template/submit`, {}),
    // Invalidating only ['packages', id] left every OTHER view of this package stale -- the
    // Itinerary Library table and the "Itineraries for this campaign" sibling list both read
    // from the broader ['packages', params] list query, which has a different key and was never
    // refetched, so they kept showing "Not submitted" even once this package's own detail view
    // (reading ['packages', id] directly) correctly showed "In review".
    onSuccess: (_, id) => { qc.invalidateQueries({ queryKey: ['packages'] }); qc.invalidateQueries({ queryKey: ['packages', id] }); },
  });
}

export function useSyncItineraryTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (packageId: string) => api.post<import('@/types/package').TourPackage>(`/integrations/whatsapp/packages/${packageId}/template/sync`, {}),
    onSuccess: (_, id) => { qc.invalidateQueries({ queryKey: ['packages'] }); qc.invalidateQueries({ queryKey: ['packages', id] }); },
  });
}

// Additional itinerary documents ("Add another") -- each one's own template, keyed by document id.
export function useSubmitDocumentTemplate(packageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => api.post<import('@/hooks/use-packages').PackageDocument & { meta_details?: any }>(`/integrations/whatsapp/documents/${documentId}/template/submit`, {}),
    // Same reasoning as useSubmitItineraryTemplate -- the Itinerary Library list and campaign
    // sibling list both read from ['packages', params], not ['packages', packageId, 'documents'].
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['packages'] }); qc.invalidateQueries({ queryKey: ['packages', packageId, 'documents'] }); },
  });
}
export function useSyncDocumentTemplate(packageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => api.post<import('@/hooks/use-packages').PackageDocument & { meta_details?: any }>(`/integrations/whatsapp/documents/${documentId}/template/sync`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['packages'] }); qc.invalidateQueries({ queryKey: ['packages', packageId, 'documents'] }); },
  });
}

export function useSaveWhatsAppConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { phoneNumberId: string; accessToken: string; businessAccountId?: string }) =>
      api.post<{ is_configured: boolean }>('/whatsapp/config', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp', 'config'] }),
  });
}

export function useUpdateTestNumbers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (testNumbers: string[]) => api.patch('/whatsapp/automation', { testNumbers }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp', 'automation'] }),
  });
}

export interface WhatsAppChatMessage { id: string; direction: 'in' | 'out'; msg_type: string; body: string; created_at: string; meta?: any; wa_message_id?: string | null; sent_by_name?: string | null }

export function useLeadMessages(leadId?: string | null) {
  return useQuery({
    queryKey: ['whatsapp', 'messages', leadId],
    queryFn: () => api.get<WhatsAppChatMessage[]>(`/integrations/whatsapp/messages/${leadId}`),
    enabled: !!leadId,
    refetchInterval: 8000,
  });
}

export function useSendAgentMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { leadId: string; text: string; replyToWaId?: string }) => api.post<WhatsAppChatMessage>('/integrations/whatsapp/messages/send', v),
    onSuccess: (_, v) => qc.invalidateQueries({ queryKey: ['whatsapp', 'messages', v.leadId] }),
  });
}

export function useSendAgentMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { leadId: string; url: string; filename: string; mimeType: string; caption?: string }) =>
      api.post<WhatsAppChatMessage>('/integrations/whatsapp/messages/send-media', v),
    onSuccess: (_, v) => qc.invalidateQueries({ queryKey: ['whatsapp', 'messages', v.leadId] }),
  });
}

export interface WhatsAppHealth {
  configured: boolean; tokenValid: boolean; appId: string | null; appName: string | null;
  secretSource: 'crm' | 'server' | null; secretValid: boolean; subscribed: boolean;
  inboundCount: number; lastInboundAt: string | null; lastRejectedAt: string | null;
  qualityRating: 'GREEN' | 'YELLOW' | 'RED' | null; throughputTier: string | null;
  recentOutboundCount: number; inboundStale: boolean;
  provider?: 'twilio'; sender?: string; senderName?: string | null; senderStatus?: string | null;
}

export function useWhatsAppHealth() {
  return useQuery({ queryKey: ['whatsapp', 'health'], queryFn: () => api.get<WhatsAppHealth>('/integrations/whatsapp/health'), refetchInterval: 30000 });
}

export function useSaveAppSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (secret: string) => api.post<WhatsAppHealth>('/integrations/whatsapp/app-secret', { secret }),
    onSuccess: (data) => qc.setQueryData(['whatsapp', 'health'], data),
  });
}

export interface PackageDelivery {
  campaign: string | null; destination: string | null; isActive: boolean; templateStatus: string;
  liveMode: boolean; testNumbers: string[]; total: number; sent: number; pending: number; noPhone: number;
  leads: { id: string; name: string; phone: string | null; enquiry: string; sent: boolean; sentAt: string | null; validPhone: boolean }[];
  stuckCount: number; throttled: boolean; autoPaused: boolean; autoPausedAt: string | null;
  primaryLabel: string; additionalDocuments: { id: string; label: string; sent: number; total: number }[];
}

export function fetchPackageDelivery(packageId: string) {
  return api.get<PackageDelivery>(`/integrations/whatsapp/packages/${packageId}/delivery-status`);
}

export function usePackageDelivery(packageId?: string, enabled = true) {
  return useQuery({ queryKey: ['whatsapp', 'delivery', packageId], queryFn: () => fetchPackageDelivery(packageId!), enabled: !!packageId && enabled });
}

export function useSendPendingItinerary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (packageId: string) => api.post<{ sent: number; skippedTestMode: number; noPhone: number; failed: number; liveMode: boolean }>(`/integrations/whatsapp/packages/${packageId}/send-pending`, {}),
    onSuccess: (_, id) => qc.invalidateQueries({ queryKey: ['whatsapp', 'delivery', id] }),
  });
}

export function useResendItinerary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ packageId, leadId }: { packageId: string; leadId: string }) =>
      api.post<{ sent: boolean; reason?: string }>(`/integrations/whatsapp/packages/${packageId}/resend/${leadId}`, {}),
    onSuccess: (_, { packageId }) => {
      qc.invalidateQueries({ queryKey: ['whatsapp', 'delivery', packageId] });
      qc.invalidateQueries({ queryKey: ['whatsapp', 'package-messages', packageId] });
    },
  });
}

export interface FailedItinerary {
  leadId: string; packageId: string; customerName: string; phone: string | null; destination: string | null;
  packageName: string; failedAt: string; errorMessage: string | null;
  reason: string; fault: 'queued' | 'meta' | 'customer' | 'us' | 'unknown'; solution: string; retryable: boolean;
  manualAt: string | null; manualBy: string | null;
}

export function useMarkManualSent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { leadId: string; packageId: string; undo?: boolean }) => v.undo
      ? api.delete(`/integrations/whatsapp/failed-sends/manual/${v.packageId}/${v.leadId}`)
      : api.post('/integrations/whatsapp/failed-sends/manual', { leadId: v.leadId, packageId: v.packageId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['whatsapp', 'failed-sends'] }); qc.invalidateQueries({ queryKey: ['whatsapp'] }); },
  });
}

export function useFailedItineraries(opts: { enabled?: boolean } = {}) {
  return useQuery({ enabled: opts.enabled ?? true, queryKey: ['whatsapp', 'failed-sends'], queryFn: () => api.get<{ data: FailedItinerary[]; total: number }>('/integrations/whatsapp/failed-sends'), refetchInterval: 20000 });
}

export function useRetryAllFailed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ queued: number; skipped: number }>('/integrations/whatsapp/failed-sends/retry-all', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp', 'failed-sends'] }),
  });
}

export interface WhatsAppBilling {
  provider?: 'twilio' | 'meta'; balance?: number; currency: string; monthStart: string; totalCost: number; gstRate: number; estimatedGst: number; estimatedTotal: number; todayCost: number;
  byCategory: { category: string; volume: number; cost: number }[]; days: { date: string; volume: number; cost: number }[]; updatedAt: string;
}

export function useWhatsAppBilling(opts: { enabled?: boolean } = {}) {
  return useQuery({ enabled: opts.enabled ?? true, queryKey: ['whatsapp', 'billing'], queryFn: () => api.get<WhatsAppBilling>('/integrations/whatsapp/billing-summary'), refetchInterval: 5 * 60 * 1000, retry: false });
}

export interface CoverageLead { id: string; name: string; createdAt: string; destination: string | null; campaign: string | null; source: string | null; phone: string | null }
export interface LeadCoverage { total: number; received: number; failed: number; notSentYet: number; noPhone: number; noItinerary: number; noPhoneLeads: CoverageLead[]; noItineraryLeads: CoverageLead[] }

export function useLeadCoverage() {
  return useQuery({ queryKey: ['whatsapp', 'lead-coverage'], queryFn: () => api.get<LeadCoverage>('/integrations/whatsapp/lead-coverage'), refetchInterval: 30000 });
}

export interface UnsentItinerary { leadId: string; packageId: string; customerName: string; phone: string | null; destination: string | null; packageName: string }

export function useUnsentItineraries() {
  return useQuery({ queryKey: ['whatsapp', 'unsent'], queryFn: () => api.get<{ data: UnsentItinerary[]; total: number }>('/integrations/whatsapp/unsent'), refetchInterval: 30000 });
}

export function useSendUnsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ queued: number }>('/integrations/whatsapp/unsent/send', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp', 'unsent'] }),
  });
}

export function usePackageThumbnail(packageId?: string) {
  return useQuery({ queryKey: ['package-thumbnail', packageId], queryFn: () => api.get<{ dataUrl: string | null }>(`/packages/${packageId}/thumbnail`), enabled: !!packageId, staleTime: 5 * 60_000 });
}

export function savePackageThumbnail(packageId: string, dataUrl: string) {
  return api.post(`/packages/${packageId}/thumbnail`, { dataUrl });
}

export interface PackageMessageRow {
  id: string; status: string; error_message: string | null; to_number: string; message_id: string | null;
  sent_at: string | null; created_at: string; lead_id: string | null; customer_name: string | null;
  lead_number: string | null; destination: string | null; campaign_name: string | null;
  sent_by_name: string | null;
}

export function usePackageMessages(packageId?: string) {
  return useQuery({ queryKey: ['whatsapp', 'package-messages', packageId], queryFn: () => api.get<{ data: PackageMessageRow[]; total: number }>(`/integrations/whatsapp/packages/${packageId}/messages`), enabled: !!packageId, refetchInterval: 15000 });
}

export interface WhatsAppUsageCategory { category: string; label: string; count: number; priceInr: number; subtotalInr: number }
export interface WhatsAppUsageSummary { categories: WhatsAppUsageCategory[]; totalMessages: number; totalSpentInr: number; ratesSet: boolean }

export function useWhatsAppUsageSummary() {
  return useQuery({ queryKey: ['whatsapp', 'usage-summary'], queryFn: () => api.get<WhatsAppUsageSummary>('/whatsapp/usage-summary'), refetchInterval: 60000 });
}

export function useUpdateWhatsAppRates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rates: { category: string; priceInr: number }[]) => api.patch('/whatsapp/rates', { rates }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp', 'usage-summary'] }),
  });
}


// ---- Inbox: unread, open/waiting/done, quick replies, star, re-open ----
export type ChatStatus = 'open' | 'waiting' | 'done';
export interface InboxStateRow { lead_id: string; status: ChatStatus; unread: number; needs_reply?: boolean; last_body: string | null; last_direction: 'in' | 'out' | null; last_type: string | null; last_at: string | null }

export function useInboxState(opts: { enabled?: boolean } = {}) {
  return useQuery({
    enabled: opts.enabled ?? true,
    queryKey: ['whatsapp', 'inbox-state'],
    queryFn: () => api.get<{ data: InboxStateRow[] }>('/integrations/whatsapp/inbox-state'),
    refetchInterval: 10000,
    select: (r) => Object.fromEntries(r.data.map((row) => [row.lead_id, row])) as Record<string, InboxStateRow>,
  });
}

export function useMarkChatRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leadId: string) => api.post(`/integrations/whatsapp/inbox/${leadId}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp', 'inbox-state'] }),
  });
}

export function useSetChatStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { leadId: string; status: ChatStatus }) => api.post(`/integrations/whatsapp/inbox/${v.leadId}/status`, { status: v.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp', 'inbox-state'] }),
  });
}

export function useReopenChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leadId: string) => api.post(`/integrations/whatsapp/inbox/${leadId}/reopen`, {}),
    onSuccess: (_, leadId) => { qc.invalidateQueries({ queryKey: ['whatsapp', 'messages', leadId] }); qc.invalidateQueries({ queryKey: ['whatsapp', 'logs'] }); },
  });
}

export interface QuickReply { id: string; title: string; body: string }
export function useQuickReplies() {
  return useQuery({ queryKey: ['whatsapp', 'quick-replies'], queryFn: () => api.get<{ data: QuickReply[] }>('/integrations/whatsapp/quick-replies') });
}
export function useCreateQuickReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { title: string; body: string }) => api.post<QuickReply>('/integrations/whatsapp/quick-replies', v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp', 'quick-replies'] }),
  });
}
export function useDeleteQuickReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/integrations/whatsapp/quick-replies/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp', 'quick-replies'] }),
  });
}

export function useToggleStar(leadId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => api.post<{ starred: boolean }>(`/integrations/whatsapp/messages/${messageId}/star`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp', 'messages', leadId] }),
  });
}

// ---- Twilio / Meta switch (Settings > WhatsApp) ----
export interface WhatsAppProviders {
  active: 'twilio' | 'meta';
  twilio: { configured: boolean; sender: string | null; ready: boolean; senderStatus: string | null; name: string | null };
  meta: {
    configured: boolean; tokenValid: boolean; number: string | null; name: string | null; quality: string | null; dailyLimit: number | null;
    canSend: boolean; sendProblem: string | null; warnings: string[]; webhookOk: boolean; hasAppSecret: boolean;
    phoneNumberId: string | null; businessAccountId: string | null; ready: boolean; problems: string[];
  };
}

// Asks Twilio and Meta live each time, so the screen shows what would really happen on a switch.
export function useWhatsAppProviders() {
  return useQuery({ queryKey: ['whatsapp', 'providers'], queryFn: () => api.get<WhatsAppProviders>('/whatsapp/providers'), staleTime: 30_000 });
}

export function useWhatsAppProviderActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['whatsapp'] });
  const switchTo = useMutation({ mutationFn: (provider: 'twilio' | 'meta') => api.post<WhatsAppProviders>('/whatsapp/provider', { provider }), onSuccess: refresh });
  const saveMeta = useMutation({
    mutationFn: (input: { phoneNumberId: string; businessAccountId: string; accessToken: string; appSecret?: string }) => api.post<{ number: string; name: string | null }>('/whatsapp/meta-connection', input),
    onSuccess: refresh,
  });
  return { switchTo, saveMeta };
}
