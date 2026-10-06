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
import { useWhatsAppHealth } from '@/hooks/use-whatsapp';
import { useMyAccess } from '@/hooks/use-access';

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
  const { can, isSuperAdmin } = useMyAccess();
  const criticalQuery = useQuery({ queryKey:['global','critical-ad-alert'], queryFn:()=>api.get<{warningLevel?:'healthy'|'low'|'critical';balance?:number}>('/integrations/meta/ad-account-summary'), enabled:!!accessToken && can('dashboard.meta_ads'), refetchInterval:30000 });
  const critical = criticalQuery.data?.warningLevel === 'critical' || criticalQuery.data?.warningLevel === 'low';
  // Campaign coverage is Packages / dashboard-coverage data and connection health is admin-level --
  // neither banner segment is shown to someone who cannot open that area.
  const coverageQuery = useCampaignCoverage({ enabled: can('packages', 'dashboard.coverage') });
  const gapCount = coverageQuery.data?.gaps.length ?? 0;
  const whatsappHealth = useWhatsAppHealth().data;
  const connectionProblem = isSuperAdmin && !!whatsappHealth?.configured && (!whatsappHealth.tokenValid || !whatsappHealth.secretValid || !whatsappHealth.subscribed || whatsappHealth.inboundStale);
  // Never fully dismissed -- closing it only collapses it to a small floating pill (still visible,
  // still clickable to re-expand) since the underlying gap/pause is still real and shouldn't
  // become invisible just because someone closed it once.
  const [coverageCollapsed, setCoverageCollapsed] = React.useState(false);
  const [fixMenuOpen, setFixMenuOpen] = React.useState(false);

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
      showPopup({ title, customerName: lead.customer_name, phone: lead.phone, body: lead.destination ? `Interested in ${lead.destination}` : null, leadId: lead.id });
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
    // Pushed the instant Meta's own message_template_status_update webhook reaches our backend
    // -- refetches every open view of packages/itineraries right away instead of waiting on
    // that page's own 20s fallback poll (which still exists in case this event is ever missed).
    socket.on('template_status_update', () => {
      queryClient.invalidateQueries({ queryKey: ['packages'] });
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
      {popup && <div className="pointer-events-none fixed right-4 top-4 z-[9990] w-full max-w-xs sm:right-5"><div className="pointer-events-auto animate-[fade-in_.2s_ease-out] rounded-2xl border border-gold/30 bg-white p-4 shadow-2xl dark:bg-navy-900"><div className="flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gold/15 text-gold"><Bell className="h-4 w-4"/></div><div className="min-w-0 flex-1"><h2 className="text-sm font-bold text-navy dark:text-white">{popup.title}</h2><p className="mt-0.5 truncate text-xs text-slate-700 dark:text-slate-300"><strong>{popup.customerName}</strong>{popup.phone ? ` · ${popup.phone}` : ''}</p>{popup.body && <p className="mt-0.5 truncate text-xs text-slate-500">{popup.body}</p>}</div><button onClick={()=>setPopup(null)} className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10" aria-label="Dismiss"><X className="h-3.5 w-3.5"/></button></div>{(popup.href || popup.leadId) && <button onClick={()=>{setPopup(null);router.push(popup.href || `/leads/${popup.leadId}`);}} className="mt-3 w-full rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-navy">{popup.href ? "Open callback list" : "View"}</button>}</div></div>}
      {callback && <div className="fixed inset-0 z-[9995] grid place-items-center bg-black/55 p-4"><div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl"><div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-green-100 text-green-600"><Bell className="h-6 w-6"/></div><h2 className="text-lg font-bold text-navy">Customer wants to chat</h2><p className="mt-2 text-sm text-slate-700"><strong>{callback.customer_name}</strong> tapped “Chat with us” on the WhatsApp itinerary. Reply from the WhatsApp Inbox.</p>{callback.phone && <a href={`tel:${callback.phone}`} className="mt-4 block rounded-lg bg-green-600 px-4 py-2 font-semibold text-white">Call {callback.phone}</a>}<div className="mt-3 flex gap-2">{callback.id && <button onClick={()=>{setCallback(null);router.push('/whatsapp');}} className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-navy">Open chat</button>}<button onClick={()=>setCallback(null)} className="flex-1 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-navy">Dismiss</button></div></div></div>}
      {showPermissionHelp &&<div className="fixed inset-0 z-[9996] grid place-items-center bg-black/55 p-4" onMouseDown={(event)=>{if(event.target===event.currentTarget)setShowPermissionHelp(false)}}><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-lg font-bold text-navy">Chrome has blocked notifications for this site</h2><p className="mt-2 text-xs text-slate-500">This happens after Chrome sees the request denied or dismissed a few times — it then blocks the one-click popup for good, until you allow it manually here once. After that, it stays on.</p><ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-700"><li>Click the settings icon beside the website address.</li><li>Open <strong>Site settings</strong>.</li><li>Change <strong>Notifications</strong> to <strong>Allow</strong>.</li><li>Return here and reload this page.</li></ol><button onClick={()=>window.location.reload()} className="mt-5 w-full rounded-lg bg-gold px-4 py-2 font-semibold text-navy">I allowed it — reload</button></div></div>}
    </>,
    document.body,
  ) : null;

  return (
    <>
    {floatingLayer}
    {accessToken && (() => {
      // All top-of-app alert conditions share ONE single-row, in-flow banner (it takes its own space and never
      // overlays the page or a dialog).
      const pushNeeded = !notificationsDisabledInSettings && push.status !== 'enabled' && push.status !== 'unsupported';
      const gaps = coverageQuery.data?.gaps ?? [];
      const hasCoverage = gapCount > 0;
      if (!pushNeeded && !hasCoverage && !connectionProblem && !critical) return null;
      const allAutoPaused = hasCoverage && gaps.every((g) => g.reason === 'auto_paused');
      const coverageText = !hasCoverage ? '' : allAutoPaused
        ? `${gapCount > 1 ? `${gapCount} campaigns are` : `${gaps[0].name} is`} auto-paused for delivery health -- Meta wasn't confirming delivery, so sending was paused automatically for your account's good and will resume on its own once it clears.`
        : `${gapCount > 1 ? `${gapCount} live campaigns have no itinerary ready to send: ` : 'No itinerary ready to send for '}${gaps.slice(0, 3).map((g) => g.name).join(', ')}${gapCount > 3 ? ` +${gapCount - 3} more` : ''}.`;
      const pushText = pushNeeded ? 'Enable notifications or you may miss new leads and critical ad alerts.' : '';
      // Mirrors exactly what /settings/integrations shows per-check, so this banner and that page
      // never disagree about what's actually wrong.
      const connectionText = connectionProblem
        ? (whatsappHealth?.inboundStale ? "WhatsApp isn't receiving replies -- messages send out fine but nothing is coming back. Check the Meta webhook subscription."
          : !whatsappHealth?.tokenValid ? 'WhatsApp access token is invalid or expired.'
          : !whatsappHealth?.secretValid ? "WhatsApp app secret couldn't be verified -- inbound webhooks may be getting rejected."
          : 'WhatsApp app is not subscribed to this number -- Meta will not deliver any webhook events.')
        : '';
      // ONE row, always: a ticker that runs "1 · problem one   2 · problem two", a live count on the
      // warning icon, and a single Fix button. With more than one fixable problem, Fix asks which
      // one and opens that problem's own page (the package to activate/fix, or the connection page).
      type Fix = { label: string; run: () => void };
      const problems: { key: string; text: string; tone: 'red' | 'amber' | 'sky'; fixes: Fix[] }[] = [];
      if (connectionProblem) problems.push({ key: 'conn', text: connectionText, tone: 'red', fixes: [{ label: 'Open WhatsApp connection settings', run: () => router.push('/settings/integrations?key=whatsapp') }] });
      // Low Meta Ads balance lives in the banner too (it used to be a floating button over the page).
      if (critical) {
        const isCritical = criticalQuery.data?.warningLevel === 'critical';
        problems.push({ key: 'ads', text: `Meta Ads balance is ${isCritical ? 'critically ' : ''}low: ₹${Number(criticalQuery.data?.balance || 0).toLocaleString('en-IN')} left — recharge or campaigns will stop.`, tone: isCritical ? 'red' : 'amber', fixes: [{ label: 'Check Meta Ads balance & account', run: () => router.push(isSuperAdmin ? '/settings/integrations?key=meta_ads' : '/dashboard') }] });
      }
      if (pushNeeded) problems.push({ key: 'push', text: pushText, tone: 'red', fixes: [{ label: 'Enable notifications on this device', run: async () => { const result = await push.enable(); if (result === 'denied') setShowPermissionHelp(true); } }] });
      if (hasCoverage) problems.push({
        key: 'cov', text: coverageText, tone: allAutoPaused ? 'sky' : 'amber',
        // One option per campaign, straight to the package that needs an itinerary / activating.
        fixes: allAutoPaused ? [] : gaps.slice(0, 6).map((g) => ({
          label: g.packageId ? `Open package: ${g.name}` : `Create package for: ${g.name}`,
          run: () => router.push(g.packageId ? `/packages/${g.packageId}` : `/packages/new?campaign=${encodeURIComponent(g.name)}`),
        })).concat(gaps.length > 6 ? [{ label: `All ${gaps.length} campaigns — Packages & Itinerary`, run: () => router.push('/packages') }] : []),
      });
      const fixable = problems.flatMap((p, i) => p.fixes.map((f) => ({ ...f, num: i + 1 })));
      const worst = problems.some((p) => p.tone === 'red') ? 'red' : problems.some((p) => p.tone === 'amber') ? 'amber' : 'sky';
      const bg = worst === 'red' ? 'bg-red-600 text-white' : worst === 'amber' ? 'bg-amber-500 text-navy' : 'bg-sky-100 text-navy';
      const countBadge = (
        <span className="relative shrink-0" title={`${problems.length} problem${problems.length === 1 ? '' : 's'}`}>
          <AlertTriangle className="h-4 w-4" />
          <span className={`absolute -right-2 -top-2 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold ring-2 ${worst === 'red' ? 'bg-white text-red-700 ring-red-600' : 'bg-navy text-white ring-amber-500'}`}>{problems.length}</span>
        </span>
      );
      const ticker = problems.map((p, i) => (
        <span key={p.key} className="inline-flex items-center gap-2 pr-14">
          <span className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold ${worst === 'red' ? 'bg-white text-red-700' : 'bg-navy text-white'}`}>{i + 1}</span>
          {p.text}
        </span>
      ));
      if (coverageCollapsed) return (
        <button onClick={() => setCoverageCollapsed(false)} className={`flex shrink-0 items-center gap-3 px-4 py-1 text-xs font-bold ${bg}`} aria-label="Show alerts">
          {countBadge}<span>{problems.length} {problems.length === 1 ? 'problem needs' : 'problems need'} attention — show</span>
        </button>
      );
      return <div className={`relative flex shrink-0 items-center gap-3 px-4 py-2 text-sm font-semibold shadow ${bg}`}>
        {countBadge}
        <div className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
          <div className="inline-flex animate-[marquee_38s_linear_infinite]"><span className="inline-flex">{ticker}</span><span className="inline-flex" aria-hidden="true">{ticker}</span></div>
        </div>
        {fixable.length > 0 && (
          <div className="relative shrink-0">
            <button onClick={() => fixable.length === 1 ? fixable[0].run() : setFixMenuOpen((v) => !v)} className={`rounded-md px-3 py-1 text-xs ${worst === 'red' ? 'bg-white text-red-700' : 'bg-navy text-white'}`}>
              Fix now{fixable.length > 1 ? ' ▾' : ''}
            </button>
            {fixMenuOpen && fixable.length > 1 && (
              <>
                <div className="fixed inset-0 z-[300]" onClick={() => setFixMenuOpen(false)} />
                <div className="absolute right-0 top-full z-[301] mt-2 w-80 overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-2xl">
                  <p className="border-b border-border px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Which problem do you want to fix?</p>
                  {fixable.map((f, i) => (
                    <button key={i} onClick={() => { setFixMenuOpen(false); f.run(); }} className="flex w-full items-center gap-2 border-b border-border/60 px-3 py-2.5 text-left text-sm font-medium last:border-0 hover:bg-muted">
                      <span className="grid h-5 min-w-5 place-items-center rounded-full bg-navy px-1 text-[11px] font-bold text-white">{f.num}</span>
                      <span className="min-w-0 flex-1 truncate">{f.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <button onClick={() => setCoverageCollapsed(true)} className="shrink-0 rounded-md p-1 hover:bg-black/10" aria-label="Collapse"><X className="h-4 w-4" /></button>
      </div>;
    })()}
    <div ref={panelRef} className="absolute right-4 top-2.5 z-[160] sm:right-5 sm:top-3.5">
      {open && <div className="absolute right-0 top-12 flex max-h-[min(34rem,70vh)] w-[min(23rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3"><div><p className="font-semibold text-foreground">New leads</p><p className="text-xs text-muted-foreground">All recent lead notifications</p></div>{unread > 0 && <button onClick={() => save(notifications.map((item) => ({ ...item, read: true })))} className="flex items-center gap-1 text-xs font-semibold text-gold"><CheckCheck className="h-3.5 w-3.5" /> Read all</button>}</div>
        <div className="overflow-y-auto overscroll-contain">{notifications.length === 0 ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">No new leads yet.</p> : notifications.map((item) => <div key={item.id} className={`group flex items-start gap-2 border-b border-border/70 px-3 py-3 last:border-0 ${item.read ? '' : 'bg-gold/5'}`}><button onClick={() => openLead(item)} className="min-w-0 flex-1 text-left"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold">{item.title} — {item.customerName}</p>{!item.read && <span className="h-2 w-2 shrink-0 rounded-full bg-gold" />}</div><p className="mt-1 truncate text-xs text-muted-foreground">{item.phone || 'No phone'}{item.destination ? ` · ${item.destination}` : ''}</p><p className="mt-1 text-[11px] text-muted-foreground">{new Date(item.createdAt).toLocaleString('en-IN')}</p></button><button onClick={() => save(notifications.filter((entry) => entry.id !== item.id))} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Remove"><X className="h-3.5 w-3.5" /></button></div>)}</div>
      </div>}
      <button onClick={() => setOpen((value) => !value)} className="relative flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-navy shadow-sm transition-transform hover:scale-105 active:scale-95" aria-label={`All notifications${unread ? `, ${unread} unread` : ''}`}><Bell className="h-4 w-4" />{unread > 0 && <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white ring-2 ring-white">{unread > 99 ? '99+' : unread}</span>}</button>
    </div>
    </>
  );
}
