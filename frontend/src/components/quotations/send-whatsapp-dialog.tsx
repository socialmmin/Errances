'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, MessageCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://errances.socialmm.in';

const tripDay = (v?: string | null) => { if (!v) return ''; const d = new Date(v); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); };
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// The standard message: where, when, how many travellers, and the total -- then the link.
export function quotationMessage(q: { customerName?: string | null; quotationNumber?: string | null; destination?: string | null; travelFrom?: string | null; travelTo?: string | null; adults?: number | null; children?: number | null; infants?: number | null; total: number; token?: string | null }) {
  const amount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(q.total || 0);
  const from = tripDay(q.travelFrom), to = tripDay(q.travelTo);
  const a = Number(q.adults) || 0, c = Number(q.children) || 0, i = Number(q.infants) || 0;
  const travellers = [a ? count(a, 'Adult', 'Adults') : '', c ? count(c, 'Child', 'Children') : '', i ? count(i, 'Infant', 'Infants') : ''].filter(Boolean).join(', ');
  const lines = [
    q.destination ? `*Destination:* ${q.destination}` : '',
    from ? `*Travel dates:* ${from}${to ? ` to ${to}` : ''}` : '',
    travellers ? `*Travellers:* ${travellers}` : '',
    `*Total amount:* ${amount}`,
  ].filter(Boolean).join('\n');
  return `Dear ${q.customerName?.trim() || 'Traveller'},\n\nYour quotation${q.quotationNumber ? ` *${q.quotationNumber}*` : ''} is ready.\n\n${lines}\n\nView the full details here:\n${APP_URL}/q/${q.token ?? ''}\n\nErrances Voyages`;
}

// WhatsApp's own formatting, so the preview reads the way the customer will see it.
function Preview({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*|https?:\/\/\S+)/g);
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-snug text-slate-900">
      {parts.map((p, i) => /^\*[^*\n]+\*$/.test(p) ? <b key={i}>{p.slice(1, -1)}</b> : /^https?:\/\//.test(p) ? <span key={i} className="text-sky-700 underline">{p}</span> : <span key={i}>{p}</span>)}
    </p>
  );
}

// Nothing goes out until staff have seen the message, edited it if they want, and picked how
// to send it: from the CRM's own WhatsApp number, or from WhatsApp Web on their own number.
export function SendWhatsAppDialog({ quotationId, phone, customerName, defaultText, onClose, onSent, title = 'Send quotation on WhatsApp', what = 'Quotation' }: {
  title?: string; what?: string;
  quotationId: string; phone: string; customerName?: string | null; defaultText: string; onClose: () => void; onSent?: () => void;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [text, setText] = useState(defaultText);
  const [sending, setSending] = useState(false);
  const digits = phone.replace(/\D/g, '');
  const waNumber = digits.length === 10 ? `91${digits}` : digits;

  // Sends the message from the CRM's WhatsApp number, then opens this customer's chat in the
  // WhatsApp Inbox so the sent message (and any reply) is right there.
  async function sendFromCrm() {
    if (!text.trim()) { toast('The message is empty', 'error'); return; }
    setSending(true);
    try {
      const q = await api.get<{ lead_id: string | null; status: string }>(`/quotations/${quotationId}`);
      if (q.lead_id) {
        await api.post('/integrations/whatsapp/messages/send', { leadId: q.lead_id, text: text.trim() });
        if (q.status === 'draft') await api.patch('/quotations/' + quotationId + '/status', { status: 'sent' }).catch(() => undefined);
        toast(what + ' sent on WhatsApp to ' + phone, 'success');
        onClose();
        router.push(`/whatsapp?lead=${q.lead_id}`);
        return;
      }
      // no lead behind this quotation, so there is no chat to open: send it straight away
      // The customer gets exactly what the preview shows. An untouched message may go as the
      // Meta-approved template instead once there is one (that reaches the customer any time).
      await api.post(`/quotations/${quotationId}/send-whatsapp`, { text, edited: text.trim() !== defaultText.trim() });
      toast(`Quotation sent on WhatsApp to ${phone}`, 'success');
      onSent?.(); onClose();
    } catch (e: any) { toast(e.message || 'Could not send on WhatsApp', 'error'); }
    finally { setSending(false); }
  }
  function openWhatsAppWeb() {
    if (!text.trim()) { toast('The message is empty', 'error'); return; }
    window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
    onSent?.(); onClose();
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-navy">{title}</h3>
            <p className="text-xs text-slate-500">To {customerName || 'customer'} · {phone}. Check the message, edit it if needed, then choose where to send it from.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Message (you can edit)</p>
            <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} className="border-navy/30 text-sm" />
            <button type="button" className="text-xs font-semibold text-sky-700 hover:underline" onClick={() => setText(defaultText)}>Reset to the standard message</button>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preview — what the customer sees</p>
            <div className="min-h-[16rem] rounded-xl bg-[#efe7dd] p-3">
              <div className="ml-auto w-fit max-w-[92%] rounded-lg rounded-tr-none bg-[#d9fdd3] px-3 py-2 shadow-sm"><Preview text={text || ' '} /></div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="outline" className="border-emerald-600 text-emerald-700" onClick={openWhatsAppWeb}><ExternalLink className="mr-1.5 h-4 w-4" />Open in WhatsApp Web</Button>
          <Button type="button" className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={sending} onClick={sendFromCrm}><MessageCircle className="mr-1.5 h-4 w-4" />{sending ? 'Sending…' : 'Send & open CRM Inbox'}</Button>
        </div>
      </div>
    </div>
  );
}
