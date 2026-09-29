'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import {
  RevenuePoint, ConversionBySource, LostReason, DestinationReport,
  OutstandingBooking, SalesPerformance, ExecutiveDetail,
} from '@/types/report';

export function useRevenueReport(from?: string, to?: string) {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const query = qs.toString();
  return useQuery({
    queryKey: ['reports', 'revenue', from, to],
    queryFn: () => api.get<RevenuePoint[]>(`/reports/revenue${query ? `?${query}` : ''}`),
  });
}

export function useConversionReport() {
  return useQuery({
    queryKey: ['reports', 'conversion'],
    queryFn: () => api.get<ConversionBySource[]>('/reports/conversion'),
  });
}

export function useLostReasonsReport() {
  return useQuery({
    queryKey: ['reports', 'lost-reasons'],
    queryFn: () => api.get<LostReason[]>('/reports/lost-reasons'),
  });
}

export function useDestinationsReport() {
  return useQuery({
    queryKey: ['reports', 'destinations'],
    queryFn: () => api.get<DestinationReport[]>('/reports/destinations'),
  });
}

export function useOutstandingReport() {
  return useQuery({
    queryKey: ['reports', 'outstanding'],
    queryFn: () => api.get<OutstandingBooking[]>('/reports/outstanding'),
  });
}

export function useSalesPerformanceReport() {
  return useQuery({
    queryKey: ['reports', 'sales-performance'],
    queryFn: () => api.get<SalesPerformance[]>('/reports/sales-performance'),
  });
}

export function useExecutiveReport(userId: string | undefined) {
  return useQuery({
    queryKey: ['reports', 'executive', userId],
    queryFn: () => api.get<ExecutiveDetail>(`/reports/executive/${userId}`),
    enabled: !!userId,
  });
}
