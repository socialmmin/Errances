'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface DailyReportSettings {
  phoneNumbers: string[];
  sendHour: number;
  sendMinute: number;
  enabled: boolean;
  templateId: string | null;
  templateName: string | null;
  templateStatus: string | null;
  templateRejectionReason: string | null;
  lastSentDate: string | null;
}

export interface DailyReportPreview {
  numbers: Record<string, number | null>;
  text: string;
}

export function useDailyReportSettings() {
  return useQuery({ queryKey: ['daily-report', 'settings'], queryFn: () => api.get<DailyReportSettings>('/reporting/daily-report/settings') });
}

export function useDailyReportPreview() {
  return useQuery({ queryKey: ['daily-report', 'preview'], queryFn: () => api.get<DailyReportPreview>('/reporting/daily-report/preview'), refetchInterval: 60000 });
}

export function useSaveDailyReportSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: { phoneNumbers: string[]; sendHour: number; sendMinute: number; enabled: boolean }) => api.post<DailyReportSettings>('/reporting/daily-report/settings', dto),
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
  return useMutation({
    mutationFn: () => api.post<{ sent: number; failed: string[] }>('/reporting/daily-report/send-now', {}),
  });
}
