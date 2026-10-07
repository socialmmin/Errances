'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Archive, Check, CheckCheck, ChevronDown, CircleUserRound, Clock3, FileText, Filter,
  Copy, ExternalLink, Mail, MapPin, MessageCircle, MoreVertical, Paperclip, Phone, Search, Send, Settings,
  PanelRightClose, PanelRightOpen, Tag, UserRoundCheck, UsersRound,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Lead } from '@/types/lead';
import { useAssignableUsers, useBulkAssignLeads, useLeads } from '@/hooks/use-leads';
import { useInboxState, useMarkChatRead, usePackageThumbnail, WhatsAppChatMessage, useLeadMessages, useSaveAppSecret, useSendAgentMedia, useSendAgentMessage, useWhatsAppHealth, useWhatsAppConfig, useWhatsAppLogs, useWhatsAppTemplates } from '@/hooks/use-whatsapp';
import { useToast } from '@/components/ui/toast';
import { useBranding } from '@/components/branding-provider';
import { useAuthStore } from '@/store/auth-store';
import { api } from '@/lib/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { renderPdfFirstPage } from '@/lib/pdf-thumb';
import { fetchPackageDocumentBytes } from '@/hooks/use-packages';
import { savePackageThumbnail } from '@/hooks/use-whatsapp';
import { ManualSendDropdown } from '@/components/shared/manual-send';
import { ChatPane } from '@/components/whatsapp/chat-pane';


const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'TR';
}

function displayPhone(lead: Lead) {
  return lead.whatsapp_number || lead.phone || 'No mobile number';
}

