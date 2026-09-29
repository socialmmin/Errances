'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { AlertTriangle, Bell, CheckCheck, X } from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';
import { useQueryClient } from '@tanstack/react-query';
import { playLeadAlertSound } from '@/lib/notification-sound';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { addLeadNotification, LeadNotification, LEAD_NOTIFICATIONS_CHANGED, readLeadNotifications, writeLeadNotifications } from '@/lib/lead-notifications';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useCampaignCoverage } from '@/hooks/use-packages';
import { tr, locale } from '@/i18n';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
const SOCKET_ORIGIN = API_URL.replace(/\/api\/?$/, '');

interface NewLeadPayload { id: string; lead_number: string; customer_name: string; phone: string | null; source: string | null; is_new_profile?: boolean; destination?: string | null; campaign_name?: string | null; }

export function LeadAlertProvider() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((state) => state.accessToken);
  const [open, setOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState<LeadNotification[]>([]);
  const [showPermissionHelp, setShowPermissionHelp] = React.useState(false);
  const [callback, setCallback] = React.useState<{ id: string | null; customer_name: string; phone: string } | null>(null);
  const [popup, setPopup] = React.useState<{ title: string; customerName: string; phone?: string | null; body?: string | null; leadId?: string; href?: string } | null>(null);
  const popupTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const showPopup = React.useCallback((next: { title: string; customerName: string; phone?: string | null; body?: string | null; leadId?: string; href?: string }) => {
    if (popupTimer.current) clearTimeout(popupTimer.current);
    setPopup(next);
    popupTimer.current = setTimeout(() => setPopup(null), 8000);
  }, []);
  const socketRef = React.useRef<Socket | null>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const push = usePushNotifications(!!accessToken);
  const notifPref = useQuery({ queryKey: ['my-notification-preference'], queryFn: () => api.get<{ enabled: boolean }>('/users/me/notifications'), enabled: !!accessToken });
  const notificationsDisabledInSettings = notifPref.data?.enabled === false;
  const criticalQuery = useQuery({ queryKey:['global','critical-ad-alert'], queryFn:()=>api.get<{warningLevel?:'healthy'|'low'|'critical';balance?:number}>('/integrations/meta/ad-account-summary'), enabled:!!accessToken, refetchInterval:30000 });
  const critical = criticalQuery.data?.warningLevel === 'critical' || criticalQuery.data?.warningLevel === 'low';
  const coverageQuery = useCampaignCoverage();
  const gapCount = coverageQuery.data?.gaps.length ?? 0;
  const [coverageDismissed, setCoverageDismissed] = React.useState(false);

  React.useEffect(() => {
    const refresh = () => setNotifications(readLeadNotifications());
    refresh();
    window.addEventListener(LEAD_NOTIFICATIONS_CHANGED, refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener(LEAD_NOTIFICATIONS_CHANGED, refresh); window.removeEventListener('storage', refresh); };
  }, []);

  React.useEffect(() => {
    if (!accessToken) { socketRef.current?.disconnect(); socketRef.current = null; return; }
    const socket = io(SOCKET_ORIGIN, { auth: { token: accessToken }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('new_lead', (lead: NewLeadPayload) => {
      const title = lead.is_new_profile === false ? 'New enquiry' : 'New lead';
      addLeadNotification({ id: `${lead.id}-${Date.now()}`, leadId: lead.id, title, customerName: lead.customer_name, phone: lead.phone, destination: lead.destination || null, createdAt: new Date().toISOString(), read: false });
      showPopup({ title, customerName: lead.customer_name, phone: lead.phone, body: lead.destination ? tr("Interested in {destination}", { destination: lead.destination }) : null, leadId: lead.id });
      playLeadAlertSound();
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    });
    socket.on('itinerary_sent', (info: { lead_id: string; customer_name: string; phone: string | null; package_name: string }) => {
      addLeadNotification({ id: `itin-${info.lead_id}-${Date.now()}`, leadId: info.lead_id, title: 'Itinerary sent', customerName: info.customer_name, phone: info.phone, destination: info.package_name, createdAt: new Date().toISOString(), read: false });
      showPopup({ title: 'Itinerary sent ✔', customerName: info.customer_name, phone: info.phone, body: `${info.package_name} — accepted by WhatsApp`, leadId: info.lead_id });
      playLeadAlertSound();
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp'] });
    });
    socket.on('whatsapp_message', (msg: { lead_id: string | null; customer_name: string; phone: string; body: string }) => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'messages'] });
      addLeadNotification({ id: `wa-${msg.lead_id ?? msg.phone}-${Date.now()}`, leadId: msg.lead_id ?? '', title: 'WhatsApp message', customerName: msg.customer_name, phone: msg.phone, destination: msg.body.slice(0, 60), createdAt: new Date().toISOString(), read: false });
      showPopup({ title: 'New WhatsApp message', customerName: msg.customer_name, phone: msg.phone, body: msg.body.slice(0, 100), leadId: msg.lead_id ?? undefined });
      playLeadAlertSound();
    });
    socket.on('itinerary_failed', (info: { lead_id: string | null; customer_name: string; destination: string | null; reason: string | null }) => {
      addLeadNotification({ id: `fail-${info.lead_id ?? info.customer_name}-${Date.now()}`, leadId: info.lead_id ?? '', title: 'Itinerary failed to send', customerName: info.customer_name, phone: null, destination: info.reason, createdAt: new Date().toISOString(), read: false });
      showPopup({ title: 'Itinerary failed to send', customerName: info.customer_name, body: `${info.destination ? info.destination + ' — ' : ''}${info.reason || 'No reason given'}`, leadId: info.lead_id ?? undefined });
      playLeadAlertSound();
    });
    socket.on('callback_requested', (req: { id: string | null; customer_name: string; phone: string }) => {
      addLeadNotification({ id: `cb-${req.id ?? req.phone}-${Date.now()}`, leadId: req.id ?? '', title: 'Wants to chat', customerName: req.customer_name, phone: req.phone, destination: null, createdAt: new Date().toISOString(), read: false });
      showPopup({ title: 'Customer wants a call back', customerName: req.customer_name, phone: req.phone, body: 'Open the callback list to call and mark it done', href: '/followups' });
      playLeadAlertSound(); queryClient.invalidateQueries({ queryKey: ['callback-requests'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [accessToken, queryClient, showPopup]);

  React.useEffect(() => {
    const close = (event: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const unread = notifications.filter((item) => !item.read).length;
  const save = (items: LeadNotification[]) => writeLeadNotifications(items);
  const openLead = (item: LeadNotification) => {
    save(notifications.map((entry) => entry.id === item.id ? { ...entry, read: true } : entry));
    setOpen(false);
    router.push(`/leads/${item.leadId}`);
  };

  // A CSS `transform` on an ancestor (the zoom feature's scale wrapper) turns every
  // descendant `position: fixed` into effectively `position: absolute` relative to
  // that ancestor, clipped by its `overflow-hidden` -- that's exactly why these were
  // getting trapped behind the page header instead of floating above everything.
  // Portaling straight to document.body sidesteps that ancestor entirely.
  const floatingLayer = typeof document !== 'undefined' ? createPortal(
    <>
      {popup && <div className="pointer-events-none fixed right-4 top-4 z-[9990] w-full max-w-xs sm:right-5"><div className="pointer-events-auto animate-[fade-in_.2s_ease-out] rounded-2xl border border-gold/30 bg-white p-4 shadow-2xl dark:bg-navy-900"><div className="flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gold/15 text-gold"><Bell className="h-4 w-4"/></div><div className="min-w-0 flex-1"><h2 className="text-sm font-bold text-navy dark:text-white">{tr(popup.title)}</h2><p className="mt-0.5 truncate text-xs text-slate-700 dark:text-slate-300"><strong>{popup.customerName}</strong>{popup.phone ? ` · ${popup.phone}` : ''}</p>{popup.body && <p className="mt-0.5 truncate text-xs text-slate-500">{popup.body}</p>}</div><button onClick={()=>setPopup(null)} className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10" aria-label={tr("Dismiss")}><X className="h-3.5 w-3.5"/></button></div>{(popup.href || popup.leadId) && <button onClick={()=>{setPopup(null);router.push(popup.href || `/leads/${popup.leadId}`);}} className="mt-3 w-full rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-navy">{popup.href ? tr("Open callback list") : tr("View")}</button>}</div></div>}
      {callback && <div className="fixed inset-0 z-[9995] grid place-items-center bg-black/55 p-4"><div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl"><div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-green-100 text-green-600"><Bell className="h-6 w-6"/></div><h2 className="text-lg font-bold text-navy">{tr("Customer wants to chat")}</h2><p className="mt-2 text-sm text-slate-700"><strong>{callback.customer_name}</strong>{' '}{tr("tapped “Chat with us” on the WhatsApp itinerary. Reply from the WhatsApp Inbox.")}</p>{callback.phone && <a href={`tel:${callback.phone}`} className="mt-4 block rounded-lg bg-green-600 px-4 py-2 font-semibold text-white">{tr("Call")}{' '}{callback.phone}</a>}<div className="mt-3 flex gap-2">{callback.id && <button onClick={()=>{setCallback(null);router.push('/whatsapp');}} className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-navy">{tr("Open chat")}</button>}<button onClick={()=>setCallback(null)} className="flex-1 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-navy">{tr("Dismiss")}</button></div></div></div>}
      {showPermissionHelp &&<div className="fixed inset-0 z-[9996] grid place-items-center bg-black/55 p-4" onMouseDown={(event)=>{if(event.target===event.currentTarget)setShowPermissionHelp(false)}}><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-lg font-bold text-navy">{tr("Chrome has blocked notifications for this site")}</h2><p className="mt-2 text-xs text-slate-500">{tr("This happens after Chrome sees the request denied or dismissed a few times — it then blocks the one-click popup for good, until you allow it manually here once. After that, it stays on.")}</p><ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-700"><li>{tr("Click the settings icon beside the website address.")}</li><li>{tr("Open")}{' '}<strong>{tr("Site settings")}</strong>.</li><li>{tr("Change")}{' '}<strong>{tr("Notifications")}</strong>{' '}{tr("to")}{' '}<strong>{tr("Allow")}</strong>.</li><li>{tr("Return here and reload this page.")}</li></ol><button onClick={()=>window.location.reload()} className="mt-5 w-full rounded-lg bg-gold px-4 py-2 font-semibold text-navy">{tr("I allowed it — reload")}</button></div></div>}
      {critical && <button onClick={()=>router.push('/dashboard')} className={`fixed bottom-20 right-3 z-[9980] flex h-12 w-12 items-center justify-center rounded-full text-white shadow-xl ring-2 ring-white md:bottom-5 md:right-5 ${criticalQuery.data?.warningLevel==='critical'?'bg-red-600':'bg-amber-500'}`} aria-label={tr("Critical alerts")}><AlertTriangle className="h-5 w-5"/><span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-navy px-1 text-[10px] font-bold text-white ring-2 ring-white">1</span></button>}
    </>,
    document.body,
  ) : null;

  return (
    <>
    {floatingLayer}
    {accessToken && !notificationsDisabledInSettings && push.status !== 'enabled' && push.status !== 'unsupported' && <div className="z-[150] flex shrink-0 flex-wrap items-center justify-center gap-2 bg-red-600 px-4 py-2 text-center text-sm font-semibold text-white shadow"><span>{tr("Enable notifications or you may miss new leads and critical ad alerts.")}</span><button onClick={async()=>{const result=await push.enable();if(result==='denied')setShowPermissionHelp(true);}} className="rounded-md bg-white px-3 py-1 text-red-700">{tr("Enable notifications")}</button></div>}
    {accessToken && gapCount > 0 && !coverageDismissed && <div className="z-[149] flex shrink-0 flex-wrap items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-navy shadow"><AlertTriangle className="h-4 w-4" /><span>{gapCount}{' '}{tr("live ad campaign")}{gapCount > 1 ? tr("s are") : tr(" is")}{' '}{tr("running with no itinerary ready to send.")}</span><button onClick={() => router.push('/packages')} className="rounded-md bg-navy px-3 py-1 text-white">{tr("Fix now")}</button><button onClick={() => setCoverageDismissed(true)} className="rounded-md p-1 hover:bg-black/10" aria-label={tr("Hide")}><X className="h-4 w-4" /></button></div>}
    <div ref={panelRef} className="absolute right-4 top-2.5 z-[160] sm:right-5 sm:top-3.5">
      {open && <div className="absolute right-0 top-12 flex max-h-[min(34rem,70vh)] w-[min(23rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3"><div><p className="font-semibold text-foreground">{tr("New leads")}</p><p className="text-xs text-muted-foreground">{tr("All recent lead notifications")}</p></div>{unread > 0 && <button onClick={() => save(notifications.map((item) => ({ ...item, read: true })))} className="flex items-center gap-1 text-xs font-semibold text-gold"><CheckCheck className="h-3.5 w-3.5" />{' '}{tr("Read all")}</button>}</div>
        <div className="overflow-y-auto overscroll-contain">{notifications.length === 0 ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">{tr("No new leads yet.")}</p> : notifications.map((item) => <div key={item.id} className={`group flex items-start gap-2 border-b border-border/70 px-3 py-3 last:border-0 ${item.read ? '' : 'bg-gold/5'}`}><button onClick={() => openLead(item)} className="min-w-0 flex-1 text-left"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold">{tr(item.title)} — {item.customerName}</p>{!item.read && <span className="h-2 w-2 shrink-0 rounded-full bg-gold" />}</div><p className="mt-1 truncate text-xs text-muted-foreground">{item.phone || tr("No phone")}{item.destination ? ` · ${item.destination}` : ''}</p><p className="mt-1 text-[11px] text-muted-foreground">{new Date(item.createdAt).toLocaleString(locale())}</p></button><button onClick={() => save(notifications.filter((entry) => entry.id !== item.id))} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label={tr("Remove")}><X className="h-3.5 w-3.5" /></button></div>)}</div>
      </div>}
      <button onClick={() => setOpen((value) => !value)} className="relative flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-navy shadow-sm transition-transform hover:scale-105 active:scale-95" aria-label={tr("All notifications{value}", { value: unread ? `, ${unread} unread` : '' })}><Bell className="h-4 w-4" />{unread > 0 && <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white ring-2 ring-white">{unread > 99 ? '99+' : unread}</span>}</button>
    </div>
    </>
  );
}
