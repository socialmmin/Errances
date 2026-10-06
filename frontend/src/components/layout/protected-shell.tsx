'use client';

import { useEffect, useRef, useState } from 'react';
import { tr } from '@/i18n';
import { usePathname, useRouter } from 'next/navigation';
import { useIsFetching } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth-store';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { LeadAlertProvider } from '@/components/notifications/lead-alert-provider';
import { FollowUpDuePopup } from '@/components/notifications/follow-up-due';
import { MobileNav } from './mobile-nav';
import { accessKeyForPath, useMyAccess } from '@/hooks/use-access';

// Protected-route layout + RBAC boundary: redirects unauthenticated users to
// /login. Ported conceptually from hala-audit's protected route wrapper
// (frontend/src/components/layout), reimplemented for Next.js App Router.
export function ProtectedShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const accessToken = useAuthStore((s) => s.accessToken);
  // During the hydration pass React reads the server snapshot (no token), so a
  // redirect decided in that first effect logged users out on every refresh.
  // Wait until after mount, then read the real persisted state.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const fetching = useIsFetching() > 0;
  // Typing a blocked page into the address bar (or an old bookmark) shows a clear message instead
  // of a page full of failed requests. The server refuses the data regardless -- this is just the
  // honest explanation. Settings is super-admin only.
  const { can, loaded: accessLoaded, isSuperAdmin } = useMyAccess();
  const pageKey = accessKeyForPath(pathname);
  const blocked = accessLoaded && ((pageKey && !can(pageKey)) || (!isSuperAdmin && !!pathname?.startsWith('/settings')));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [zoom, setZoom] = useState(100);
  // Size the scaled app from the real window, in pixels. A percentage height of the parent
  // left a blank strip along the bottom whenever zoom was below 100% -- but that first fix
  // still had two gaps: (1) viewport started as `null` and fell back to a vw/vh string for
  // one paint, which (1a) never updated again if no `resize` event happened to fire right
  // after (e.g. a late-loading image on a content-heavy page nudging layout without the
  // *window* itself resizing), and (2) `viewport.h / scale` is rarely a whole number, and
  // flooring it during CSS's own subpixel rounding could land the scaled box a hair short of
  // the real viewport -- a 1px shortfall is invisible on its own, but reveals Chrome's own
  // dark page-background fallback for the sliver outside the document on dark-mode Windows.
  // Reading window size synchronously (no `null` state) and rounding UP removes both.
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(() =>
    typeof window === 'undefined' ? null : { w: window.innerWidth, h: window.innerHeight },
  );
  useEffect(() => {
    // Only updates state when the size actually changed -- the 1s poll below would otherwise
    // re-render the whole shell every second even while nothing moved.
    const measure = () => setViewport((prev) => {
      const next = { w: window.innerWidth, h: window.innerHeight };
      return prev && prev.w === next.w && prev.h === next.h ? prev : next;
    });
    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    // The 'resize' event alone isn't reliable for every real way a window's actual size changes
    // -- a non-maximized window dragged/snapped by its edge, restored from the taskbar, or moved
    // between monitors with different DPI scaling can all leave `viewport` stale without ever
    // firing 'resize' on this tab. That staleness is exactly what causes the shell to render
    // smaller than the real window, leaving a visible gap along the right/bottom edge (confirmed
    // live: a non-maximized floating window with other windows visible behind it in the gap).
    // 'focus'/'visibilitychange' catch "came back to this tab after resizing it" (the most common
    // real trigger), and a cheap 1s poll is the unconditional safety net for anything neither one
    // of those catches.
    const onFocusOrVisible = () => measure();
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    const poll = setInterval(measure, 1000);
    return () => {
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
      clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    if (mounted && !useAuthStore.getState().accessToken) {
      router.replace('/login');
    }
  }, [mounted, accessToken, router]);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem('crm-zoom') || 100);
    // A corrupted/stray localStorage value (anything non-numeric) made `saved` NaN, which
    // propagated into `scale` and then into the CSS transform below -- Chrome just drops an
    // invalid `scale(NaN)`/`width: NaNpx` silently, so the shell fell back to its intrinsic
    // (too-short) content size instead of the real viewport. Falling back to 100 here instead
    // of letting NaN through makes that class of bug impossible regardless of root cause.
    setZoom(Number.isFinite(saved) ? Math.min(200, Math.max(50, saved)) : 100);
  }, []);

  function updateZoom(value: number) {
    setZoom(value);
    window.localStorage.setItem('crm-zoom', String(value));
  }

  // `main` is a custom scrollable div, not the browser window -- Next.js's own "reset scroll on
  // navigation" only ever resets window.scrollY, so it does nothing here. Scroll deep into a
  // long page (e.g. Packages & Itinerary), then click a sidebar link to a shorter one (e.g.
  // Settings), and the OLD scrollTop carries straight over: the browser clamps it to the new
  // page's (shorter) max scroll, landing you already most of the way down a page you haven't
  // even seen the top of yet -- which looks exactly like "a gap appeared" or "the screen jumped
  // up", on literally any page-to-page navigation where the next page is shorter than the
  // scroll position left on the previous one. This is the real, systemic cause behind the
  // repeated "gap" reports -- not any single page's own layout.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
    // Safety net for the document itself, in case anything ever makes the page taller than the
    // window -- the shell containers can no longer scroll (overflow-clip, see below).
    document.scrollingElement?.scrollTo(0, 0);
  }, [pathname]);

  if (!accessToken) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 text-muted-foreground">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-gold/25 border-t-gold" />
        <p className="text-sm font-semibold text-navy">{tr('Loading your workspace…')}</p>
      </div>
    );
  }

  const scale = zoom / 100;
  // The outer wrapper used to be sized with `h-screen w-screen` (CSS 100vh/100vw) while the
  // inner scaled box is sized from `viewport`, a JS-measured window.innerWidth/innerHeight.
  // Those are two SEPARATE measurements and can drift apart on Windows + Chrome (DPI scaling,
  // dynamic toolbars, the bookmarks bar toggling, etc.) -- when they do, the inner box renders
  // shorter than the outer, and the outer's own background shows through as a bare strip along
  // the bottom (exactly the long-reported "gap" bug: confirmed live via screenshot showing the
  // scaled sidebar+content ending early with plain background exposed below it, independent of
  // any scroll position -- a prior fix for carried-over scroll on navigation was real but was
  // never this bug). Fixed by deriving BOTH the outer and inner box size from the one `viewport`
  // state, so there is no second measurement path left to disagree with it.
  const vw = viewport?.w ?? 1920;
  const vh = viewport?.h ?? 1080;
  // overflow-CLIP, not overflow-hidden, on all three shell containers. `hidden` only hides the
  // scrollbar -- the box is still a scroll container the browser can scroll programmatically.
  // At any zoom below 100% the inner box is laid out taller than the window (vh / scale) before
  // being scaled down, so the outer wrapper had exactly (vh/scale - vh) px of invisible scroll
  // room. Clicking a sidebar link focuses it, and the browser's focus-into-view scrolled that
  // hidden container to "reveal" it -- shifting the WHOLE app up (topbar and sidebar logo pushed
  // off the top) and exposing an equal blank strip at the bottom, on every navigation. Confirmed
  // from a screenshot: the missing top and the blank bottom were the same ~90px, matching
  // vh/0.9 - vh at 90% zoom exactly. `clip` clips identically but cannot be scrolled at all.
  return (
    <div className="overflow-clip bg-slate-50" style={{ width: vw, height: vh }}>
      <style>{'@keyframes crm-load{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}'}</style>
      {fetching && <div className="fixed left-0 right-0 top-0 z-[400] h-1 overflow-hidden bg-gold/20"><div className="h-full w-1/3 rounded-full bg-gold" style={{ animation: 'crm-load 1s ease-in-out infinite' }} /></div>}
    <div className="flex origin-top-left overflow-clip bg-slate-50" style={{ width: Math.ceil(vw / scale), height: Math.ceil(vh / scale), transform: `scale(${scale})` }}>
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((value) => !value)} />
      <div className="relative flex min-w-0 flex-1 flex-col overflow-clip">
        <Topbar zoom={zoom} onZoomChange={updateZoom} />
        <LeadAlertProvider />
        <FollowUpDuePopup />
        {/* min-h-0 is load-bearing here: a flex item's default min-height is "auto" (its content's
            natural height), which lets `main` grow taller than the space actually available to
            it instead of being constrained -- so overflow-y-auto never engages, and the part of
            the page that doesn't fit just gets silently clipped by the shell's own
            overflow-hidden a level up, instead of becoming reachable by scrolling. Without this,
            any page whose content runs long (a table, a long list) looks cut off with the
            scrollbar thumb stuck short of the bottom. The /whatsapp branch already had this. */}
        <main ref={mainRef} className={pathname?.startsWith('/whatsapp') ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'min-h-0 flex-1 overflow-y-auto px-3 pb-24 pt-4 sm:px-5 md:p-6 lg:p-8'}>{blocked ? (
          <div className="mx-auto mt-16 max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
            <p className="text-lg font-bold text-navy dark:text-white">{tr("You don't have access to this page")}</p>
            <p className="mt-2 text-sm text-muted-foreground">{tr('Ask your administrator to switch it on for your login if you need it.')}</p>
          </div>
        ) : children}</main>
      </div>
      <MobileNav />
    </div>
    </div>
  );
}
