'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface LearningStatus {
  connection: { connected: boolean; reason?: string; datasetName?: string; lastFiredTime?: string | null; checkedAt?: string };
  mode: 'off' | 'test' | 'live';
  leadClassification: { GOOD: number; NEUTRAL: number; BAD: number };
  eventsSentTotal: number;
  eventsByType: Record<string, number>;
  metaConfirmed: { available: boolean; reason?: string; totals: Record<string, number>; days?: number };
  readiness: { event: string; sentByCrm: number; confirmedByMeta: number; readyToOptimize: boolean }[];
  stage: 'not_connected' | 'off' | 'connected_no_events' | 'sent_unconfirmed' | 'meta_receiving';
}

// Refetches every 25s and always hits Meta live server-side -- this is never a cached "connected" flag.
export function useMetaLearning() {
  return useQuery({ queryKey: ['meta', 'learning'], queryFn: () => api.get<LearningStatus>('/integrations/meta/learning'), refetchInterval: 25000 });
}
