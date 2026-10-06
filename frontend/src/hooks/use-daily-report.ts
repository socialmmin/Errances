'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface DailyReportSettings {
  phoneNumbers: string[];
  sendTimes: string[];
  enabled: boolean;
  includedSections: string[];
  templateId: string | null;
  templateName: string | null;
  templateStatus: string | null;
  templateRejectionReason: string | null;
  lastSentDate: string | null;
}

export interface DailyReportPreview {
  numbers: Record<string, number | null>;
  text: string;
  // exactly what the recipient's phone shows: the approved template with the numbers filled in
  message: string;
  includedSections: string[];
}

export interface DailyReportDelivery {
  phone: string; sends: number; delivered: number; read: number; failed: number;
  lastAt: string | null; lastStatus: string | null; lastError: string | null; lastTrigger: string | null;
}

export function useDailyReportSettings() {
  return useQuery({ queryKey: ['daily-report', 'settings'], queryFn: () => api.get<DailyReportSettings>('/reporting/daily-report/settings') });
}

// `sections` previews unsaved section choices; omitted, it uses the saved ones.
export function useDailyReportPreview(sections?: string[]) {
  const qs = sections ? `?sections=${encodeURIComponent(sections.join(','))}` : '';
  return useQuery({ queryKey: ['daily-report', 'preview', qs], queryFn: () => api.get<DailyReportPreview>(`/reporting/daily-report/preview${qs}`), refetchInterval: 60000, placeholderData: (prev) => prev });
}

export function useDailyReportDeliveries() {
  return useQuery({ queryKey: ['daily-report', 'deliveries'], queryFn: () => api.get<{ data: DailyReportDelivery[] }>('/reporting/daily-report/deliveries'), refetchInterval: 30000 });
}

export function useSendDailyReportTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (phone: string) => api.post<{ sent: number; failed: string[] }>('/reporting/daily-report/send-test', { phone }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['daily-report', 'deliveries'] }),
  });
}

export function useSaveDailyReportSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: { phoneNumbers: string[]; sendTimes: string[]; enabled: boolean; includedSections: string[] }) => api.post<DailyReportSettings>('/reporting/daily-report/settings', dto),
    onSuccess: (data) => qc.setQueryData(['daily-report', 'settings'], data),
  });
}

export function useSubmitDailyReportTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<DailyReportSettings>('/reporting/daily-report/submit-template', {}),
    onSuccess: (data) => qc.setQueryData(['daily-report', 'settings'], data),
  });
}

export function useSyncDailyReportTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<DailyReportSettings>('/reporting/daily-report/sync-template', {}),
    onSuccess: (data) => qc.setQueryData(['daily-report', 'settings'], data),
  });
}

export function useSendDailyReportNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ sent: number; failed: string[] }>('/reporting/daily-report/send-now', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['daily-report', 'deliveries'] }),
  });
}