function relativeDate(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(diff / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function WhatsAppInboxPage() {
  const branding = useBranding();
  const searchParams = useSearchParams();
  const leadIdParam = searchParams.get('lead');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(leadIdParam);
  useEffect(() => {
    if (leadIdParam) setSelectedId(leadIdParam);
  }, [leadIdParam]);
  const [status, setStatus] = useState('all');
  // The unread chat you opened stays in the Unread list (marked "Reading") until you open another
  // chat or switch tab -- otherwise it vanishes the moment it's marked read.
  const [keptUnreadId, setKeptUnreadId] = useState<string | null>(null);
  // Right-hand contact panel can be hidden for more chat room; remembered on this device.
  const [showDetails, setShowDetails] = useState(true);
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem('inbox-details'); } catch { /* storage blocked */ }
    // Narrow windows always start closed (it would cover the chat); wide ones follow the saved choice.
    setShowDetails(window.innerWidth >= 1280 ? saved !== 'hidden' : false);
  }, []);
  const toggleDetails = (v: boolean) => { setShowDetails(v); try { localStorage.setItem('inbox-details', v ? 'shown' : 'hidden'); } catch { /* storage blocked */ } };
  const [message, setMessage] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const { data: leadData, isLoading } = useLeads({ search: search || undefined, pageSize: 100, sortBy: 'activity' });
  const { data: usersData } = useAssignableUsers();
  const { data: stateMap } = useInboxState();
  // A busy sending window can push 100+ other leads' activity ahead of an unread chat within
  // minutes, silently scrolling it out of the page above even though it's still unread -- so
  // fetch any unread lead that isn't already in that page by id, and merge it back in.
  const unreadIdsFromState = useMemo(() => Object.entries(stateMap ?? {}).filter(([, row]) => (row.unread ?? 0) > 0).map(([leadId]) => leadId), [stateMap]);
  const loadedLeadIds = useMemo(() => new Set((leadData?.data ?? []).map((l) => l.id)), [leadData?.data]);
  const missingUnreadIds = useMemo(() => unreadIdsFromState.filter((id) => !loadedLeadIds.has(id)), [unreadIdsFromState, loadedLeadIds]);
  const { data: missingUnreadData } = useLeads({ ids: missingUnreadIds, enabled: missingUnreadIds.length > 0 });
  const markRead = useMarkChatRead();
  const [mobileChat, setMobileChat] = useState(false);
  const { data: config } = useWhatsAppConfig();
  const { data: logData } = useWhatsAppLogs();
  const { data: templateData } = useWhatsAppTemplates();
  const assign = useBulkAssignLeads();
  const { toast } = useToast();
  const sendAgent = useSendAgentMessage();
  const sendMedia = useSendAgentMedia();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const accessToken = useAuthStore((s) => s.accessToken);
  const { data: health } = useWhatsAppHealth();
  const saveSecret = useSaveAppSecret();
  const [secretInput, setSecretInput] = useState('');

  // The merged list every filter/lookup below reads from, so an unread lead fetched separately
  // (because a busy sending window pushed it off the normal page) behaves exactly like any other.
  // A chat opened by link (?lead=…) may be a lead with no conversation yet, so it is not in
  // the loaded list -- fetch that one lead so its chat still opens.
  const linkedMissing = !!leadIdParam && !!leadData && !(leadData.data ?? []).some((l) => l.id === leadIdParam);
  const { data: linkedLeadData } = useLeads({ ids: leadIdParam ? [leadIdParam] : [], enabled: linkedMissing });
  const allLeads = useMemo(() => {
    const rows = leadData?.data ?? [];
    const extra = [...(missingUnreadData?.data ?? []), ...(linkedMissing ? linkedLeadData?.data ?? [] : [])].filter((l, i, arr) => !rows.some((r) => r.id === l.id) && arr.findIndex((x) => x.id === l.id) === i);
    return extra.length ? [...extra, ...rows] : rows;
  }, [leadData?.data, missingUnreadData?.data, linkedLeadData?.data, linkedMissing]);
  const conversations = useMemo(() => {
    if (status === 'done') return allLeads.filter((lead) => stateMap?.[lead.id]?.status === 'done');
    const open = allLeads.filter((lead) => stateMap?.[lead.id]?.status !== 'done');
    if (status === 'unread') return open.filter((lead) => (stateMap?.[lead.id]?.unread ?? 0) > 0 || lead.id === keptUnreadId);
    if (status === 'reply') return open.filter((lead) => stateMap?.[lead.id]?.needs_reply || lead.id === keptUnreadId);
    if (status === 'unassigned') return open.filter((lead) => !lead.assigned_to);
    if (status === 'new') return open.filter((lead) => lead.status === 'new');
    return open;
  }, [allLeads, status, stateMap, keptUnreadId]);
  // Same source the sidebar badge uses, so the tab count and the sidebar badge never disagree.
  // Chats where the customer wrote last and no person has answered -- even if someone opened them.
  const replyCount = useMemo(() => Object.values(stateMap ?? {}).filter((row) => row.needs_reply).length, [stateMap]);
  const unreadCount = useMemo(() => Object.values(stateMap ?? {}).reduce((sum, row) => sum + (row.unread || 0), 0), [stateMap]);
  // Looked up from the full unfiltered list, not `conversations` -- opening a chat from the
  // Unread tab marks it read, which drops it out of that filtered list a moment later, and
  // the chat pane must stay open instead of snapping back to "Select a conversation".
  const selected = allLeads.find((lead) => lead.id === selectedId) || null;
  // Auto-open the first chat only when nothing has ever been picked yet (fresh page load).
  // Must never re-fire when a filter tab just removes the current chat from view --
  // that used to silently jump to (and mark read) whichever chat became first-in-list,
  // and on the Unread tab that cascaded through the entire list, wrongly marking every
  // unread chat as read without anyone actually opening them.
  // Switching tab (All / Unread / New ...) starts clean: nothing open until a chat is picked.
  const firstTab = useRef(true);
  useEffect(() => { if (firstTab.current) { firstTab.current = false; return; } setSelectedId(null); setKeptUnreadId(null); setMobileChat(false); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  const everSelected = useRef(false);
  useEffect(() => { if (selectedId) everSelected.current = true; }, [selectedId]);
  useEffect(() => {
    // No chat opens by itself: opening one marks it read, so it would drop out of Unread before
    // anyone had actually looked at it. A chat opens only when it is clicked (or linked to).
    void conversations;
  }, [conversations, selectedId]);
  const selectedUnread = selected ? (stateMap?.[selected.id]?.unread ?? 0) : 0;
  useEffect(() => { if (selected && selectedUnread > 0) markRead.mutate(selected.id); }, [selected?.id, selectedUnread]); // eslint-disable-line react-hooks/exhaustive-deps
  const logs = useMemo(() => {
    if (!selected) return [];
    const phone = displayPhone(selected).replace(/\D/g, '');
    return (logData?.data ?? []).filter((log) => log.to_number.replace(/\D/g, '').endsWith(phone.slice(-10)));
  }, [logData?.data, selected]);

  const { data: chatMessages } = useLeadMessages(selected?.id);
  const thread = useMemo(() => {
    const shownIds = new Set((chatMessages ?? []).map((m) => m.meta?.waId).filter(Boolean));
    const items = [
      ...logs.filter((log) => !(log.message_id && shownIds.has(log.message_id))).map((log) => ({ kind: 'log' as const, at: new Date(log.sent_at || log.created_at).getTime(), log })),
      ...(chatMessages ?? []).map((msg) => ({ kind: 'msg' as const, at: new Date(msg.created_at).getTime(), msg })),
    ];
    return items.sort((a, b) => a.at - b.at);
  }, [logs, chatMessages]);
  const errorByWaId = useMemo(() => Object.fromEntries((logData?.data ?? []).filter((log) => log.message_id && log.error_message).map((log) => [log.message_id as string, log.error_message as string])), [logData?.data]);
  const statusByWaId = useMemo(() => Object.fromEntries((logData?.data ?? []).filter((log) => log.message_id).map((log) => [log.message_id as string, log.status])), [logData?.data]);

  async function sendReply() {
    if (!selected || !message.trim()) return;
    try {
      await sendAgent.mutateAsync({ leadId: selected.id, text: message.trim() });
      setMessage('');
    } catch (error: any) {
      toast(error.message || 'Could not send the message', 'error');
    }
  }

  async function handleAttachment(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !selected) return;
    if (file.size > MAX_ATTACHMENT_BYTES) { toast('That file is too large (max 100MB, images max 5MB on WhatsApp)', 'error'); return; }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('folder', 'whatsapp-attachments');
      const res = await fetch(`${API_URL}/files/upload`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || 'Upload failed');
      const uploaded = await res.json();
      await sendMedia.mutateAsync({ leadId: selected.id, url: uploaded.url, filename: file.name, mimeType: file.type, caption: message.trim() || undefined });
      setMessage('');
    } catch (error: any) {
      toast(error.message || 'Could not send the attachment', 'error');
    } finally {
      setUploading(false);
    }
  }

  async function setAssignee(value: string) {
    if (!selected || !value) return;
    await assign.mutateAsync({ leadIds: [selected.id], assignedTo: value });
  }

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-slate-100 dark:bg-navy-950">
      <section className={cn('flex w-full min-w-0 flex-col border-r border-slate-200 bg-white md:w-[330px] lg:w-[360px] dark:border-white/10 dark:bg-navy-950', mobileChat && 'hidden md:flex')}>
        <header className="border-b border-slate-200 p-4 dark:border-white/10">
          <div className="flex items-center justify-between">
            <div><h1 className="text-lg font-bold text-navy dark:text-white">Shared WhatsApp Inbox</h1><p className="text-xs text-muted-foreground">{branding.company_name}</p></div>
            <Link href="/settings/whatsapp" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-gold dark:hover:bg-white/10" title="WhatsApp settings"><Settings className="h-4 w-4" /></Link>
          </div>
          <div className="relative mt-4"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or mobile…" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-gold dark:border-white/10 dark:bg-white/5" /></div>
          <div className="mt-3 flex flex-wrap gap-2">
            {[['all', `All ${leadData?.total ?? 0}`], ['unread', unreadCount > 0 ? `Unread ${unreadCount}` : 'Unread'], ['reply', replyCount > 0 ? `Reply pending ${replyCount}` : 'Reply pending'], ['new', 'New'], ['unassigned', 'Unassigned'], ['done', 'Done']].map(([value, label]) => <button key={value} onClick={() => { setStatus(value); setKeptUnreadId(null); }} className={cn('rounded-full px-3 py-1.5 text-xs font-semibold', status === value ? 'bg-gold text-navy' : 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300')}>{label}</button>)}
            <button className="ml-auto rounded-lg border border-slate-200 p-1.5 text-slate-500 dark:border-white/10"><Filter className="h-4 w-4" /></button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
          {isLoading && <p className="p-8 text-center text-sm text-muted-foreground">Loading conversations…</p>}
          {!isLoading && !conversations.length && <p className="p-8 text-center text-sm text-muted-foreground">No conversations found.</p>}
          {conversations.map((lead) => (
            <button key={lead.id} onClick={() => { setKeptUnreadId((stateMap?.[lead.id]?.unread ?? 0) > 0 ? lead.id : null); setSelectedId(lead.id); setMobileChat(true); }} className={cn('flex w-full gap-3 border-b border-slate-100 px-4 py-3 text-left transition dark:border-white/5', selected?.id === lead.id ? 'border-l-4 border-l-gold bg-gold/10' : 'hover:bg-slate-50 dark:hover:bg-white/5')}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-gold">{initials(lead.customer_name)}</span>
              <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><strong className={cn('truncate text-sm text-navy dark:text-white', (stateMap?.[lead.id]?.unread ?? 0) > 0 && 'font-extrabold')}>{lead.customer_name}</strong>{stateMap?.[lead.id]?.needs_reply && <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700" title="The customer wrote and nobody has replied yet">Reply pending</span>}<span className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400">{relativeDate(stateMap?.[lead.id]?.last_at || lead.updated_at)}{(stateMap?.[lead.id]?.unread ?? 0) > 0 && <span className="min-w-[1.25rem] rounded-full bg-emerald-500 px-1.5 text-center text-[10px] font-bold text-white">{stateMap?.[lead.id]?.unread}</span>}{lead.id === keptUnreadId && (stateMap?.[lead.id]?.unread ?? 0) === 0 && <span className="rounded-full bg-sky-100 px-1.5 text-[10px] font-bold text-sky-700">Reading</span>}</span></span><span className={cn('mt-0.5 block truncate text-xs', (stateMap?.[lead.id]?.unread ?? 0) > 0 ? 'font-semibold text-slate-700' : 'text-slate-500')}>{stateMap?.[lead.id]?.last_body ? `${stateMap?.[lead.id]?.last_direction === 'out' ? 'You: ' : ''}${stateMap?.[lead.id]?.last_body}` : (lead.destination || lead.campaign_name || 'Travel enquiry')}</span><span className="mt-1 flex items-center gap-1.5"><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">{lead.status.replace(/_/g, ' ')}</span>{!lead.assigned_to && <span className="text-[10px] text-amber-600">Unassigned</span>}</span></span>
            </button>
          ))}
        </div>
      </section>

      <section className={cn('min-w-0 flex-1 flex-col md:flex', mobileChat ? 'flex' : 'hidden')}>
        {health && health.configured && (!health.secretValid || !health.subscribed) && (
          <div className="shrink-0 border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800">
            <p className="font-bold">Customer replies are not reaching the CRM yet</p>
            <p className="mt-1 text-xs">{health.provider === 'twilio' ? 'The Twilio WhatsApp sender is offline, or its incoming-message address in the Twilio console does not point to this CRM. Open Twilio → Messaging → Senders → WhatsApp senders and check the sender status and its webhook URL.' : !health.secretValid ? `Meta's App Secret for "${health.appName || 'your app'}" is missing or wrong, so every incoming WhatsApp message is refused. Open developers.facebook.com → your app → App settings → Basic → App secret → Show, copy it and paste it below. Meta checks it before it is saved.` : 'Your number is not subscribed to this app in Meta. Open the app → WhatsApp → Configuration and subscribe to "messages".'}</p>
            {!health.secretValid && <form className="mt-2 flex flex-wrap gap-2" onSubmit={async (event) => { event.preventDefault(); try { await saveSecret.mutateAsync(secretInput); setSecretInput(''); toast('App Secret saved — customer messages will now reach the CRM', 'success'); } catch (error: any) { toast(error.message || 'Could not save the secret', 'error'); } }}><input type="password" autoComplete="off" value={secretInput} onChange={(event) => setSecretInput(event.target.value)} placeholder="Paste App Secret (32 characters)" className="h-9 min-w-[16rem] flex-1 rounded-lg border border-red-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-gold" /><button type="submit" disabled={!secretInput.trim() || saveSecret.isPending} className="h-9 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{saveSecret.isPending ? 'Checking with Meta…' : 'Save & connect'}</button></form>}
          </div>
        )}
        {health && health.secretValid && health.subscribed && (
          <div className="shrink-0 border-b border-emerald-100 bg-emerald-50 px-5 py-1.5 text-xs text-emerald-800">Connected — customer messages reach the CRM{health.lastInboundAt ? ` · last message ${new Date(health.lastInboundAt).toLocaleString('en-IN')}` : ' · none received yet'}</div>
        )}
        {selected ? <>
          <ChatPane lead={selected}
            leading={<div className="mr-1 flex min-w-0 max-w-[16rem] items-center gap-2"><button type="button" aria-label="Back to chats" onClick={() => setMobileChat(false)} className="-ml-2 rounded-full p-2 text-navy hover:bg-slate-100 md:hidden"><ArrowLeft className="h-5 w-5" /></button><span className="flex h-8 w-8 shrink-0 text-xs items-center justify-center rounded-full bg-gold font-bold text-navy" title="WhatsApp does not share a customer's profile photo with businesses — this is their initials.">{initials(selected.customer_name)}</span><div className="min-w-0"><h2 className="truncate text-sm font-bold leading-tight text-navy dark:text-white">{selected.customer_name}</h2><p className="truncate text-[11px] leading-tight text-slate-500">{displayPhone(selected)} · {selected.destination || 'General enquiry'}</p></div></div>}
            trailing={<div className="flex items-center gap-1.5"><ManualSendDropdown leadId={selected.id} /><select value={selected.assigned_to || ''} onChange={(event) => setAssignee(event.target.value)} className="h-7 max-w-36 rounded-lg border border-slate-200 bg-white px-2 text-[11px] dark:border-white/10 dark:bg-navy"><option value="">Assign agent</option>{(usersData?.data ?? []).map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}</select><Link href={`/leads/${selected.id}`} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:text-gold dark:border-white/10" title="Open lead"><CircleUserRound className="h-4 w-4" /></Link><button type="button" onClick={() => toggleDetails(!showDetails)} className={cn('rounded-lg border p-1.5 hover:text-gold dark:border-white/10', showDetails ? 'border-gold bg-gold/10 text-navy' : 'border-slate-200 text-slate-500')} title={showDetails ? 'Hide contact details' : 'Show contact details'} aria-label={showDetails ? 'Hide contact details' : 'Show contact details'}>{showDetails ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}</button><div ref={menuRef} className="relative"><button onClick={() => setMenuOpen((v) => !v)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"><MoreVertical className="h-4 w-4" /></button>{menuOpen && <div className="absolute right-0 top-11 z-20 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-navy-950"><a href={`https://wa.me/${displayPhone(selected).replace(/\D/g, '')}`} target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"><ExternalLink className="h-4 w-4" />Open in WhatsApp</a><button onClick={() => { navigator.clipboard?.writeText(displayPhone(selected)); toast('Number copied', 'success'); setMenuOpen(false); }} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"><Copy className="h-4 w-4" />Copy number</button><Link href={`/leads/${selected.id}`} onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"><CircleUserRound className="h-4 w-4" />Open lead profile</Link></div>}</div></div>}
          />
        </> : <div className="flex flex-1 items-center justify-center text-center"><div><MessageCircle className="mx-auto h-12 w-12 text-gold" /><h2 className="mt-3 font-semibold text-navy dark:text-white">Select a conversation</h2><p className="mt-1 text-sm text-muted-foreground">Choose a lead to see their WhatsApp workspace.</p></div></div>}
      </section>

      {showDetails && <div className="absolute inset-0 z-20 bg-black/20 xl:hidden" onClick={() => toggleDetails(false)} />}
      <aside className={cn('w-[300px] shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-navy-950', showDetails ? 'absolute inset-y-0 right-0 z-30 block shadow-2xl xl:static xl:z-auto xl:shadow-none' : 'hidden')}>
        <div className="-mt-2 mb-2 flex justify-end"><button type="button" onClick={() => toggleDetails(false)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-navy dark:hover:bg-white/10" title="Hide contact details"><PanelRightClose className="h-3.5 w-3.5" />Hide</button></div>
        {selected && <div className="space-y-5"><div className="text-center"><span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-navy text-xl font-bold text-gold">{initials(selected.customer_name)}</span><h3 className="mt-3 font-bold text-navy dark:text-white">{selected.customer_name}</h3><p className="text-xs text-slate-500">{selected.lead_number}</p></div><div className="space-y-2 rounded-xl border border-slate-200 p-4 text-xs dark:border-white/10"><Info icon={MessageCircle} label="WhatsApp" value={displayPhone(selected)} /><Info icon={Mail} label="Email" value={selected.email || 'Not provided'} /><Info icon={MapPin} label="Destination" value={selected.destination || 'Not selected'} /><Info icon={UserRoundCheck} label="Agent" value={selected.assigned_to_name || 'Unassigned'} /></div><div><h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500"><Tag className="h-3.5 w-3.5" /> Tags</h4><div className="mt-2 flex flex-wrap gap-2"><span className="rounded-full bg-gold/15 px-2.5 py-1 text-xs font-semibold text-amber-700">{selected.priority}</span><span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">{selected.status.replace(/_/g, ' ')}</span>{selected.source && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{selected.source}</span>}</div></div><div><h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Notes</h4><div className="mt-2 min-h-24 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">{selected.remarks || 'No notes added. Open the lead profile to add follow-up notes.'}</div></div><div><h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Quick actions</h4><div className="mt-2 grid grid-cols-2 gap-2"><Quick icon={FileText} label="Quotation" href="/quotations/new" /><Quick icon={Clock3} label="Follow-up" href={`/leads/${selected.id}`} /><Quick icon={Archive} label="Lead profile" href={`/leads/${selected.id}`} /><Quick icon={UsersRound} label="Customer" href={`/leads/${selected.id}`} /></div></div></div>}
      </aside>
    </div>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof MessageCircle; label: string; value: string }) {
  return <div className="flex gap-2"><Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" /><div className="min-w-0"><p className="text-slate-400">{label}</p><p className="truncate font-medium text-navy dark:text-white">{value}</p></div></div>;
}

function Quick({ icon: Icon, label, href }: { icon: typeof MessageCircle; label: string; href: string }) {
  return <Link href={href} className="flex items-center gap-2 rounded-xl border border-slate-200 p-2.5 text-xs font-semibold text-slate-600 hover:border-gold hover:text-navy dark:border-white/10 dark:text-slate-300 dark:hover:text-gold"><Icon className="h-4 w-4 text-gold" />{label}</Link>;
}
