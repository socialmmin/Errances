'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import {
  AlertTriangle, ArrowDown, Check, CheckCheck, Clock3, Copy, ExternalLink, FileText, List, Paperclip, Phone, Reply, Search, Send, Smartphone, Smile, Star, X, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Lead } from '@/types/lead';
import { useToast } from '@/components/ui/toast';
import { useAuthStore } from '@/store/auth-store';
import {
  WhatsAppChatMessage, useCreateQuickReply, useDeleteQuickReply, useInboxState, useLeadMessages, useQuickReplies, useReopenChat,
  useSendAgentMedia, useSendAgentMessage, useSetChatStatus, useToggleStar, useWhatsAppConfig, useWhatsAppLogs, useWhatsAppTemplates, ChatStatus,
} from '@/hooks/use-whatsapp';
import { ItineraryBubble, MediaBubble, failureText } from './bubbles';
import { ReopenTemplate } from './reopen-template';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const EMOJIS = ['😀', '😁', '😂', '🙂', '😉', '😊', '😍', '🥰', '😘', '🤗', '🤝', '🙏', '👍', '👌', '👏', '🙌', '💪', '🔥', '✨', '🎉', '❤️', '💐', '🌟', '✅', '❌', '⚠️', '📌', '📞', '📱', '📩', '📄', '📎', '🕐', '📅', '✈️', '🏨', '🚗', '🚆', '🏖️', '🏔️', '🌴', '🗺️', '🧳', '🎒', '☀️', '🌧️', '🍽️', '💰', '🎁', '😅', '🤔', '😢', '😊', '👋', '🫶', '💯', '🙏🏻'];

type ThreadItem =
  | { kind: 'sep'; key: string; label: string }
  | { kind: 'msg'; key: string; at: number; msg: WhatsAppChatMessage }
  | { kind: 'log'; key: string; at: number; log: any };

