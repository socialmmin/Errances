'use client';

import { useQuotationStats } from '@/hooks/use-quotations';
import { useInvoices, usePaymentReminders } from '@/hooks/use-finance';
import { BellRing, Store, Wallet } from 'lucide-react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Users,
  MapPinned,
  FileText,
  BarChart3,
  CalendarClock,
  MessageCircle,
  Settings,
  Plane,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  GripVertical,
  Target,
  MessageCircleWarning,
  PhoneCall,
  Receipt,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth-store';
import { useBranding } from '@/components/branding-provider';
import { useCallbackRequests } from '@/hooks/use-callback-requests';
import { useAllFollowUps } from '@/hooks/use-follow-ups';
import { useLeadStats } from '@/hooks/use-leads';
import { useWhatsAppHealth } from '@/hooks/use-whatsapp';
import { useFailedItineraries, useInboxState } from '@/hooks/use-whatsapp';
import { useCampaignCoverage } from '@/hooks/use-packages';
import { useMyAccess } from '@/hooks/use-access';
import { tr } from '@/i18n';

export const NAV_ITEMS = [
  { href: '/dashboard', access: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/leads', access: 'leads', label: 'Leads', icon: Users },
  { href: '/packages', access: 'packages', label: 'Packages & Itinerary', icon: MapPinned },
  { href: '/quotations', access: 'quotations', label: 'Quotations', icon: FileText },
  { href: '/finance/invoices', access: 'invoices', label: 'Invoices', icon: Receipt },
  { href: '/payment-reminders', access: 'invoices', label: 'Payment Reminders', icon: BellRing },
  { href: '/vendors', access: 'invoices', label: 'Vendors', icon: Store },
  { href: '/finance/report', access: 'invoices', label: 'Finance', icon: Wallet },
  { href: '/whatsapp', access: 'whatsapp', label: 'WhatsApp Inbox', icon: MessageCircle },
  { href: '/reports', access: 'reports', label: 'Reports', icon: BarChart3 },
  { href: '/meta-quality', access: 'meta_quality', label: 'Meta Quality', icon: Target },
  { href: '/callback-requests', access: 'callbacks', label: 'Callback Requests', icon: PhoneCall },
  { href: '/followups', access: 'followups', label: 'Follow-ups', icon: CalendarClock },
  { href: '/failed-whatsapp', access: 'failed_whatsapp', label: 'Failed WhatsApp', icon: MessageCircleWarning },
];

const NAV_ORDER_KEY = 'crm-sidebar-order';

function loadNavOrder() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(NAV_ORDER_KEY) || 'null') as string[] | null;
    if (!saved) return NAV_ITEMS;
    const byHref = new Map(NAV_ITEMS.map((item) => [item.href, item]));
    const ordered = saved.map((href) => byHref.get(href)).filter(Boolean) as typeof NAV_ITEMS;
    // A newly added nav entry goes right after the item it follows in the default list.
    NAV_ITEMS.forEach((item, index) => {
      if (saved.includes(item.href)) return;
      const prev = NAV_ITEMS[index - 1];
      const at = prev ? ordered.findIndex((o) => o.href === prev.href) : -1;
      ordered.splice(at >= 0 ? at + 1 : ordered.length, 0, item);
    });
    return ordered;
  } catch {
    return NAV_ITEMS;
  }
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  const brand = useBranding();
  // Badges only load data for pages this person can actually open -- otherwise every page load
  // would fire requests the server now refuses (and would leak counts for pages they cannot see).
  const { can, isSuperAdmin } = useMyAccess();
  const newLeads = useLeadStats().data?.new_leads ?? 0;
  const whatsappHealth = useWhatsAppHealth().data;
  const disconnectedCount = isSuperAdmin && whatsappHealth?.configured && (!whatsappHealth.tokenValid || !whatsappHealth.secretValid || !whatsappHealth.subscribed || whatsappHealth.inboundStale) ? 1 : 0;
  const pendingManual = (useFailedItineraries({ enabled: can('failed_whatsapp') }).data?.data ?? []).filter((i) => !i.manualAt && (i.fault as string) !== 'queued').length;
  const coverageGaps = useCampaignCoverage({ enabled: can('packages') }).data?.gaps.length ?? 0;
  const pendingCallbacks = (useCallbackRequests({ enabled: can('callbacks') }).data?.data ?? []).filter((c) => !c.called_at).length;
  // Quotations sent to a customer and still waiting for approval (approved ones are invoices).
  const approvedQuotations = useQuotationStats({ enabled: can('quotations') }).data?.awaiting_count ?? 0;
  // Payment reminders that are set and still to go out.
  const openReminders = (usePaymentReminders({ enabled: can('invoices') }).data?.data ?? []).filter((r) => r.reminder_id).length;
  // Invoices that still have a balance to collect.
  const unpaidInvoices = (useInvoices({}, { enabled: can('invoices') }).data?.data ?? []).filter((i: any) => String(i.status) !== 'paid' && !i.cancelled_at).length;
  const pendingFollowUps = (useAllFollowUps({ status: 'pending' }, { enabled: can('followups') }).data?.data ?? []).length;
  // Every customer message that hasn't been opened yet -- so a chat like Josh's above can never
  // just sit idle unnoticed; the sidebar itself says how many are waiting.
  const inboxState = useInboxState({ enabled: can('whatsapp') }).data;
  const unreadMessages = Object.values(inboxState ?? {}).reduce((sum, row) => sum + (row.unread || 0), 0);
  const initials = user?.fullName
    ?.split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const [navItems, setNavItems] = useState(NAV_ITEMS);
  useEffect(() => { setNavItems(loadNavOrder()); }, []);
  const [dragHref, setDragHref] = useState<string | null>(null);

  function reorder(overHref: string) {
    if (!dragHref || dragHref === overHref) return;
    setNavItems((items) => {
      const from = items.findIndex((item) => item.href === dragHref);
      const to = items.findIndex((item) => item.href === overHref);
      if (from === -1 || to === -1) return items;
      const next = items.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function persistOrder(items: typeof NAV_ITEMS) {
    try { window.localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(items.map((item) => item.href))); } catch { /* ignore */ }
  }

  return (
    <aside className={cn('sticky left-0 top-0 z-30 hidden h-full shrink-0 flex-col overflow-clip bg-navy-950 text-white transition-[width] duration-200 md:flex', collapsed ? 'w-20' : 'w-64')}>
      <div className={cn('flex h-16 shrink-0 items-center border-b border-white/5', collapsed ? 'justify-center px-2' : 'justify-between px-4')}>
        <div className={cn('flex items-center gap-2', collapsed && 'hidden')}><div className={brand.logo_url ? "flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-white p-0.5" : "flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-gold-400 to-gold-600 shadow-[0_0_20px_-4px_rgba(245,158,11,0.55)]"}>
          {brand.logo_url?<img src={brand.logo_url} alt="" className="h-full w-full object-contain"/>:<Plane className="h-[1.125rem] w-[1.125rem] -rotate-45 text-navy-900" strokeWidth={2.25} />}
        </div>
        <div className={cn('leading-tight', collapsed && 'hidden')}>
          <div className="max-w-36 truncate text-sm font-bold tracking-tight text-white">{brand.company_name}</div>
          <div className="max-w-36 truncate text-[10px] uppercase tracking-widest text-slate-500">{tr(brand.tagline)}</div>
        </div>
        </div>
        <button type="button" onClick={onToggle} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-gold" title={collapsed ? tr('Show sidebar') : tr('Hide sidebar')}>{collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}</button>
      </div>

      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 py-4 [scrollbar-color:#334155_transparent] [scrollbar-width:thin]">
        {navItems.filter((item) => can(item.access)).map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <div
              key={item.href}
              onDragOver={(event) => { if (dragHref) { event.preventDefault(); reorder(item.href); } }}
              onDrop={(event) => event.preventDefault()}
              className={cn('group relative flex items-center rounded-lg transition-all', dragHref === item.href && 'opacity-40', active ? 'bg-gold shadow-[0_8px_20px_-10px_rgba(245,158,11,.9)]' : 'hover:bg-white/5')}
            >
              <Link
                href={item.href}
                draggable={false}
                className={cn('flex flex-1 items-center rounded-lg py-2.5 text-sm font-medium', collapsed ? 'justify-center px-2' : 'gap-3 px-3', active ? 'text-navy' : 'text-slate-400 group-hover:text-slate-100')}
              >
                <Icon
                  className={cn(
                    'h-[1.125rem] w-[1.125rem] shrink-0 transition-colors',
                    active ? 'text-navy' : 'text-slate-500 group-hover:text-slate-300',
                  )}
                />
                {!collapsed && <span className="truncate">{tr(item.label)}</span>}
                {item.href === '/leads' && <CountBadge hideZero={collapsed} n={newLeads} tone="red" />}
                {item.href === '/whatsapp' && <CountBadge hideZero={collapsed} n={unreadMessages} tone="red" />}
                {item.href === '/packages' && <CountBadge hideZero={collapsed} n={coverageGaps} tone="red" />}
                {item.href === '/failed-whatsapp' && <CountBadge hideZero={collapsed} n={pendingManual} tone="red" />}
                {item.href === '/callback-requests' && <CountBadge hideZero={collapsed} n={pendingCallbacks} tone="red" />}
                {item.href === '/payment-reminders' && <CountBadge hideZero n={openReminders} tone="amber" />}
                {item.href === '/finance/invoices' && <CountBadge hideZero n={unpaidInvoices} tone="amber" />}
                {item.href === '/quotations' && <CountBadge hideZero n={approvedQuotations} tone="amber" />}
                {item.href === '/followups' && <CountBadge hideZero={collapsed} n={pendingFollowUps} tone="amber" />}
              </Link>
              {!collapsed && (
                <span
                  draggable
                  onDragStart={() => setDragHref(item.href)}
                  onDragEnd={() => { setDragHref(null); setNavItems((items) => { persistOrder(items); return items; }); }}
                  title={tr('Drag to reorder')}
                  className={cn('mr-1 shrink-0 cursor-grab touch-none rounded p-1 text-slate-500 opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-100', active && 'text-navy/60 hover:text-navy')}
                >
                  <GripVertical className="h-4 w-4" />
                </span>
              )}
            </div>
          );
        })}
      </nav>

      <footer className="shrink-0 border-t border-white/10 bg-navy-950">
      {user && (
        <div className={cn('flex items-center py-3', collapsed ? 'justify-center px-2' : 'gap-3 px-4')}>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-500/15 text-xs font-semibold text-gold-400 ring-1 ring-gold-500/30">
            {initials || 'U'}
          </div>
          <div className={cn('min-w-0 leading-tight', collapsed && 'hidden')}>
            <div className="truncate text-sm font-medium text-white">{user.fullName}</div>
            <div className="truncate text-xs capitalize text-slate-500">{tr(user.roleName.replace(/_/g, ' '))}</div>
          </div>
        </div>
      )}
      <div className="space-y-1 px-3 pb-3">
        {isSuperAdmin && <Link href="/settings" title={tr('Settings')} className={cn('flex items-center rounded-lg py-2.5 text-sm text-slate-300 hover:bg-white/10 hover:text-gold', collapsed ? 'justify-center px-2' : 'gap-3 px-3')}><Settings className="h-[1.125rem] w-[1.125rem]" />{!collapsed && <span>{tr('Settings')}</span>}{disconnectedCount > 0 && <span className="ml-auto rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{disconnectedCount}</span>}</Link>}
        <button type="button" title={tr('Log out')} onClick={clearSession} className={cn('flex w-full items-center rounded-lg py-2.5 text-sm text-slate-300 hover:bg-white/10 hover:text-red-300', collapsed ? 'justify-center px-2' : 'gap-3 px-3')}><LogOut className="h-[1.125rem] w-[1.125rem]" />{!collapsed && <span>{tr('Log out')}</span>}</button>
      </div>
      </footer>
    </aside>
  );
}

// Always shown (grey at 0) so an empty count reads as "nothing waiting", not as a missing feature.
function CountBadge({ n, tone, hideZero }: { n: number; tone: 'red' | 'amber'; hideZero?: boolean }) {
  void hideZero;
  if (!n) return null;
  const cls = n > 0 ? (tone === 'red' ? 'bg-red-500 text-white' : 'bg-amber-500 text-white') : 'bg-white/10 text-slate-400';
  return <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>{n > 999 ? '999+' : n}</span>;
}
