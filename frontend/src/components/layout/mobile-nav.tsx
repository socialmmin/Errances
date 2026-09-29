'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, LogOut, MessageCircleWarning, MoreHorizontal, Settings, Users, MessageCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth-store';
import { useCallbackRequests } from '@/hooks/use-callback-requests';
import { useFailedItineraries } from '@/hooks/use-whatsapp';
import { useT } from '@/i18n/provider';
import type { TranslationKey } from '@/i18n/en';
import { LanguageSwitcher } from '@/components/shared/language-switcher';
import { NAV_ITEMS } from './sidebar';

const BAR: { href: string; label: TranslationKey; icon: typeof LayoutDashboard }[] = [
  { href: '/dashboard', label: 'mobile.home', icon: LayoutDashboard },
  { href: '/leads', label: 'nav.leads', icon: Users },
  { href: '/whatsapp', label: 'mobile.whatsapp', icon: MessageCircle },
  { href: '/failed-whatsapp', label: 'mobile.failed', icon: MessageCircleWarning },
];

// Phone navigation: a bottom bar for the everyday pages plus "More", which opens the same
// menu the desktop sidebar has. Portaled to <body> so the app's zoom transform cannot shift
// a fixed bar away from the real bottom of the screen.
export function MobileNav() {
  const pathname = usePathname();
  const t = useT();
  const clearSession = useAuthStore((s) => s.clearSession);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => { const openMenu = () => setOpen(true); window.addEventListener('crm-open-menu', openMenu); return () => window.removeEventListener('crm-open-menu', openMenu); }, []);

  const failed = (useFailedItineraries().data?.data ?? []).filter((i) => !i.manualAt && (i.fault as string) !== 'queued').length;
  const callbacks = (useCallbackRequests().data?.data ?? []).filter((c) => !c.called_at).length;
  const badge = (href: string) => (href === '/failed-whatsapp' ? failed : href === '/followups' ? callbacks : 0);
  if (!mounted) return null;

  const menuItems: { href: string; label: TranslationKey; icon: typeof LayoutDashboard }[] = [...NAV_ITEMS, { href: '/settings', label: 'nav.settings', icon: Settings }];

  return createPortal(
    <div className="md:hidden">
      {open && (
        <div className="fixed inset-0 z-[210] bg-black/50" onClick={() => setOpen(false)}>
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-white p-4 pb-24 text-navy shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><p className="text-sm font-bold uppercase tracking-widest text-gold">{t('mobile.menu')}</p><button type="button" aria-label={t('mobile.closeMenu')} onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-muted"><X className="h-5 w-5" /></button></div>
            <LanguageSwitcher className="mb-3 self-start" />
            <div className="flex flex-col gap-1.5">
              {menuItems.map((item) => {
                const Icon = item.icon;
                const active = pathname?.startsWith(item.href);
                const n = badge(item.href);
                return (
                  <Link key={item.href} href={item.href} className={cn('relative flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium', active ? 'bg-gold text-white' : 'bg-muted text-navy-700 hover:bg-gold-50')}>
                    <Icon className="h-5 w-5 shrink-0" /><span className="truncate">{t(item.label)}</span>
                    {n > 0 && <span className="ml-auto rounded-full bg-navy-900 px-1.5 py-0.5 text-[10px] font-bold text-white">{n}</span>}
                  </Link>
                );
              })}
            </div>
            <button type="button" onClick={clearSession} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-muted py-3 text-sm font-medium text-navy-700 hover:bg-gold-50"><LogOut className="h-4 w-4" />{t('common.logout')}</button>
          </div>
        </div>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-[220] grid h-16 grid-cols-5 border-t border-border bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-16px_rgba(17,24,39,.5)] backdrop-blur">
        {BAR.map((item) => {
          const Icon = item.icon;
          const active = pathname?.startsWith(item.href);
          const n = badge(item.href);
          return (
            <Link key={item.href} href={item.href} className={cn('relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium', active ? 'text-gold' : 'text-muted-foreground')}>
              <span className="relative"><Icon className="h-5 w-5" />{n > 0 && <span className="absolute -right-2.5 -top-1.5 rounded-full bg-gold px-1 text-[9px] font-bold leading-4 text-white">{n > 99 ? '99+' : n}</span>}</span>
              <span className="max-w-full truncate px-0.5">{t(item.label)}</span>
            </Link>
          );
        })}
        <button type="button" onClick={() => setOpen((v) => !v)} className={cn('flex flex-col items-center justify-center gap-1 text-[11px] font-medium', open ? 'text-gold' : 'text-muted-foreground')}><MoreHorizontal className="h-5 w-5" />{t('mobile.more')}</button>
      </nav>
    </div>,
    document.body,
  );
}