function dayLabel(at: number) {
  const d = new Date(at);
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (d.toDateString() === new Date().toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

function Ticks({ status }: { status?: string }) {
  if (status === 'failed') return <AlertTriangle className="h-3 w-3 shrink-0 text-red-500" />;
  if (status === 'unconfirmed') return <AlertTriangle className="h-3 w-3 shrink-0 text-orange-500" />;
  if (status === 'read') return <CheckCheck className="h-3.5 w-3.5 shrink-0 text-sky-500" />;
  if (status === 'delivered') return <CheckCheck className="h-3.5 w-3.5 shrink-0 text-slate-400" />;
  return <Check className="h-3.5 w-3.5 shrink-0 text-slate-400" />;
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const q = query.trim().toLowerCase();
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return <>{parts.map((p, i) => (p.toLowerCase() === q ? <mark key={i} className="rounded bg-yellow-200 px-0.5">{p}</mark> : <span key={i}>{p}</span>))}</>;
}

function TextBubble({ msg, query, onRetry }: { msg: WhatsAppChatMessage; query: string; onRetry: (text: string) => void }) {
  const out = msg.direction === 'out';
  const meta = msg.meta || {};
  return (
    <div className={cn('px-2 py-1.5 text-sm shadow-sm', (meta.buttons?.length || meta.list) ? 'w-[min(24rem,85%)]' : 'w-fit max-w-[65%]', out ? 'ml-auto rounded-lg rounded-tr-none bg-[#d9fdd3] text-slate-800' : 'rounded-lg rounded-tl-none bg-white text-slate-800')}>
      {out && msg.sent_by_name && <p className="text-[11px] font-bold leading-tight text-emerald-700">{msg.sent_by_name}</p>}
      {meta.replyTo && <div className="mb-1 rounded border-l-4 border-pink-500 bg-black/5 px-2 py-1 text-xs"><p className="font-semibold text-pink-600">{meta.replyTo.from === 'customer' ? (out ? 'Customer' : 'You') : 'Errances Voyages'}</p><p className="line-clamp-2 whitespace-pre-line text-slate-600">{meta.replyTo.media ? '📷 ' : ''}{meta.replyTo.body}</p></div>}
      <p className="whitespace-pre-wrap break-words leading-snug"><Highlight text={msg.body} query={query} />
        <span className="float-right ml-2 mt-1 flex items-center gap-1 pl-1 text-[10px] text-slate-500">
          {meta.starred && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
          {new Date(msg.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
          {out && <Ticks status={meta.status} />}
        </span>
      </p>
      {meta.footer && <p className="mt-0.5 text-[11px] text-slate-500">{meta.footer}</p>}
      {meta.echo && <p className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500"><Smartphone className="h-3 w-3" />Sent from the WhatsApp phone app</p>}
      {/* Buttons and list exactly as WhatsApp shows them under the message. */}
      {(meta.buttons || []).length > 0 && <div className="-mx-2 -mb-1.5 mt-1.5">{meta.buttons.map((b: { type?: string; text: string }, i: number) => (
        <div key={i} className="flex items-center justify-center gap-1.5 border-t border-black/10 py-1.5 text-[13px] font-semibold text-[#0a7cff]">
          {b.type === 'PHONE_NUMBER' ? <Phone className="h-3.5 w-3.5" /> : b.type === 'URL' ? <ExternalLink className="h-3.5 w-3.5" /> : <Reply className="h-3.5 w-3.5" />}{b.text}
        </div>))}</div>}
      {meta.list && <div className="-mx-2 -mb-1.5 mt-1.5 border-t border-black/10 py-1.5 text-center text-[13px] font-semibold text-[#0a7cff]" title={(meta.list.rows || []).join('\n')}>
        <span className="inline-flex items-center gap-1.5"><List className="h-3.5 w-3.5" />{meta.list.button}</span>
        {(meta.list.rows || []).length > 0 && <p className="mt-0.5 px-2 text-[10px] font-normal text-slate-500">{meta.list.rows.join(' · ')}</p>}
      </div>}
      {out && (meta.status === 'failed' || meta.status === 'unconfirmed') && (
        <div className={`mt-1 rounded px-2 py-1 text-[11px] ${meta.status === 'unconfirmed' ? 'bg-orange-50 text-orange-700' : 'bg-red-50 text-red-700'}`}>
          <p className="font-semibold">{failureText(meta.error)}</p>
          <button type="button" onClick={() => onRetry(msg.body)} className="mt-0.5 font-bold underline">Retry</button>
        </div>
      )}
    </div>
  );
}

export function ChatPane({ lead, leading, trailing }: { lead: Lead; leading?: React.ReactNode; trailing?: React.ReactNode }) {
  const { toast } = useToast();
  const accessToken = useAuthStore((s) => s.accessToken);
  const { data: messages } = useLeadMessages(lead.id);
  const { data: logData } = useWhatsAppLogs();
  const { data: config } = useWhatsAppConfig();
  const { data: templateData } = useWhatsAppTemplates();
  const { data: stateMap } = useInboxState();
  const { data: quick } = useQuickReplies();
  const sendAgent = useSendAgentMessage();
  const sendMedia = useSendAgentMedia();
  const setStatus = useSetChatStatus();
  const reopen = useReopenChat();
  const star = useToggleStar(lead.id);
  const addQuick = useCreateQuickReply();
  const delQuick = useDeleteQuickReply();

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<null | { waId: string; body: string; from: 'customer' | 'us' }>(null);
  // A quotation message handed over from the Quotations page waits in the typing box.
  const quotationDraft = useRef<null | { quotationId: string; markSent: boolean }>(null);
  useEffect(() => {
    quotationDraft.current = null;
    setText('');
    try {
      const raw = sessionStorage.getItem('wa-draft');
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d?.leadId !== lead.id) return;
      sessionStorage.removeItem('wa-draft');
      setText(String(d.text || ''));
      quotationDraft.current = d.quotationId ? { quotationId: d.quotationId, markSent: !!d.markSent } : null;
    } catch { /* storage blocked */ }
  }, [lead.id]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [panel, setPanel] = useState<null | 'emoji' | 'quick'>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [newBelow, setNewBelow] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastLead = useRef<string | null>(null);
  const lastCount = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!panel) return;
    const close = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) setPanel(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [panel]);
  useEffect(() => { setReplyTo(null); setQuery(''); setSearching(false); }, [lead.id]);

  const phoneTail = (lead.whatsapp_number || lead.phone || '').replace(/\D/g, '').slice(-10);
  const logs = useMemo(() => (logData?.data ?? []).filter((log) => phoneTail && log.to_number.replace(/\D/g, '').endsWith(phoneTail)), [logData?.data, phoneTail]);
  const statusByWaId = useMemo(() => Object.fromEntries((logData?.data ?? []).filter((l) => l.message_id).map((l) => [l.message_id as string, l.status])), [logData?.data]);
  const errorByWaId = useMemo(() => Object.fromEntries((logData?.data ?? []).filter((l) => l.message_id && l.error_message).map((l) => [l.message_id as string, l.error_message as string])), [logData?.data]);

  const items = useMemo<ThreadItem[]>(() => {
    const shownIds = new Set((messages ?? []).map((m) => m.meta?.waId).filter(Boolean));
    const raw: Omit<Extract<ThreadItem, { at: number }>, never>[] = [
      ...logs.filter((log) => !(log.message_id && shownIds.has(log.message_id))).map((log) => ({ kind: 'log' as const, key: 'l' + log.id, at: new Date(log.sent_at || log.created_at).getTime(), log })),
      ...(messages ?? []).map((msg) => ({ kind: 'msg' as const, key: 'm' + msg.id, at: new Date(msg.created_at).getTime(), msg })),
    ] as any;
    const q = query.trim().toLowerCase();
    const filtered = q ? raw.filter((it: any) => (it.kind === 'msg' ? it.msg.body : `${it.log.package_name || ''} ${it.log.template_name || ''}`).toLowerCase().includes(q)) : raw;
    const sorted = (filtered as any[]).sort((a, b) => a.at - b.at);
    const out: ThreadItem[] = [];
    let lastDay = '';
    for (const it of sorted) {
      const day = new Date(it.at).toDateString();
      if (day !== lastDay) { out.push({ kind: 'sep', key: 's' + day, label: dayLabel(it.at) }); lastDay = day; }
      out.push(it);
    }
    return out;
  }, [logs, messages, query]);

  // Stay at the newest message; if the agent scrolled up, offer a jump button instead of yanking them down.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const count = items.length;
    if (lastLead.current !== lead.id) { el.scrollTop = el.scrollHeight; lastLead.current = lead.id; lastCount.current = count; setNewBelow(false); return; }
    if (count > lastCount.current) {
      if (atBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      else setNewBelow(true);
    }
    lastCount.current = count;
  }, [items.length, lead.id]);

  // WhatsApp only allows free typing for 24h after the customer's last message.
  const lastInbound = useMemo(() => (messages ?? []).filter((m) => m.direction === 'in').reduce((max, m) => Math.max(max, new Date(m.created_at).getTime()), 0), [messages]);
  const windowLeft = lastInbound ? lastInbound + DAY - now : 0;
  const windowOpen = windowLeft > 0;
  const state = stateMap?.[lead.id];
  const chatStatus: ChatStatus = state?.status ?? 'open';

  function fill(body: string) {
    return body.replace(/\{name\}/gi, (lead.customer_name || '').split(/\s+/)[0] || 'there').replace(/\{destination\}/gi, lead.destination || 'your destination');
  }

  async function submit() {
    const body = text.trim();
    if (!body) return;
    try {
      await sendAgent.mutateAsync({ leadId: lead.id, text: body, replyToWaId: replyTo?.waId });
      setReplyTo(null);
      setText('');
      const q = quotationDraft.current;
      quotationDraft.current = null;
      if (q) {
        if (q.markSent) await api.patch(`/quotations/${q.quotationId}/status`, { status: 'sent' }).catch(() => undefined);
        toast('Quotation sent', 'success');
      }
    } catch (error: any) { toast(error.message || 'Could not send', 'error'); }
  }

  async function retry(body: string) {
    try { await sendAgent.mutateAsync({ leadId: lead.id, text: body }); toast('Sent again', 'success'); }
    catch (error: any) { toast(error.message || 'Could not send', 'error'); }
  }

  async function uploadAndSend(file: File) {
    if (file.size > MAX_ATTACHMENT_BYTES) { toast('That file is too large (max 100MB, images max 5MB on WhatsApp)', 'error'); return; }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('folder', 'whatsapp-attachments');
      const res = await fetch(`${API_URL}/files/upload`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || 'Upload failed');
      const uploaded = await res.json();
      await sendMedia.mutateAsync({ leadId: lead.id, url: uploaded.url, filename: file.name, mimeType: file.type, caption: text.trim() || undefined });
      setText('');
    } catch (error: any) { toast(error.message || 'Could not send the attachment', 'error'); }
    finally { setUploading(false); }
  }

  function onPaste(e: React.ClipboardEvent) {
    const file = Array.from(e.clipboardData.files)[0];
    if (file && windowOpen) { e.preventDefault(); uploadAndSend(file); }
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && windowOpen) uploadAndSend(file);
  }

  const hoursLeft = Math.floor(windowLeft / 3600000);
  const minsLeft = Math.floor((windowLeft % 3600000) / 60000);
  const canType = windowOpen;

  return (
    <div className="flex min-h-0 flex-1 flex-col" onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      {/* One header row: who it is, 24h window, status, then actions and search. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-200 bg-white px-3 py-1.5 text-[11px] dark:border-white/10 dark:bg-navy-950">
        {leading}
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold', windowOpen ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')} title={windowOpen ? 'Free chat window open — no template needed' : 'Free chat window closed — a template is needed to start'}>
          <Clock3 className="h-3 w-3" />{windowOpen ? `${hoursLeft}h ${minsLeft}m left` : 'Window closed'}
        </span>
        <select value={chatStatus} onChange={(e) => setStatus.mutate({ leadId: lead.id, status: e.target.value as ChatStatus })} className="h-6 rounded-full border border-slate-200 bg-white px-1.5 font-semibold dark:border-white/10 dark:bg-navy" title="Conversation status">
          <option value="open">Open</option><option value="waiting">Waiting for customer</option><option value="done">Done</option>
        </select>
        <div className="ml-auto flex items-center gap-1">
          {trailing}
          {searching && <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search in this chat…" className="h-6 w-40 rounded-full border border-slate-200 px-2.5 text-[11px] outline-none focus:border-gold dark:border-white/10 dark:bg-navy" />}
          <button type="button" title="Search in chat" onClick={() => { setSearching((v) => !v); if (searching) setQuery(''); }} className="rounded-full p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10">{searching ? <X className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}</button>
        </div>
      </div>

      {/* thread */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; if (atBottom.current) setNewBelow(false); }}
          className="h-full overflow-y-auto bg-[#efeae2] p-4 md:p-6"
        >
          <div className="mx-auto max-w-2xl space-y-3">
            <div className="text-center"><span className="rounded-full bg-white px-3 py-1 text-[11px] text-slate-500 shadow-sm">Lead created {new Date(lead.lead_date || lead.created_at).toLocaleString('en-IN')}</span></div>
            <div className="max-w-[80%] rounded-2xl rounded-tl-sm border border-slate-200 bg-white p-4 shadow-sm"><p className="text-sm">Hello, I’m interested in <strong>{lead.destination || 'a travel package'}</strong>.</p><p className="mt-2 text-[10px] text-slate-400">{lead.source || 'Lead enquiry'}</p></div>
            {items.map((it) => {
              if (it.kind === 'sep') return <div key={it.key} className="sticky top-1 z-[1] text-center"><span className="rounded-full bg-white/95 px-3 py-1 text-[11px] font-semibold text-slate-500 shadow-sm">{it.label}</span></div>;
              if (it.kind === 'log') {
                const log = it.log;
                return (
                  <div key={it.key} className={`ml-auto max-w-[80%] rounded-lg rounded-tr-none p-3 text-sm shadow-sm ${log.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-[#d9fdd3] text-slate-800'}`}>
                    <p>{log.message_type === 'itinerary' ? `Itinerary: ${log.package_name || log.template_name || 'Document'}` : log.template_name ? `Template: ${log.template_name}` : 'WhatsApp message'}</p>
                    {log.error_message && <p className="mt-2 text-xs text-red-700">{failureText(log.error_message)}</p>}
                    <p className="mt-2 flex items-center justify-end gap-1 text-[10px] text-slate-500">{new Date(log.sent_at || log.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} · {log.status.replace(/_/g, ' ')}<Ticks status={log.status} /></p>
                  </div>
                );
              }
              const msg = it.msg;
              const out = msg.direction === 'out';
              const waId: string | undefined = msg.wa_message_id || msg.meta?.waId;
              const bubble = msg.msg_type === 'itinerary'
                ? <ItineraryBubble msg={msg} status={statusByWaId[msg.meta?.waId]} error={errorByWaId[msg.meta?.waId]} />
                : ['image', 'document', 'audio', 'video'].includes(msg.msg_type) ? <MediaBubble msg={msg} />
                : <TextBubble msg={msg} query={query} onRetry={retry} />;
              return (
                <div key={it.key} className="group relative">
                  {bubble}
                  <div className={cn('absolute -top-3 z-[2] hidden gap-0.5 rounded-full border border-slate-200 bg-white p-0.5 shadow group-hover:flex', out ? 'right-2' : 'left-2')}>
                    {waId && <button type="button" title="Reply" onClick={() => setReplyTo({ waId, body: msg.body, from: out ? 'us' : 'customer' })} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"><Reply className="h-3.5 w-3.5" /></button>}
                    <button type="button" title={msg.meta?.starred ? 'Unstar' : 'Star'} onClick={() => star.mutate(msg.id)} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"><Star className={cn('h-3.5 w-3.5', msg.meta?.starred && 'fill-amber-400 text-amber-400')} /></button>
                    {msg.body && <button type="button" title="Copy" onClick={() => { navigator.clipboard?.writeText(msg.body); toast('Copied', 'success'); }} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"><Copy className="h-3.5 w-3.5" /></button>}
                  </div>
                </div>
              );
            })}
            {!items.length && <div className="mx-auto max-w-md rounded-xl border border-dashed border-gold/40 bg-gold/5 p-4 text-center text-xs text-slate-600">{query ? 'Nothing in this chat matches your search.' : 'No CRM WhatsApp messages recorded for this lead yet.'}</div>}
          </div>
        </div>
        {newBelow && <button type="button" onClick={() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); setNewBelow(false); }} className="absolute bottom-3 right-4 z-10 inline-flex items-center gap-1 rounded-full bg-navy px-3 py-1.5 text-xs font-semibold text-white shadow-lg"><ArrowDown className="h-3.5 w-3.5" />New messages</button>}
        {dragging && windowOpen && <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center border-4 border-dashed border-gold bg-white/70 text-lg font-bold text-navy">Drop to send</div>}
      </div>

      {/* composer */}
      <footer className="relative shrink-0 border-t border-slate-200 bg-white p-2 dark:border-white/10 dark:bg-navy-950">
        {!config?.is_configured && <p className="mb-2 text-xs font-medium text-amber-600">Connect the permanent WhatsApp token in Settings before sending.</p>}
        {replyTo && (
          <div className="mb-1.5 flex items-start gap-2 rounded-lg border-l-4 border-emerald-500 bg-slate-100 px-3 py-1.5 text-xs">
            <div className="min-w-0 flex-1"><p className="font-semibold text-emerald-700">Replying to {replyTo.from === 'customer' ? 'customer' : 'yourself'}</p><p className="truncate text-slate-600">{replyTo.body}</p></div>
            <button type="button" onClick={() => setReplyTo(null)} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
          </div>
        )}

        {!canType ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="min-w-0 flex-1"><p className="font-semibold">Free chat is closed</p><p className="text-xs">{lastInbound ? 'The customer last wrote more than 24 hours ago.' : 'This customer has not messaged us yet.'} WhatsApp only allows an approved template now. Once they reply, you can type freely for 24 hours.</p></div>
            <button type="button" disabled={reopen.isPending} onClick={() => reopen.mutate(lead.id, { onSuccess: () => toast('Template sent — chat opens when they reply', 'success'), onError: (e: any) => toast(e.message || 'Could not send the template', 'error') })} className="rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{reopen.isPending ? 'Sending…' : 'Send template to re-open'}</button>
            <ReopenTemplate />
          </div>
        ) : (
          <div ref={panelRef} className="relative flex items-end gap-1.5">
            {panel === 'emoji' && <div className="absolute bottom-full left-0 z-20 mb-2 grid w-64 grid-cols-8 gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">{EMOJIS.map((e, i) => <button key={i} type="button" onClick={() => setText((t) => t + e)} className="rounded p-1 text-lg hover:bg-slate-100">{e}</button>)}</div>}
            {panel === 'quick' && (
              <div className="absolute bottom-full left-0 z-20 mb-2 w-80 max-w-[90vw] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Quick replies</p>
                <div className="max-h-56 overflow-y-auto">
                  {(quick?.data ?? []).map((q) => (
                    <div key={q.id} className="group/q flex items-start gap-1 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                      <button type="button" onClick={() => { setText(fill(q.body)); setPanel(null); }} className="min-w-0 flex-1 text-left"><p className="text-sm font-semibold text-navy">{q.title}</p><p className="line-clamp-2 text-xs text-slate-500">{q.body}</p></button>
                      <button type="button" title="Delete" onClick={() => delQuick.mutate(q.id)} className="hidden rounded p-1 text-slate-400 hover:text-red-500 group-hover/q:block"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                  {!quick?.data?.length && <p className="px-2 py-3 text-center text-xs text-slate-500">No quick replies yet. Type a message, then press “Save as quick reply”.</p>}
                </div>
                <button type="button" disabled={!text.trim()} onClick={() => { const title = window.prompt('Name this quick reply (e.g. “Vietnam price”)'); if (title?.trim()) addQuick.mutate({ title: title.trim(), body: text.trim() }, { onSuccess: () => toast('Quick reply saved', 'success') }); }} className="mt-1 w-full rounded-lg border border-dashed border-slate-300 py-1.5 text-xs font-semibold text-slate-600 hover:border-gold disabled:opacity-40">Save typed text as quick reply</button>
                <p className="mt-1 px-2 text-[10px] text-slate-400">Use {'{name}'} and {'{destination}'} — they fill in for each customer.</p>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,text/plain" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadAndSend(f); }} />
            <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className="shrink-0 rounded-full p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40" title="Attach an image or document (or paste / drag one in)">{uploading ? <span className="block h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-gold" /> : <Paperclip className="h-5 w-5" />}</button>
            <button type="button" onClick={() => setPanel(panel === 'emoji' ? null : 'emoji')} className="shrink-0 rounded-full p-2 text-slate-500 hover:bg-slate-100" title="Emoji"><Smile className="h-5 w-5" /></button>
            <button type="button" onClick={() => setPanel(panel === 'quick' ? null : 'quick')} className="shrink-0 rounded-full p-2 text-slate-500 hover:bg-slate-100" title="Quick replies"><Zap className="h-5 w-5" /></button>
            <select onChange={(e) => { const t = (templateData?.data ?? []).find((x) => x.id === e.target.value)?.body_template; if (t) setText(fill(t)); e.target.value = ''; }} className="h-9 w-9 shrink-0 rounded-full border border-slate-200 bg-slate-50 text-center text-sm" title="Insert approved template text"><option value="">📄</option>{(templateData?.data ?? []).filter((t) => t.is_active).map((t) => <option value={t.id} key={t.id}>{t.name}</option>)}</select>
            <textarea value={text} onChange={(e) => setText(e.target.value)} onPaste={onPaste} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} rows={Math.min(10, Math.max(1, text.split('\n').length))} placeholder="Type a message…" className="max-h-64 min-w-0 flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm leading-6 outline-none focus:border-gold" />
            <button type="button" onClick={submit} disabled={!text.trim() || !config?.is_configured || sendAgent.isPending} title="Send message" className="shrink-0 rounded-full bg-gold p-2 text-navy shadow disabled:cursor-not-allowed disabled:opacity-40"><Send className="h-5 w-5" /></button>
          </div>
        )}
      </footer>
    </div>
  );
}

void FileText;
