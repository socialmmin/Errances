'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useIsFetching } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth-store';
import { useT } from '@/i18n/provider';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { LeadAlertProvider } from '@/components/notifications/lead-alert-provider';
import { MobileNav } from './mobile-nav';

// Protected-route layout + RBAC boundary: redirects unauthenticated users to
// /login. Ported conceptually from hala-audit's protected route wrapper
// (frontend/src/components/layout), reimplemented for Next.js App Router.
export function ProtectedShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const t = useT();
  const pathname = usePathname();
  const accessToken = useAuthStore((s) => s.accessToken);
  // During the hydration pass React reads the server snapshot (no token), so a
  // redirect decided in that first effect logged users out on every refresh.
  // Wait until after mount, then read the real persisted state.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const fetching = useIsFetching() > 0;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [zoom, setZoom] = useState(100);
  // Size the scaled app from the real window, in pixels. A percentage height of the
  // parent left a blank strip along the bottom whenever zoom was below 100%.
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const measure = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    if (mounted && !useAuthStore.getState().accessToken) {
      router.replace('/login');
    }
  }, [mounted, accessToken, router]);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem('crm-zoom') || 100);
    setZoom(Math.min(200, Math.max(50, saved)));
  }, []);

  function updateZoom(value: number) {
    setZoom(value);
    window.localStorage.setItem('crm-zoom', String(value));
  }

  if (!accessToken) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white text-muted-foreground">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-gold/25 border-t-gold" />
        <p className="text-sm font-semibold text-navy">{t('common.loadingWorkspace')}</p>
      </div>
    );
  }

  const scale = zoom / 100;
  return (
    <div className="h-screen w-screen overflow-hidden bg-white">
      <style>{'@keyframes crm-load{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}'}</style>
      {fetching && <div className="fixed left-0 right-0 top-0 z-[400] h-1 overflow-hidden bg-gold/20"><div className="h-full w-1/3 rounded-full bg-gold" style={{ animation: 'crm-load 1s ease-in-out infinite' }} /></div>}
    <div className="flex origin-top-left overflow-hidden bg-white" style={{ width: viewport ? viewport.w / scale : `${100 / scale}%`, height: viewport ? viewport.h / scale : `${100 / scale}%`, transform: `scale(${scale})` }}>
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((value) => !value)} />
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar zoom={zoom} onZoomChange={updateZoom} />
        <LeadAlertProvider />
        <main className={pathname?.startsWith('/whatsapp') ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'flex-1 overflow-y-auto px-3 pb-24 pt-4 sm:px-5 md:p-6 lg:p-8'}>{children}</main>
      </div>
      <MobileNav />
    </div>
    </div>
  );
}
