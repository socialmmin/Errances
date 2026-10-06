'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Invoice, Payment, OverdueInstallment, PtaCollection, FinanceKpis } from '@/types/finance';

interface ListResponse<T> {
  data: T[];
  total: number;
}

export interface PaymentReminderRow {
  invoice_id: string; invoice_number: string; invoice_date: string; total_amount: number; paid_amount: number; last_paid_at: string | null;
  quotation_id: string | null; quotation_number: string | null; lead_id: string | null; destination: string | null; customer_name: string | null; customer_phone: string | null;
  reminder_id: string | null; send_at: string | null; reminder_by: string | null;
  last_status: string | null; last_sent_at: string | null; last_send_at: string | null; last_error: string | null;
}
// Every invoice with a balance and its reminder; shared by the Payment Reminders page and the sidebar count.
export function usePaymentReminders(options: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: ['finance', 'payment-reminders'], queryFn: () => api.get<{ data: PaymentReminderRow[] }>('/finance/payment-reminders'), enabled: options.enabled ?? true, refetchInterval: 60_000 });
}

export function useInvoices(params: { status?: string; type?: string } = {}, options: { enabled?: boolean } = {}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.type) qs.set('type', params.type);
  const query = qs.toString();
  return useQuery({
    queryKey: ['finance', 'invoices', params],
    queryFn: () => api.get<ListResponse<Invoice>>(`/finance/invoices${query ? `?${query}` : ''}`),
    enabled: options.enabled ?? true,
  });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { bookingId: string; type?: string; dueDate?: string }) =>
      api.post<Invoice>('/finance/invoices', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finance', 'invoices'] }),
  });
}

export function useDeleteInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/finance/invoices/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finance', 'invoices'] }),
  });
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: ['finance', 'invoices', id],
    queryFn: () => api.get<Invoice>(`/finance/invoices/${id}`),
    enabled: !!id,
  });
}

export function useRecordPayment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { amount: number; method: string; reference?: string }) =>
      api.post<Invoice>(`/finance/invoices/${id}/payments`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance', 'invoices'] });
      qc.invalidateQueries({ queryKey: ['finance', 'invoices', id] });
    },
  });
}

// Both payment templates (confirmation + reminder) for the Invoices hero.
export type FinanceTemplateKind = 'payment_receipt' | 'payment_reminder' | 'chat_reopen';
export function useFinanceTemplates() {
  return useQuery({ queryKey: ['finance', 'templates'], queryFn: () => api.get<Record<FinanceTemplateKind, ReminderTemplate>>('/finance/templates'), refetchInterval: 60000 });
}
export function useSubmitFinanceTemplate() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (kind: FinanceTemplateKind) => api.post<ReminderTemplate>(`/finance/templates/${kind}/submit`, {}), onSuccess: () => { qc.invalidateQueries({ queryKey: ['finance', 'templates'] }); qc.invalidateQueries({ queryKey: ['finance', 'reminder-template'] }); } });
}
export function useSyncFinanceTemplate() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (kind: FinanceTemplateKind) => api.post<ReminderTemplate>(`/finance/templates/${kind}/sync`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['finance', 'templates'] }) });
}

export interface ReminderTemplate { templateId: string | null; templateName: string | null; templateStatus: string | null; templateRejectionReason: string | null }
export function useReminderTemplate() {
  return useQuery({ queryKey: ['finance', 'reminder-template'], queryFn: () => api.get<ReminderTemplate>('/finance/reminder-template'), refetchInterval: 60000 });
}
export function useSubmitReminderTemplate() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.post<ReminderTemplate>('/finance/reminder-template/submit', {}), onSuccess: (d) => qc.setQueryData(['finance', 'reminder-template'], d) });
}
export function useSyncReminderTemplate() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.post<ReminderTemplate>('/finance/reminder-template/sync', {}), onSuccess: (d) => qc.setQueryData(['finance', 'reminder-template'], d) });
}

export function useSendInvoiceReminder(id: string) {
  return useMutation({
    mutationFn: () => api.post<{ success: boolean; sentTo: string }>(`/finance/invoices/${id}/remind`, {}),
  });
}

export function useFinanceKpis() {
  return useQuery({
    queryKey: ['finance', 'kpis'],
    queryFn: () => api.get<FinanceKpis>('/finance/kpis'),
  });
}

export function usePayments(params: { status?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  const query = qs.toString();
  return useQuery({
    queryKey: ['finance', 'payments', params],
    queryFn: () => api.get<ListResponse<Payment>>(`/finance/payments${query ? `?${query}` : ''}`),
  });
}

export function useOverdueInstallments() {
  return useQuery({
    queryKey: ['finance', 'installments', 'overdue'],
    queryFn: () => api.get<OverdueInstallment[]>('/finance/installments/overdue'),
  });
}

export function useTodayPtaCollections() {
  return useQuery({
    queryKey: ['finance', 'pta-collections', 'today'],
    queryFn: () => api.get<PtaCollection[]>('/finance/pta-collections/today'),
  });
}

export function useVerifyPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.patch<Payment>(`/finance/payments/${id}/verify`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance'] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}

export function useRejectPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.patch<Payment>(`/finance/payments/${id}/reject`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finance'] }),
  });
}
