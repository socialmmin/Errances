'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Eye, RefreshCw, Send, X } from 'lucide-react';
import { TemplatePreview } from '@/components/finance/template-preview';
import { useToast } from '@/components/ui/toast';
import { useFinanceTemplates, useSubmitFinanceTemplate, useSyncFinanceTemplate } from '@/hooks/use-finance';

// The message "Send template to re-open" sends. Until Meta approves the new wording the old welcome
// message (with its "Yes, send itinerary" button) is still what goes out; this shows which one is
// in use and lets the owner preview and submit the new one.
export function ReopenTemplate() {
  const { toast } = useToast();
  const { data: templates } = useFinanceTemplates();
  const submit = useSubmitFinanceTemplate();
  const sync = useSyncFinanceTemplate();
  const [open, setOpen] = useState(false);
  const t = (templates as any)?.chat_reopen;
  if (!t) return null;
  const status: string | null = t.templateStatus;
  const approved = status === 'APPROVED';

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100">
        {approved ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Eye className="h-3.5 w-3.5" />}
        {approved ? 'New message in use' : status === 'PENDING' ? 'New message: with Meta' : 'New message: preview'}
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-navy-950/60 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-4 text-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-navy">Re-open message</h3>
                <p className="text-xs text-slate-500">Sent when you press “Send template to re-open” on a closed chat. It has no “Yes, send itinerary” button.</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
            </div>
            <TemplatePreview title="Re-open message" preview={t.preview} button={t.button} status={status} note="Sample values shown. Each customer gets their own name and destination." />
            <p className="mt-2 text-xs text-slate-600">
              {approved ? 'Approved. This is the message customers now receive.'
                : status === 'PENDING' ? 'Meta is reviewing it. Until it is approved, the old welcome message is still sent.'
                : status === 'REJECTED' ? `Meta rejected it${t.templateRejectionReason ? ` (${t.templateRejectionReason})` : ''}. The old welcome message is still sent.`
                : 'Not submitted yet. Until Meta approves it, the old welcome message is still sent.'}
            </p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Close</button>
              {status === 'PENDING' && (
                <button type="button" disabled={sync.isPending} onClick={() => sync.mutate('chat_reopen', { onSuccess: () => toast('Checked with Meta', 'success'), onError: (e: any) => toast(e.message || 'Could not check', 'error') })} className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                  <RefreshCw className="h-3.5 w-3.5" />{sync.isPending ? 'Checking…' : 'Check status'}
                </button>
              )}
              {(!status || status === 'REJECTED') && (
                <button type="button" disabled={submit.isPending} onClick={() => submit.mutate('chat_reopen', { onSuccess: () => toast('Submitted to Meta for approval', 'success'), onError: (e: any) => toast(e.message || 'Could not submit', 'error') })} className="inline-flex items-center gap-1.5 rounded-lg bg-gold px-3 py-2 text-xs font-bold text-navy-950 disabled:opacity-50">
                  <Send className="h-3.5 w-3.5" />{submit.isPending ? 'Submitting…' : 'Submit to Meta'}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
