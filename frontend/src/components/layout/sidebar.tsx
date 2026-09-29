'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Users,
  MapPinned,
  FileText,
  Wallet,
  BarChart3,
  CalendarClock,
  MessageCircle,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  GripVertical,
  Target,
  MessageCircleWarning,
  PhoneCall,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth-store';
import { useT } from '@/i18n/provider';
import { tr } from '@/i18n';
import type { TranslationKey } from '@/i18n/en';
import { useBranding } from '@/components/branding-provider';
import { useCallbackRequests } from '@/hooks/use-callback-requests';
import { useAllFollowUps } from '@/hooks/use-follow-ups';
import { useFailedItineraries, useInboxState } from '@/hooks/use-whatsapp';

export const NAV_ITEMS: { href: string; label: TranslationKey; icon: typeof LayoutDashboard }[] = [
  { href: '/dashboard', label: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/leads', label: 'nav.leads', icon: Users },
  { href: '/packages', label: 'nav.packages', icon: MapPinned },
  { href: '/quotations', label: 'nav.quotations', icon: FileText },
  { href: '/whatsapp', label: 'nav.whatsapp', icon: MessageCircle },
  { href: '/finance', label: 'nav.finance', icon: Wallet },
  { href: '/reports', label: 'nav.reports', icon: BarChart3 },
  { href: '/meta-quality', label: 'nav.metaQuality', icon: Target },
  { href: '/callback-requests', label: 'nav.callbacks', icon: PhoneCall },
  { href: '/followups', label: 'nav.followups', icon: CalendarClock },
  { href: '/failed-whatsapp', label: 'nav.failedWhatsapp', icon: MessageCircleWarning },
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
  const t = useT();
  const pendingManual = (useFailedItineraries().data?.data ?? []).filter((i) => !i.manualAt && (i.fault as string) !== 'queued').length;
  const pendingCallbacks = (useCallbackRequests().data?.data ?? []).filter((c) => !c.called_at).length;
  const pendingFollowUps = (useAllFollowUps({ status: 'pending' }).data?.data ?? []).length;
  // Every customer message that hasn't been opened yet -- so a chat like Josh's above can never
  // just sit idle unnoticed; the sidebar itself says how many are waiting.
  const inboxState = useInboxState().data;
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
    <aside className={cn('sticky left-0 top-0 z-30 hidden h-full shrink-0 flex-col overflow-hidden border-r border-border bg-white text-navy transition-[width] duration-200 md:flex', collapsed ? 'w-20' : 'w-64')}>
      <div className={cn('flex h-16 shrink-0 items-center border-b border-border', collapsed ? 'justify-center px-2' : 'justify-between px-4')}>
        <div className={cn('flex min-w-0 items-center', collapsed && 'hidden')}>
          <img src={brand.logo_url || '/brand/logo.png'} alt={brand.company_name} className="h-10 w-auto max-w-[10.25rem] object-contain" />
        </div>
        <button type="button" onClick={onToggle} className="rounded-lg p-2 text-slate-500 hover:bg-muted hover:text-gold" title={collapsed ? t('common.showSidebar') : t('common.hideSidebar')}>{collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}</button>
      </div>

      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 py-4 [scrollbar-color:#d1d5db_transparent] [scrollbar-width:thin]">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <div
              key={item.href}
              onDragOver={(event) => { if (dragHref) { event.preventDefault(); reorder(item.href); } }}
              onDrop={(event) => event.preventDefault()}
              className={cn('group relative flex items-center rounded-lg transition-all', dragHref === item.href && 'opacity-40', active ? 'bg-gold shadow-[0_8px_20px_-10px_rgba(217,30,42,.7)]' : 'hover:bg-muted')}
            >
              <Link
                href={item.href}
                draggable={false}
                className={cn('flex flex-1 items-center rounded-lg py-2.5 text-sm font-medium', collapsed ? 'justify-center px-2' : 'gap-3 px-3', active ? 'text-white' : 'text-slate-600 group-hover:text-navy')}
              >
                <Icon
                  className={cn(
                    'h-[1.125rem] w-[1.125rem] shrink-0 transition-colors',
                    active ? 'text-white' : 'text-slate-500 group-hover:text-gold',
                  )}
                />
                {!collapsed && <span className="truncate">{t(item.label)}</span>}
                {item.href === '/whatsapp' && unreadMessages > 0 && <span className="ml-auto rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{unreadMessages}</span>}
                {item.href === '/failed-whatsapp' && pendingManual > 0 && <span className="ml-auto rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{pendingManual}</span>}
                {item.href === '/callback-requests' && pendingCallbacks > 0 && <span className="ml-auto rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{pendingCallbacks}</span>}
                {item.href === '/followups' && pendingFollowUps > 0 && <span className="ml-auto rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{pendingFollowUps}</span>}
              </Link>
              {!collapsed && (
                <span
                  draggable
                  onDragStart={() => setDragHref(item.href)}
                  onDragEnd={() => { setDragHref(null); setNavItems((items) => { persistOrder(items); return items; }); }}
                  title={t('common.dragToReorder')}
                  className={cn('mr-1 shrink-0 cursor-grab touch-none rounded p-1 text-slate-500 opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-100', active && 'text-white/70 hover:text-white')}
                >
                  <GripVertical className="h-4 w-4" />
                </span>
              )}
            </div>
          );
        })}
      </nav>

      <footer className="shrink-0 border-t border-border bg-white">
      {user && (
        <div className={cn('flex items-center py-3', collapsed ? 'justify-center px-2' : 'gap-3 px-4')}>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-500/10 text-xs font-semibold text-gold-500 ring-1 ring-gold-500/30">
            {initials || 'U'}
          </div>
          <div className={cn('min-w-0 leading-tight', collapsed && 'hidden')}>
            <div className="truncate text-sm font-medium text-navy">{user.fullName}</div>
            <div className="truncate text-xs capitalize text-slate-500">{tr(user.roleName.replace(/_/g, ' '))}</div>
          </div>
        </div>
      )}
      <div className="space-y-1 px-3 pb-3">
        <Link href="/settings" title={t('common.settings')} className={cn('flex items-center rounded-lg py-2.5 text-sm text-slate-600 hover:bg-muted hover:text-gold', collapsed ? 'justify-center px-2' : 'gap-3 px-3')}><Settings className="h-[1.125rem] w-[1.125rem]" />{!collapsed && <span>{t('common.settings')}</span>}</Link>
        <button type="button" title={t('common.logout')} onClick={clearSession} className={cn('flex w-full items-center rounded-lg py-2.5 text-sm text-slate-600 hover:bg-muted hover:text-gold', collapsed ? 'justify-center px-2' : 'gap-3 px-3')}><LogOut className="h-[1.125rem] w-[1.125rem]" />{!collapsed && <span>{t('common.logout')}</span>}</button>
      </div>
      </footer>
    </aside>
  );
}
