'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CheckCheck, ExternalLink, FileText, Phone, Reply } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
import { renderPdfFirstPage } from '@/lib/pdf-thumb';
import { fetchPackageDocumentBytes } from '@/hooks/use-packages';
import { savePackageThumbnail, usePackageThumbnail, WhatsAppChatMessage } from '@/hooks/use-whatsapp';

// Packages whose cover picture we already tried to create this session (once each).
const thumbTried = new Set<string>();

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// The chat bubble for an image or PDF/document the agent sent from their own device.
// Chat photos/files live in private storage: fetch them through the API (signed in) and show a
// local copy. Falls back to the saved address for anything that's already public.
function useMessageMediaUrl(msg: WhatsAppChatMessage) {
  const has = !!msg.meta?.url;
  const { data } = useQuery({
    queryKey: ['message-media', msg.id],
    enabled: has,
    staleTime: Infinity,
    queryFn: async () => {
      const token = useAuthStore.getState().accessToken;
      const res = await fetch(`${API_URL}/integrations/whatsapp/messages/${msg.id}/media`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (!res.ok) throw new Error('media');
      return URL.createObjectURL(await res.blob());
    },
  });
  return data || '';
}

export function MediaBubble({ msg }: { msg: WhatsAppChatMessage }) {
  const meta = { ...(msg.meta || {}) };
  const local = useMessageMediaUrl(msg);
  if (local) meta.url = local;
  const isImage = String(meta.mimeType || '').startsWith('image/');
  return (
    <div className={`max-w-[80%] overflow-hidden rounded-lg shadow-sm ${msg.direction === 'in' ? 'rounded-tl-none bg-white text-slate-800' : 'ml-auto rounded-tr-none bg-[#d9fdd3] text-slate-800'}`}>
      {msg.msg_type === 'audio' && meta.url ? <audio controls src={meta.url} className="m-2 max-w-full" />
      : msg.msg_type === 'video' && meta.url ? <video controls src={meta.url} className="max-h-64 w-full" />
      : isImage && meta.url ? (
        <a href={meta.url} target="_blank" rel="noreferrer"><img src={meta.url} alt={meta.filename || 'Image'} className="max-h-64 w-full object-cover" /></a>
      ) : (
        <a href={meta.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-3 hover:bg-black/5"><FileText className="h-8 w-8 shrink-0 text-red-500" /><span className="truncate text-sm font-medium underline">{meta.filename || 'Document'}</span></a>
      )}
      {msg.body && msg.body !== meta.filename && <p className="whitespace-pre-wrap px-2 pt-1 text-sm leading-snug">{msg.body}</p>}
      <p className={`flex items-center justify-end gap-1 px-2 pb-1 pt-0.5 text-[10px] ${msg.direction === 'in' ? 'text-slate-400' : 'text-slate-500'}`}>{new Date(msg.created_at).toLocaleString('en-IN')}{msg.direction === 'out' && (meta.status === 'failed' ? <AlertTriangle className="h-3 w-3 shrink-0 text-red-500" /> : meta.status === 'read' ? <CheckCheck className="h-3.5 w-3.5 shrink-0 text-sky-500" /> : meta.status === 'delivered' ? <CheckCheck className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : <Check className="h-3.5 w-3.5 shrink-0 text-slate-400" />)}</p>
      {msg.direction === 'out' && meta.status === 'failed' && <p className="mx-2 mb-1.5 rounded bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700">{failureText(meta.error)}</p>}
    </div>
  );
}

// The itinerary message exactly as the customer sees it in WhatsApp.
// Plain-language reason for a failed send, shown right on the message.
export function failureText(raw?: string | null) {
  const t = (raw || '').toLowerCase();
  if (t.includes('never confirmed delivery')) return "Unconfirmed: Meta accepted this but never told us whether it arrived — we genuinely don't know";
  if (t.includes('undeliverable') || t.includes('not a whatsapp')) return 'Not delivered: this number is not reachable on WhatsApp';
  if (t.includes('healthy ecosystem')) return 'Not delivered: WhatsApp blocked it (its sending-pace limit for this customer)';
  if (t.includes('payment method') || t.includes('currency')) return 'Not delivered: our WhatsApp billing setup (now fixed, resend it)';
  if (t.includes('experiment')) return 'Not delivered: WhatsApp is testing something on this number';
  return raw ? 'Not delivered: ' + raw : 'Not delivered';
}

export function ItineraryBubble({ msg, status, error }: { msg: WhatsAppChatMessage; status?: string; error?: string | null }) {
  const meta = msg.meta || {};
  // WhatsApp shows a long template body folded: greeting + first line, then "Read more".
  const [expanded, setExpanded] = useState(false);
  const { data: thumb, isFetched: thumbFetched } = usePackageThumbnail(meta.packageId);
  const queryClient = useQueryClient();
  const { data: facts } = useQuery({ queryKey: ['pdf-facts', meta.packageId], enabled: !!meta.packageId, staleTime: 30 * 60 * 1000, queryFn: () => api.get<{ url?: string; bytes: number | null; pages: number | null }>(`/integrations/whatsapp/packages/${meta.packageId}/document-url`) });
  // A picture itinerary (PNG/JPG) shows the picture itself, as on the phone -- not a PDF card.
  const isImageItin = /\.(jpe?g|png|webp)$/i.test(String(meta.fileName || ''));
  // The cover picture only existed if someone had opened that package's edit page and
  // saved it, so several itineraries showed a blank document icon here while WhatsApp
  // shows the real first page. Build it now from the PDF, once, and keep it.
  useEffect(() => {
    const id: string | undefined = meta.packageId;
    if (!id || isImageItin || !thumbFetched || thumb?.dataUrl || thumbTried.has(id)) return;
    thumbTried.add(id);
    (async () => {
      const { objectKey } = await api.get<{ url: string; objectKey: string }>(`/integrations/whatsapp/packages/${id}/document-url`);
      const { img } = await renderPdfFirstPage(await fetchPackageDocumentBytes(objectKey));
      await savePackageThumbnail(id, img);
      queryClient.invalidateQueries({ queryKey: ['package-thumbnail', id] });
    })().catch(() => undefined);
  }, [meta.packageId, thumbFetched, thumb?.dataUrl, queryClient, isImageItin]);
  // Open the tab first (synchronously, so the popup blocker allows it), then point
  // it at the short-lived link once we have it.
  async function openPdf() {
    if (!meta.packageId) return;
    const tab = window.open('', '_blank');
    try {
      const { url } = await api.get<{ url: string }>(`/integrations/whatsapp/packages/${meta.packageId}/document-url`);
      if (tab) tab.location.href = url; else window.location.href = url;
    } catch { tab?.close(); }
  }
  return (
    <div className="ml-auto w-[min(22rem,92%)] overflow-hidden rounded-lg rounded-tr-none bg-[#d9fdd3] text-slate-800 shadow-sm">
      <div className="p-1">
        <div role="button" tabIndex={0} title="Open the PDF" className="cursor-pointer overflow-hidden rounded-md bg-white/70 transition hover:brightness-95" onClick={openPdf} onKeyDown={(e) => { if (e.key === 'Enter') openPdf(); }}>
          {isImageItin && facts?.url ? <img src={facts.url} alt="Itinerary" className="max-h-48 w-full object-cover object-top" /> : thumb?.dataUrl ? <img src={thumb.dataUrl} alt="Itinerary first page" className="max-h-32 w-full object-cover object-top" /> : <div className="grid h-20 place-items-center bg-slate-100"><FileText className="h-7 w-7 text-slate-400" /></div>}
          {!isImageItin && <div className="flex items-center gap-2.5 px-3 py-2"><span className="grid h-8 w-7 shrink-0 place-items-center rounded bg-red-500 text-[8px] font-bold text-white">PDF</span><div className="min-w-0"><p className="truncate text-xs font-semibold">{meta.fileName || 'Itinerary.pdf'}</p><p className="text-[10px] text-slate-500">{facts?.pages ? `${facts.pages} page${facts.pages === 1 ? '' : 's'} · ` : ''}PDF{facts?.bytes ? ` · ${fmtBytes(facts.bytes)}` : ' document'}</p></div></div>}
        </div>
      </div>
      <div className="px-2 pb-1 pt-1.5 text-[13px] leading-snug">
        {meta.greeting && <p className="mb-1">{meta.greeting}</p>}
        {expanded ? <>
          {(meta.paragraphs || []).map((p: string, i: number) => <p key={i} className="mb-1">{p}</p>)}
          {meta.tail && <p>{meta.tail}</p>}
        </> : <>
          {(meta.paragraphs || [])[0] && <p className="truncate">{(meta.paragraphs || [])[0]}</p>}
          {((meta.paragraphs || []).length > 1 || meta.tail) && <button type="button" onClick={() => setExpanded(true)} className="mt-0.5 font-semibold text-[#008069] hover:underline">Read more</button>}
        </>}
        <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-slate-500">{new Date(msg.created_at).toLocaleString('en-IN')}{status === 'failed' || status === 'unconfirmed' ? <AlertTriangle className={`h-3 w-3 shrink-0 ${status === 'unconfirmed' ? 'text-orange-500' : 'text-red-500'}`} /> : status === 'read' ? <CheckCheck className="h-3.5 w-3.5 shrink-0 text-sky-500" /> : status === 'delivered' ? <CheckCheck className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : <Check className="h-3.5 w-3.5 shrink-0 text-slate-400" />}</p>
        {(status === 'failed' || status === 'unconfirmed') && <p className={`mt-1 rounded px-2 py-1 text-[11px] font-semibold ${status === 'unconfirmed' ? 'bg-orange-50 text-orange-700' : 'bg-red-50 text-red-700'}`}>{failureText(error)}</p>}
      </div>
      {(meta.buttons || []).map((b: { text: string; type?: string }, i: number) => <div key={i} className="flex items-center justify-center gap-1.5 border-t border-black/10 py-1.5 text-[13px] font-semibold text-[#0a7cff]">{b.type === 'PHONE_NUMBER' ? <Phone className="h-3.5 w-3.5" /> : b.type === 'QUICK_REPLY' ? <Reply className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}{b.text}</div>)}
    </div>
  );
}

