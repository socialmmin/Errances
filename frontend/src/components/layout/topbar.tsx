'use client';

import { usePathname } from 'next/navigation';
import { Menu, Minus, Plus, RotateCcw, Search } from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';
import { useT } from '@/i18n/provider';
import type { TranslationKey } from '@/i18n/en';
import { LanguageSwitcher } from '@/components/shared/language-switcher';
import { tr } from '@/i18n';

const TITLES: Record<string, TranslationKey> = { '/dashboard':'nav.dashboard','/leads':'nav.leads','/customers':'nav.customers','/packages':'nav.packages','/quotations':'nav.quotations','/whatsapp':'nav.whatsapp','/bookings':'nav.bookings','/finance':'nav.finance','/vendors':'nav.vendors','/reports':'nav.reports','/tasks':'nav.tasks','/settings':'nav.settings','/meta-quality':'nav.metaQuality','/callback-requests':'nav.callbacks','/followups':'nav.followups','/failed-whatsapp':'nav.failedWhatsapp' };
const ZOOM_LEVELS = Array.from({ length: 16 }, (_, index) => 50 + index * 10);
function titleKey(pathname:string):TranslationKey|null{const match=Object.keys(TITLES).find((key)=>pathname.startsWith(key));return match?TITLES[match]:null;}

export function Topbar({zoom,onZoomChange}:{zoom:number;onZoomChange:(value:number)=>void}){
  const pathname=usePathname();
  const t=useT();
  const user=useAuthStore((state)=>state.user);
  const update=(value:number)=>onZoomChange(Math.min(200,Math.max(50,value)));
  const key=titleKey(pathname);

  return <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border bg-card/95 py-2 pl-4 pr-16 backdrop-blur sm:h-16 sm:py-0 sm:pl-6 sm:pr-20">
    <div className="flex min-w-0 items-center gap-2"><button type="button" aria-label={t('common.openMenu')} onClick={() => window.dispatchEvent(new Event('crm-open-menu'))} className="-ml-1 rounded-lg p-2 text-navy hover:bg-muted md:hidden"><Menu className="h-5 w-5" /></button><div className="min-w-0"><h2 className="truncate text-sm font-semibold text-foreground sm:text-base">{key?t(key):tr("Errances Voyages")}</h2><p className="truncate text-[11px] text-muted-foreground sm:text-xs">{user?`${user.fullName} · ${tr(user.roleName.replace(/_/g,' '))}`:''}</p></div></div>
    <div className="flex items-center gap-2">
      <LanguageSwitcher className="hidden md:flex" />
      <div className="flex h-9 items-center overflow-hidden rounded-full border border-border bg-white shadow-sm" title={t('common.pageZoom')}>
        <button type="button" aria-label={t('common.zoomOut')} disabled={zoom<=50} onClick={()=>update(zoom-10)} className="grid h-full w-9 place-items-center text-slate-500 hover:bg-slate-50 hover:text-gold disabled:opacity-30"><Minus className="h-3.5 w-3.5"/></button>
        <select aria-label={t('common.pageZoom')} value={zoom} onChange={(event)=>update(Number(event.target.value))} className="h-full appearance-none border-x border-slate-100 bg-white px-2 text-center text-xs font-bold text-navy outline-none">{ZOOM_LEVELS.map(level=><option key={level} value={level}>{tr(level)}%</option>)}</select>
        <button type="button" aria-label={t('common.zoomIn')} disabled={zoom>=200} onClick={()=>update(zoom+10)} className="grid h-full w-9 place-items-center text-slate-500 hover:bg-slate-50 hover:text-gold disabled:opacity-30"><Plus className="h-3.5 w-3.5"/></button>
        {zoom!==100&&<button type="button" aria-label={t('common.resetZoom')} onClick={()=>update(100)} className="grid h-full w-9 place-items-center border-l border-slate-100 text-slate-400 hover:bg-slate-50 hover:text-gold"><RotateCcw className="h-3.5 w-3.5"/></button>}
      </div>
      <div className="relative hidden lg:block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/><input placeholder={t('common.searchPlaceholder')} className="h-9 w-52 rounded-full border border-input bg-muted/50 pl-9 pr-3 text-sm xl:w-64"/></div>
    </div>
  </header>;
}
