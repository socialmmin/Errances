'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Menu, Minus, Plus, RefreshCw, RotateCcw } from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';

const TITLES: Record<string, string> = { '/dashboard':'Dashboard','/leads':'Leads','/customers':'Customers','/packages':'Packages & Itinerary','/quotations':'Quotations','/whatsapp':'WhatsApp Inbox','/bookings':'Bookings & Operations','/finance/invoices':'Invoices','/finance/report':'Finance','/payment-reminders':'Payment Reminders','/finance':'Finance','/vendors':'Vendors','/reports':'Reports','/followups':'Follow-ups','/callback-requests':'Callback Requests','/failed-whatsapp':'Failed WhatsApp','/meta-quality':'Meta Quality','/tasks':'Tasks','/settings':'Settings' };
const ZOOM_LEVELS = Array.from({ length: 16 }, (_, index) => 50 + index * 10);
function pageTitle(pathname:string){const match=Object.keys(TITLES).find((key)=>pathname.startsWith(key));return match?TITLES[match]:'Errances Voyages';}

export function Topbar({zoom,onZoomChange}:{zoom:number;onZoomChange:(value:number)=>void}){
  const pathname=usePathname();
  const user=useAuthStore((state)=>state.user);
  const update=(value:number)=>onZoomChange(Math.min(200,Math.max(50,value)));
  const router=useRouter();
  const qc=useQueryClient();
  const fetching=useIsFetching()>0;
  // One step back on every page; with no in-app history (opened from a link/new tab) go to the dashboard.
  const goBack=()=>{ if(typeof window!=='undefined'&&window.history.length>1) router.back(); else router.push('/dashboard'); };
  // Reload this page's data in place -- stays on the same page, keeps filters/scroll.
  const refresh=()=>{ qc.invalidateQueries(); router.refresh(); };

  return <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border bg-card/95 py-2 pl-4 pr-16 backdrop-blur sm:h-16 sm:py-0 sm:pl-6 sm:pr-20">
    <div className="flex min-w-0 items-center gap-2"><button type="button" aria-label="Open menu" onClick={() => window.dispatchEvent(new Event('crm-open-menu'))} className="-ml-1 rounded-lg p-2 text-navy hover:bg-muted md:hidden"><Menu className="h-5 w-5" /></button><button type="button" onClick={goBack} aria-label="Go back one step" title="Back" className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-navy shadow-sm hover:border-gold hover:bg-gold/10"><ArrowLeft className="h-4 w-4"/><span className="hidden sm:inline">Back</span></button><button type="button" onClick={refresh} aria-label="Refresh this page" title="Refresh this page" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-navy shadow-sm hover:border-gold hover:bg-gold/10"><RefreshCw className={`h-4 w-4 ${fetching ? 'animate-spin' : ''}`}/></button><div className="ml-1 min-w-0"><h2 className="truncate text-sm font-semibold text-foreground sm:text-base">{pageTitle(pathname)}</h2><p className="truncate text-[11px] text-muted-foreground sm:text-xs">{user?`${user.fullName} · ${user.roleName.replace(/_/g,' ')}`:''}</p></div></div>
    <div className="flex items-center gap-2">
      <div className="flex h-9 items-center overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm" title="Page zoom: 50% to 200%">
        <button type="button" aria-label="Zoom out" disabled={zoom<=50} onClick={()=>update(zoom-10)} className="grid h-full w-9 place-items-center text-slate-500 hover:bg-slate-50 hover:text-navy disabled:opacity-30"><Minus className="h-3.5 w-3.5"/></button>
        <select aria-label="Page zoom" value={zoom} onChange={(event)=>update(Number(event.target.value))} className="h-full appearance-none border-x border-slate-100 bg-white px-2 text-center text-xs font-bold text-navy outline-none">{ZOOM_LEVELS.map(level=><option key={level} value={level}>{level}%</option>)}</select>
        <button type="button" aria-label="Zoom in" disabled={zoom>=200} onClick={()=>update(zoom+10)} className="grid h-full w-9 place-items-center text-slate-500 hover:bg-slate-50 hover:text-navy disabled:opacity-30"><Plus className="h-3.5 w-3.5"/></button>
        {zoom!==100&&<button type="button" aria-label="Reset zoom" onClick={()=>update(100)} className="grid h-full w-9 place-items-center border-l border-slate-100 text-slate-400 hover:bg-slate-50 hover:text-navy"><RotateCcw className="h-3.5 w-3.5"/></button>}
      </div>
    </div>
  </header>;
}
